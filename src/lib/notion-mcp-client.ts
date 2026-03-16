export type NotionMcpSetupResponse = {
  status: 'ready' | 'auth_started' | 'auth_in_progress';
  authUrl?: string;
  addedServer: boolean;
};

export async function startNotionMcpSetup(): Promise<NotionMcpSetupResponse> {
  const response = await fetch('/api/integrations/notion/setup', {
    method: 'POST',
  });

  const payload = await response.json().catch(() => null) as (
    NotionMcpSetupResponse | { error?: string } | null
  );

  if (!response.ok || !payload || typeof payload !== 'object' || !('status' in payload)) {
    const errorMessage = payload
      && typeof payload === 'object'
      && 'error' in payload
      && typeof payload.error === 'string'
        ? payload.error
        : 'Failed to initialize Notion MCP integration.';
    throw new Error(errorMessage);
  }

  return payload;
}
