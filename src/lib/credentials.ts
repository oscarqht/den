import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getFallbackKeytarAccountsForCredential,
  type CredentialLookupMetadata,
} from './credential-token-fallback';
import { createKeytarLoader, type KeytarModule } from './keytar-loader';
import { getLocalDb } from './local-db';

const SERVICE_NAME = 'viba-git-credentials';
const LEGACY_CREDENTIALS_PATH = path.join(os.homedir(), '.viba', 'credentials.json');

export type CredentialType = 'github' | 'gitlab';

export interface BaseCredential {
  id: string;
  type: CredentialType;
  username: string;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubCredential extends BaseCredential {
  type: 'github';
}

export interface GitLabCredential extends BaseCredential {
  type: 'gitlab';
  serverUrl: string;
}

export type Credential = GitHubCredential | GitLabCredential;

type CredentialMetadata = {
  id: string;
  type: CredentialType;
  username: string;
  serverUrl?: string;
  createdAt: string;
  updatedAt: string;
  keytarAccount?: string;
};

const { loadKeytar, requireKeytar } = createKeytarLoader({ logLabel: 'credentials' });

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeGitLabServerUrl(serverUrl: string): string {
  return serverUrl.trim().replace(/\/$/, '');
}

function getDefaultKeytarAccount(id: string): string {
  return `credential-${id}`;
}

function getKeytarAccountForMetadata(metadata: { id: string; keytarAccount?: string }): string {
  return metadata.keytarAccount || getDefaultKeytarAccount(metadata.id);
}

function parseLegacyCredentials(raw: unknown): CredentialLookupMetadata[] {
  const credentials: CredentialLookupMetadata[] = [];

  const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as Record<string, unknown>;
      const id = asString(row.id);
      const type = asString(row.type);
      const username = asString(row.username);
      if (!id || !username || (type !== 'github' && type !== 'gitlab')) continue;

      credentials.push({
        id,
        type,
        username,
        serverUrl: type === 'gitlab' ? asString(row.serverUrl) ?? 'https://gitlab.com' : undefined,
        keytarAccount: asString(row.keytarAccount) ?? undefined,
      });
    }

    return credentials;
  }

  if (!raw || typeof raw !== 'object') return credentials;
  const legacy = raw as Record<string, unknown>;

  const github = legacy.github;
  if (github && typeof github === 'object') {
    const row = github as Record<string, unknown>;
    const username = asString(row.username);
    if (username) {
      credentials.push({
        id: 'legacy-github',
        type: 'github',
        username,
        keytarAccount: asString(row.keytarAccount) ?? 'credential-github',
      });
    }
  }

  const gitlab = legacy.gitlab;
  if (gitlab && typeof gitlab === 'object') {
    const row = gitlab as Record<string, unknown>;
    const username = asString(row.username);
    if (username) {
      credentials.push({
        id: 'legacy-gitlab',
        type: 'gitlab',
        username,
        serverUrl: asString(row.serverUrl) ?? 'https://gitlab.com',
        keytarAccount: asString(row.keytarAccount) ?? 'credential-gitlab',
      });
    }
  }

  return credentials;
}

async function readLegacyCredentials(): Promise<CredentialLookupMetadata[]> {
  try {
    const raw = await fs.readFile(LEGACY_CREDENTIALS_PATH, 'utf8');
    return parseLegacyCredentials(JSON.parse(raw));
  } catch {
    return [];
  }
}

function toCredential(metadata: CredentialMetadata): Credential {
  if (metadata.type === 'gitlab') {
    return {
      id: metadata.id,
      type: 'gitlab',
      username: metadata.username,
      serverUrl: metadata.serverUrl || 'https://gitlab.com',
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
    };
  }

  return {
    id: metadata.id,
    type: 'github',
    username: metadata.username,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
  };
}

async function writeCredentialsMetadata(metadata: CredentialMetadata[]): Promise<void> {
  const db = getLocalDb();
  const writeTx = db.transaction((rows: CredentialMetadata[]) => {
    db.prepare('DELETE FROM credentials_metadata').run();
    const insert = db.prepare(`
      INSERT INTO credentials_metadata (
        id, type, username, server_url, created_at, updated_at, keytar_account
      ) VALUES (
        @id, @type, @username, @serverUrl, @createdAt, @updatedAt, @keytarAccount
      )
    `);
    for (const row of rows) {
      insert.run({
        id: row.id,
        type: row.type,
        username: row.username,
        serverUrl: row.serverUrl ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        keytarAccount: row.keytarAccount ?? null,
      });
    }
  });
  writeTx(metadata);
}

async function readCredentialsMetadata(): Promise<CredentialMetadata[]> {
  try {
    const db = getLocalDb();
    const rows = db.prepare(`
      SELECT id, type, username, server_url, created_at, updated_at, keytar_account
      FROM credentials_metadata
    `).all() as Array<{
      id: string;
      type: CredentialType;
      username: string;
      server_url: string | null;
      created_at: string;
      updated_at: string;
      keytar_account: string | null;
    }>;

    return rows
      .filter((row) => row.type === 'github' || row.type === 'gitlab')
      .map((row) => ({
        id: row.id,
        type: row.type,
        username: row.username,
        serverUrl: row.server_url ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        keytarAccount: row.keytar_account ?? undefined,
      }));
  } catch (error) {
    console.error('Failed to read credentials metadata:', error);
    return [];
  }
}

export async function getAllCredentials(): Promise<Credential[]> {
  const metadata = await readCredentialsMetadata();

  return metadata
    .map(toCredential)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getCredentialById(id: string): Promise<Credential | null> {
  const metadata = await readCredentialsMetadata();
  const found = metadata.find((credential) => credential.id === id);
  return found ? toCredential(found) : null;
}

export async function getCredentialToken(id: string): Promise<string | null> {
  const metadata = await readCredentialsMetadata();
  const found = metadata.find((credential) => credential.id === id);
  if (!found) {
    return null;
  }

  const keytar = await loadKeytar();
  if (!keytar) {
    return null;
  }

  const primaryAccount = getKeytarAccountForMetadata(found);
  const primaryToken = await keytar.getPassword(SERVICE_NAME, primaryAccount);
  if (primaryToken) {
    return primaryToken;
  }

  const legacyCredentials = await readLegacyCredentials();
  const fallbackAccounts = getFallbackKeytarAccountsForCredential(found, legacyCredentials);

  for (const fallbackAccount of fallbackAccounts) {
    const fallbackToken = await keytar.getPassword(SERVICE_NAME, fallbackAccount);
    if (fallbackToken) {
      return fallbackToken;
    }
  }

  return null;
}

async function verifyGitHubToken(token: string): Promise<{ valid: boolean; username?: string; error?: string }> {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { valid: false, error: 'Invalid or expired GitHub token.' };
      }
      return { valid: false, error: `GitHub API returned ${response.status}.` };
    }

    const data = await response.json();
    const username = typeof data?.login === 'string' ? data.login : null;
    if (!username) {
      return { valid: false, error: 'GitHub API response did not include a username.' };
    }

    return { valid: true, username };
  } catch (error) {
    return { valid: false, error: `Failed to verify GitHub token: ${(error as Error).message}` };
  }
}

async function verifyGitLabToken(serverUrl: string, token: string): Promise<{ valid: boolean; username?: string; error?: string }> {
  try {
    const normalizedUrl = normalizeGitLabServerUrl(serverUrl);
    const response = await fetch(`${normalizedUrl}/api/v4/user`, {
      headers: {
        'PRIVATE-TOKEN': token,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { valid: false, error: 'Invalid or expired GitLab token.' };
      }
      return { valid: false, error: `GitLab API returned ${response.status}.` };
    }

    const data = await response.json();
    const username = typeof data?.username === 'string' ? data.username : null;
    if (!username) {
      return { valid: false, error: 'GitLab API response did not include a username.' };
    }

    return { valid: true, username };
  } catch (error) {
    return { valid: false, error: `Failed to verify GitLab token: ${(error as Error).message}` };
  }
}

export async function createGitHubCredential(token: string): Promise<{ success: boolean; credential?: GitHubCredential; error?: string }> {
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    return { success: false, error: 'GitHub token is required.' };
  }

  let keytar: KeytarModule;
  try {
    keytar = await requireKeytar();
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }

  const verification = await verifyGitHubToken(trimmedToken);
  if (!verification.valid || !verification.username) {
    return { success: false, error: verification.error || 'Failed to verify GitHub token.' };
  }

  const metadata = await readCredentialsMetadata();
  const duplicate = metadata.find((credential) => (
    credential.type === 'github'
    && credential.username === verification.username
  ));

  if (duplicate) {
    return { success: false, error: `A GitHub credential for ${verification.username} already exists.` };
  }

  const id = generateId();
  const now = new Date().toISOString();
  const keytarAccount = getDefaultKeytarAccount(id);

  await keytar.setPassword(SERVICE_NAME, keytarAccount, trimmedToken);

  const created: CredentialMetadata = {
    id,
    type: 'github',
    username: verification.username,
    createdAt: now,
    updatedAt: now,
    keytarAccount,
  };

  metadata.push(created);
  await writeCredentialsMetadata(metadata);

  return {
    success: true,
    credential: {
      id: created.id,
      type: 'github',
      username: created.username,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    },
  };
}

export async function createGitLabCredential(
  serverUrl: string,
  token: string,
): Promise<{ success: boolean; credential?: GitLabCredential; error?: string }> {
  const normalizedServerUrl = normalizeGitLabServerUrl(serverUrl);
  const trimmedToken = token.trim();

  if (!normalizedServerUrl) {
    return { success: false, error: 'GitLab server URL is required.' };
  }

  try {
    new URL(normalizedServerUrl);
  } catch {
    return { success: false, error: 'GitLab server URL must be a valid URL.' };
  }

  if (!trimmedToken) {
    return { success: false, error: 'GitLab token is required.' };
  }

  let keytar: KeytarModule;
  try {
    keytar = await requireKeytar();
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }

  const verification = await verifyGitLabToken(normalizedServerUrl, trimmedToken);
  if (!verification.valid || !verification.username) {
    return { success: false, error: verification.error || 'Failed to verify GitLab token.' };
  }

  const metadata = await readCredentialsMetadata();
  const duplicate = metadata.find((credential) => (
    credential.type === 'gitlab'
    && credential.username === verification.username
    && credential.serverUrl === normalizedServerUrl
  ));

  if (duplicate) {
    return {
      success: false,
      error: `A GitLab credential for ${verification.username} on ${normalizedServerUrl} already exists.`,
    };
  }

  const id = generateId();
  const now = new Date().toISOString();
  const keytarAccount = getDefaultKeytarAccount(id);

  await keytar.setPassword(SERVICE_NAME, keytarAccount, trimmedToken);

  const created: CredentialMetadata = {
    id,
    type: 'gitlab',
    username: verification.username,
    serverUrl: normalizedServerUrl,
    createdAt: now,
    updatedAt: now,
    keytarAccount,
  };

  metadata.push(created);
  await writeCredentialsMetadata(metadata);

  return {
    success: true,
    credential: {
      id: created.id,
      type: 'gitlab',
      username: created.username,
      serverUrl: created.serverUrl || normalizedServerUrl,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    },
  };
}

export async function deleteCredential(id: string): Promise<{ success: boolean; error?: string }> {
  const metadata = await readCredentialsMetadata();
  const index = metadata.findIndex((credential) => credential.id === id);

  if (index === -1) {
    return { success: false, error: 'Credential not found.' };
  }

  const credential = metadata[index];
  metadata.splice(index, 1);
  await writeCredentialsMetadata(metadata);

  const keytar = await loadKeytar();
  if (keytar) {
    await keytar.deletePassword(SERVICE_NAME, getKeytarAccountForMetadata(credential));
  }

  return { success: true };
}

export async function updateCredential(id: string, token: string): Promise<{ success: boolean; credential?: Credential; error?: string }> {
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    return { success: false, error: 'Token is required.' };
  }

  let keytar: KeytarModule;
  try {
    keytar = await requireKeytar();
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }

  const metadata = await readCredentialsMetadata();
  const index = metadata.findIndex((c) => c.id === id);

  if (index === -1) {
    return { success: false, error: 'Credential not found' };
  }

  const existing = metadata[index];

  // Verify the new token
  let verification;
  if (existing.type === 'github') {
    verification = await verifyGitHubToken(trimmedToken);
  } else {
    verification = await verifyGitLabToken(existing.serverUrl || 'https://gitlab.com', trimmedToken);
  }

  if (!verification.valid || !verification.username) {
    return { success: false, error: verification.error || 'Failed to verify token' };
  }

  // Update token in keytar
  await keytar.setPassword(SERVICE_NAME, getKeytarAccountForMetadata(existing), trimmedToken);

  // Update metadata
  const now = new Date().toISOString();
  metadata[index] = {
    ...existing,
    username: verification.username,
    updatedAt: now,
  };
  await writeCredentialsMetadata(metadata);

  return {
    success: true,
    credential: toCredential(metadata[index]),
  };
}

export async function findCredentialForRemote(remoteUrl: string): Promise<{ credential: Credential; token: string } | null> {
  const credentials = await getAllCredentials();

  // Check if it's a GitHub URL
  if (remoteUrl.includes('github.com')) {
    const githubCred = credentials.find((c) => c.type === 'github');
    if (githubCred) {
      const token = await getCredentialToken(githubCred.id);
      if (token) {
        return { credential: githubCred, token };
      }
    }
  }

  // Check GitLab servers
  for (const cred of credentials) {
    if (cred.type === 'gitlab') {
      // Extract host from remote URL
      let host: string;
      try {
        if (remoteUrl.startsWith('git@')) {
          // SSH URL: git@gitlab.com:user/repo.git
          host = remoteUrl.split('@')[1].split(':')[0];
        } else {
          // HTTP URL
          host = new URL(remoteUrl).host;
        }
      } catch {
        continue;
      }

      // Check if the credential's server URL matches
      const credHost = new URL(cred.serverUrl).host;
      if (host === credHost) {
        const token = await getCredentialToken(cred.id);
        if (token) {
          return { credential: cred, token };
        }
      }
    }
  }

  return null;
}
