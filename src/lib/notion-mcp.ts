import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  defaultSpawnEnv,
  readCommandOutput,
  resolveExecutable,
} from '@/lib/agent/common';

const NOTION_MCP_SERVER_NAME = 'notion';
const NOTION_MCP_SERVER_URL = 'https://mcp.notion.com/mcp';
const NOTION_LOGIN_URL_PATTERN = /https:\/\/\S+/g;
const NOTION_AUTH_SESSION_TTL_MS = 15 * 60 * 1000;
const NOTION_AUTH_URL_WAIT_TIMEOUT_MS = 10 * 1000;

type CodexMcpServer = {
  name?: string;
  auth_status?: string | null;
};

type ActiveNotionAuthSession = {
  child: ChildProcessWithoutNullStreams;
  authUrl: string;
  startedAt: number;
};

export type EnsureNotionMcpSetupResult = {
  status: 'ready' | 'auth_started' | 'auth_in_progress';
  authUrl?: string;
  addedServer: boolean;
};

let activeNotionAuthSession: ActiveNotionAuthSession | null = null;

function getCodexExecutable(env: NodeJS.ProcessEnv): string {
  return resolveExecutable(['codex', 'codex.cmd'], env);
}

function parseMcpServersJson(value: string): CodexMcpServer[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is CodexMcpServer => (
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
    ));
  } catch {
    return [];
  }
}

function resolveNotionServerEntry(servers: CodexMcpServer[]): CodexMcpServer | null {
  return servers.find((server) => server.name === NOTION_MCP_SERVER_NAME) || null;
}

function isNotionAuthenticated(entry: CodexMcpServer | null): boolean {
  if (!entry) return false;
  const authStatus = (entry.auth_status || '').trim().toLowerCase();
  if (!authStatus) return false;
  return authStatus === 'authenticated' || authStatus === 'unsupported';
}

function getActiveNotionAuthUrl(): string | null {
  if (!activeNotionAuthSession) return null;

  const isExpired = Date.now() - activeNotionAuthSession.startedAt > NOTION_AUTH_SESSION_TTL_MS;
  if (isExpired || activeNotionAuthSession.child.exitCode !== null) {
    activeNotionAuthSession = null;
    return null;
  }

  return activeNotionAuthSession.authUrl;
}

async function listCodexMcpServers(env: NodeJS.ProcessEnv): Promise<CodexMcpServer[]> {
  const command = getCodexExecutable(env);
  const result = await readCommandOutput(command, ['mcp', 'list', '--json'], env);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || 'Failed to list Codex MCP servers.');
  }

  const parsed = parseMcpServersJson(result.stdout);
  if (parsed.length > 0) return parsed;
  if (!result.stdout.trim()) return [];

  throw new Error('Codex MCP list returned unexpected JSON output.');
}

async function ensureNotionServerConfigured(env: NodeJS.ProcessEnv): Promise<boolean> {
  const servers = await listCodexMcpServers(env);
  if (resolveNotionServerEntry(servers)) {
    return false;
  }

  const command = getCodexExecutable(env);
  const addResult = await readCommandOutput(
    command,
    ['mcp', 'add', NOTION_MCP_SERVER_NAME, '--url', NOTION_MCP_SERVER_URL],
    env,
  );

  if (addResult.exitCode !== 0) {
    throw new Error(addResult.stderr || 'Failed to configure Notion MCP server.');
  }

  return true;
}

function extractNotionAuthUrl(text: string): string | null {
  const matches = text.match(NOTION_LOGIN_URL_PATTERN);
  if (!matches || matches.length === 0) return null;

  for (const candidate of matches) {
    if (!candidate.toLowerCase().includes('notion.com/authorize')) continue;
    return candidate;
  }

  return matches[0] || null;
}

async function startNotionLoginAndReadAuthUrl(env: NodeJS.ProcessEnv): Promise<string> {
  const activeUrl = getActiveNotionAuthUrl();
  if (activeUrl) {
    return activeUrl;
  }

  const command = getCodexExecutable(env);
  const child = spawn(command, ['mcp', 'login', NOTION_MCP_SERVER_NAME], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      fail(new Error('Timed out while waiting for Notion authentication URL.'));
    }, NOTION_AUTH_URL_WAIT_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.removeListener('data', handleData);
      child.stderr.removeListener('data', handleData);
      child.removeListener('error', handleError);
      child.removeListener('close', handleClose);
    };

    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (child.exitCode === null) {
        child.kill('SIGTERM');
      }
      reject(error);
    };

    const handleData = (chunk: string) => {
      const authUrl = extractNotionAuthUrl(chunk);
      if (!authUrl) return;

      activeNotionAuthSession = {
        child,
        authUrl,
        startedAt: Date.now(),
      };
      child.once('close', () => {
        if (activeNotionAuthSession?.child === child) {
          activeNotionAuthSession = null;
        }
      });
      finish(authUrl);
    };

    const handleError = (error: Error) => {
      fail(error);
    };

    const handleClose = (code: number | null) => {
      fail(new Error(`Notion authentication process exited before returning an auth URL (code ${code ?? 'unknown'}).`));
    };

    child.stdout.on('data', handleData);
    child.stderr.on('data', handleData);
    child.once('error', handleError);
    child.once('close', handleClose);
  });
}

export async function ensureNotionMcpSetupAndAuthStarted(): Promise<EnsureNotionMcpSetupResult> {
  const env = defaultSpawnEnv();
  const addedServer = await ensureNotionServerConfigured(env);

  const serversAfterSetup = await listCodexMcpServers(env);
  const notionServer = resolveNotionServerEntry(serversAfterSetup);
  if (isNotionAuthenticated(notionServer)) {
    return {
      status: 'ready',
      addedServer,
    };
  }

  const activeUrl = getActiveNotionAuthUrl();
  if (activeUrl) {
    return {
      status: 'auth_in_progress',
      authUrl: activeUrl,
      addedServer,
    };
  }

  const authUrl = await startNotionLoginAndReadAuthUrl(env);
  return {
    status: 'auth_started',
    authUrl,
    addedServer,
  };
}
