import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const SERVICE_NAME = 'viba-git-credentials';
const CREDENTIALS_FILE_NAME = 'credentials.json';

export type CredentialType = 'github' | 'gitlab';

export interface BaseCredential {
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
  type: CredentialType;
  username: string;
  serverUrl?: string;
  createdAt: string;
  updatedAt: string;
};

type CredentialMetadataMap = Partial<Record<CredentialType, CredentialMetadata>>;

type KeytarModule = {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
};

let keytarPromise: Promise<KeytarModule | null> | null = null;
let keytarUnavailableReason: string | null = null;
let didLogKeytarWarning = false;

function keytarUnavailableMessage(): string {
  if (keytarUnavailableReason) {
    return `Secure credential storage is unavailable: ${keytarUnavailableReason}`;
  }
  return 'Secure credential storage is unavailable in this runtime.';
}

async function loadKeytar(): Promise<KeytarModule | null> {
  if (!keytarPromise) {
    keytarPromise = import('keytar')
      .then((module) => (module.default ?? module) as KeytarModule)
      .catch((error: unknown) => {
        keytarUnavailableReason = error instanceof Error ? error.message : String(error);
        if (!didLogKeytarWarning) {
          didLogKeytarWarning = true;
          console.warn(`[credentials] ${keytarUnavailableMessage()}`);
        }
        return null;
      });
  }

  return keytarPromise;
}

async function requireKeytar(): Promise<KeytarModule> {
  const keytar = await loadKeytar();
  if (!keytar) {
    throw new Error(keytarUnavailableMessage());
  }
  return keytar;
}

function getKeytarAccount(type: CredentialType): string {
  return `credential-${type}`;
}

function normalizeGitLabServerUrl(serverUrl: string): string {
  return serverUrl.trim().replace(/\/$/, '');
}

async function getCredentialsFilePath(): Promise<string> {
  const vibaDir = path.join(os.homedir(), '.viba');
  await fs.mkdir(vibaDir, { recursive: true });
  return path.join(vibaDir, CREDENTIALS_FILE_NAME);
}

function isCredentialMetadata(value: unknown, expectedType: CredentialType): value is CredentialMetadata {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Record<string, unknown>;
  if (candidate.type !== expectedType) return false;
  if (typeof candidate.username !== 'string') return false;
  if (typeof candidate.createdAt !== 'string') return false;
  if (typeof candidate.updatedAt !== 'string') return false;

  if (expectedType === 'gitlab') {
    return typeof candidate.serverUrl === 'string';
  }

  return true;
}

async function readCredentialsMetadata(): Promise<CredentialMetadataMap> {
  const credentialsFilePath = await getCredentialsFilePath();

  try {
    const content = await fs.readFile(credentialsFilePath, 'utf-8');
    const parsed = JSON.parse(content) as unknown;

    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    const mapped = parsed as Record<string, unknown>;
    const result: CredentialMetadataMap = {};

    if (isCredentialMetadata(mapped.github, 'github')) {
      result.github = mapped.github;
    }

    if (isCredentialMetadata(mapped.gitlab, 'gitlab')) {
      result.gitlab = mapped.gitlab;
    }

    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return {};
    }

    console.error('Failed to parse credentials metadata:', error);
    return {};
  }
}

async function writeCredentialsMetadata(metadata: CredentialMetadataMap): Promise<void> {
  const credentialsFilePath = await getCredentialsFilePath();
  await fs.writeFile(credentialsFilePath, JSON.stringify(metadata, null, 2), 'utf-8');
}

export async function getAllCredentials(): Promise<Credential[]> {
  const metadata = await readCredentialsMetadata();
  const credentials: Credential[] = [];

  if (metadata.github) {
    credentials.push({
      type: 'github',
      username: metadata.github.username,
      createdAt: metadata.github.createdAt,
      updatedAt: metadata.github.updatedAt,
    });
  }

  if (metadata.gitlab) {
    credentials.push({
      type: 'gitlab',
      username: metadata.gitlab.username,
      serverUrl: metadata.gitlab.serverUrl || 'https://gitlab.com',
      createdAt: metadata.gitlab.createdAt,
      updatedAt: metadata.gitlab.updatedAt,
    });
  }

  return credentials;
}

export async function getCredentialByType(type: CredentialType): Promise<Credential | null> {
  const credentials = await getAllCredentials();
  return credentials.find((credential) => credential.type === type) || null;
}

export async function getCredentialToken(type: CredentialType): Promise<string | null> {
  const keytar = await loadKeytar();
  if (!keytar) {
    return null;
  }

  return keytar.getPassword(SERVICE_NAME, getKeytarAccount(type));
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

export async function upsertGitHubCredential(token: string): Promise<{ success: boolean; credential?: GitHubCredential; error?: string }> {
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
  const now = new Date().toISOString();
  const createdAt = metadata.github?.createdAt || now;

  await keytar.setPassword(SERVICE_NAME, getKeytarAccount('github'), trimmedToken);

  metadata.github = {
    type: 'github',
    username: verification.username,
    createdAt,
    updatedAt: now,
  };

  await writeCredentialsMetadata(metadata);

  return {
    success: true,
    credential: {
      type: 'github',
      username: verification.username,
      createdAt,
      updatedAt: now,
    },
  };
}

export async function upsertGitLabCredential(
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
  const now = new Date().toISOString();
  const createdAt = metadata.gitlab?.createdAt || now;

  await keytar.setPassword(SERVICE_NAME, getKeytarAccount('gitlab'), trimmedToken);

  metadata.gitlab = {
    type: 'gitlab',
    username: verification.username,
    serverUrl: normalizedServerUrl,
    createdAt,
    updatedAt: now,
  };

  await writeCredentialsMetadata(metadata);

  return {
    success: true,
    credential: {
      type: 'gitlab',
      username: verification.username,
      serverUrl: normalizedServerUrl,
      createdAt,
      updatedAt: now,
    },
  };
}

export async function deleteCredential(type: CredentialType): Promise<{ success: boolean; error?: string }> {
  const metadata = await readCredentialsMetadata();

  if (!metadata[type]) {
    return { success: true };
  }

  delete metadata[type];
  await writeCredentialsMetadata(metadata);

  const keytar = await loadKeytar();
  if (keytar) {
    await keytar.deletePassword(SERVICE_NAME, getKeytarAccount(type));
  }

  return { success: true };
}
