import { createKeytarLoader, type KeytarModule } from './keytar-loader.ts';
import { readLocalState, updateLocalState } from './local-db.ts';

const SERVICE_NAME = 'viba-agent-api-credentials';
const SUPPORTED_AGENT_APIS = ['codex'] as const;

export type AgentApiCredentialAgent = (typeof SUPPORTED_AGENT_APIS)[number];

export interface AgentApiCredential {
  agent: AgentApiCredentialAgent;
  apiProxy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentApiCredentialSecret {
  agent: AgentApiCredentialAgent;
  apiKey: string;
  apiProxy?: string;
}

type AgentApiCredentialMetadata = {
  agent: AgentApiCredentialAgent;
  apiProxy?: string;
  createdAt: string;
  updatedAt: string;
  keytarAccount?: string;
};

const { loadKeytar, requireKeytar } = createKeytarLoader({
  logLabel: 'agent-api-credentials',
});

function isSupportedAgentApi(value: string): value is AgentApiCredentialAgent {
  return SUPPORTED_AGENT_APIS.includes(value as AgentApiCredentialAgent);
}

function getDefaultKeytarAccount(agent: AgentApiCredentialAgent): string {
  return `agent-api-${agent}`;
}

function getKeytarAccountForMetadata(
  metadata: AgentApiCredentialMetadata,
): string {
  return metadata.keytarAccount || getDefaultKeytarAccount(metadata.agent);
}

function normalizeApiProxy(apiProxy: string): string | undefined {
  const trimmed = apiProxy.trim();
  if (!trimmed) return undefined;

  try {
    // Validate and persist as-entered once it is a valid URL.
    new URL(trimmed);
  } catch {
    throw new Error('API proxy must be a valid URL.');
  }

  return trimmed;
}

function toAgentApiCredential(
  metadata: AgentApiCredentialMetadata,
): AgentApiCredential {
  return {
    agent: metadata.agent,
    apiProxy: metadata.apiProxy,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
  };
}

async function writeAgentApiCredentialMetadata(
  metadata: AgentApiCredentialMetadata[],
): Promise<void> {
  updateLocalState((state) => {
    state.agentApiCredentialsMetadata = metadata.map((row) => ({
      agent: row.agent,
      apiProxy: row.apiProxy ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      keytarAccount: row.keytarAccount ?? null,
    }));
  });
}

async function readAgentApiCredentialMetadata(): Promise<
  AgentApiCredentialMetadata[]
> {
  try {
    return readLocalState().agentApiCredentialsMetadata
      .filter((row): row is typeof row & { agent: AgentApiCredentialAgent } =>
        isSupportedAgentApi(row.agent),
      )
      .map((row) => ({
        agent: row.agent,
        apiProxy: row.apiProxy ?? undefined,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        keytarAccount: row.keytarAccount ?? undefined,
      }));
  } catch (error) {
    console.error('Failed to read agent API credential metadata:', error);
    return [];
  }
}

export async function getAllAgentApiCredentials(): Promise<
  AgentApiCredential[]
> {
  const metadata = await readAgentApiCredentialMetadata();
  return metadata
    .map(toAgentApiCredential)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createOrUpdateAgentApiCredential(
  agent: AgentApiCredentialAgent,
  apiKey: string,
  apiProxy: string,
): Promise<{
  success: boolean;
  credential?: AgentApiCredential;
  error?: string;
}> {
  if (!isSupportedAgentApi(agent)) {
    return { success: false, error: `Unsupported agent: ${agent}` };
  }

  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    return { success: false, error: 'API key is required.' };
  }

  let normalizedApiProxy: string | undefined;
  try {
    normalizedApiProxy = normalizeApiProxy(apiProxy);
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }

  let keytar: KeytarModule;
  try {
    keytar = await requireKeytar();
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }

  const metadata = await readAgentApiCredentialMetadata();
  const now = new Date().toISOString();
  const index = metadata.findIndex((credential) => credential.agent === agent);
  const keytarAccount =
    index >= 0
      ? getKeytarAccountForMetadata(metadata[index])
      : getDefaultKeytarAccount(agent);

  await keytar.setPassword(SERVICE_NAME, keytarAccount, trimmedApiKey);

  if (index >= 0) {
    const existing = metadata[index];
    metadata[index] = {
      ...existing,
      apiProxy: normalizedApiProxy,
      updatedAt: now,
      keytarAccount,
    };
  } else {
    metadata.push({
      agent,
      apiProxy: normalizedApiProxy,
      createdAt: now,
      updatedAt: now,
      keytarAccount,
    });
  }

  await writeAgentApiCredentialMetadata(metadata);

  const saved = metadata.find((credential) => credential.agent === agent);
  if (!saved) {
    return { success: false, error: 'Failed to persist agent API credential.' };
  }

  return { success: true, credential: toAgentApiCredential(saved) };
}

export async function deleteAgentApiCredential(
  agent: AgentApiCredentialAgent,
): Promise<{ success: boolean; error?: string }> {
  if (!isSupportedAgentApi(agent)) {
    return { success: false, error: `Unsupported agent: ${agent}` };
  }

  const metadata = await readAgentApiCredentialMetadata();
  const index = metadata.findIndex((credential) => credential.agent === agent);
  if (index === -1) {
    return { success: false, error: 'Agent API credential not found.' };
  }

  const [removed] = metadata.splice(index, 1);
  await writeAgentApiCredentialMetadata(metadata);

  const keytar = await loadKeytar();
  if (keytar) {
    await keytar.deletePassword(
      SERVICE_NAME,
      getKeytarAccountForMetadata(removed),
    );
  }

  return { success: true };
}

export async function getAgentApiCredentialSecret(
  agent: AgentApiCredentialAgent,
): Promise<AgentApiCredentialSecret | null> {
  if (!isSupportedAgentApi(agent)) {
    return null;
  }

  const metadata = await readAgentApiCredentialMetadata();
  const found = metadata.find((credential) => credential.agent === agent);
  if (!found) {
    return null;
  }

  const keytar = await loadKeytar();
  if (!keytar) {
    return null;
  }

  const apiKey = await keytar.getPassword(
    SERVICE_NAME,
    getKeytarAccountForMetadata(found),
  );
  if (!apiKey) {
    return null;
  }

  return {
    agent: found.agent,
    apiKey,
    apiProxy: found.apiProxy,
  };
}
