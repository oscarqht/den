'use server';

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import simpleGit from 'simple-git';
import { getErrorMessage } from '../../lib/error-utils';
import { prepareSessionWorktree, removeWorktree, terminateSessionTerminalSessions } from './git';

export type SessionMetadata = {
  sessionName: string;
  repoPath: string;
  worktreePath: string;
  branchName: string;
  baseBranch?: string;
  agent: string;
  model: string;
  title?: string;
  devServerScript?: string;
  initialized?: boolean;
  timestamp: string;
};

export type SessionLaunchContext = {
  sessionName: string;
  title?: string;
  initialMessage?: string;
  rawInitialMessage?: string;
  startupScript?: string;
  attachmentNames?: string[];
  agentProvider?: string;
  model?: string;
  sessionMode?: 'fast' | 'plan';
  isResume?: boolean;
  timestamp: string;
};

export type SessionPrefillContext = {
  sourceSessionName: string;
  repoPath: string;
  title?: string;
  initialMessage?: string;
  attachmentNames: string[];
  agentProvider: string;
  model: string;
};

export type SessionAgentReplyEvent = {
  sessionName: string;
  timestamp: number;
  createdAt?: string;
  source?: string;
  tool?: string;
};

const VIBA_MCP_SERVER_NAME = 'viba_notify';
const VIBA_MCP_TOOL_NAME = 'viba_notify_reply_done';

function sanitizeSessionNameForFile(value: string): string {
  const safe = value.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe || 'session';
}

async function getSessionsDir(): Promise<string> {
  const homedir = os.homedir();
  const sessionsDir = path.join(homedir, '.viba', 'sessions');
  try {
    await fs.mkdir(sessionsDir, { recursive: true });
  } catch {
    // Ignore if exists
  }
  return sessionsDir;
}

async function getSessionContextsDir(): Promise<string> {
  const homedir = os.homedir();
  const contextsDir = path.join(homedir, '.viba', 'session-contexts');
  try {
    await fs.mkdir(contextsDir, { recursive: true });
  } catch {
    // Ignore if exists
  }
  return contextsDir;
}

async function getSessionContextFilePath(sessionName: string): Promise<string> {
  const contextsDir = await getSessionContextsDir();
  return path.join(contextsDir, `${sessionName}.json`);
}

async function getSessionPromptsDir(): Promise<string> {
  const homedir = os.homedir();
  const promptsDir = path.join(homedir, '.viba', 'session-prompts');
  try {
    await fs.mkdir(promptsDir, { recursive: true });
  } catch {
    // Ignore if exists
  }
  return promptsDir;
}

async function getSessionAgentEventsDir(): Promise<string> {
  const homedir = os.homedir();
  const eventsDir = path.join(homedir, '.viba', 'session-agent-events');
  try {
    await fs.mkdir(eventsDir, { recursive: true });
  } catch {
    // Ignore if exists
  }
  return eventsDir;
}

async function getSessionAgentEventFilePath(sessionName: string): Promise<string> {
  const eventsDir = await getSessionAgentEventsDir();
  return path.join(eventsDir, `${sanitizeSessionNameForFile(sessionName)}.jsonl`);
}

async function upsertJsonFile(
  filePath: string,
  update: (current: Record<string, unknown>) => Record<string, unknown>
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  let current: Record<string, unknown> = {};
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      current = parsed as Record<string, unknown>;
    }
  } catch (error: unknown) {
    const errorCode =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: string }).code
        : undefined;
    if (errorCode !== 'ENOENT') {
      throw error;
    }
  }

  const next = update(current);
  await fs.writeFile(filePath, JSON.stringify(next, null, 2), 'utf-8');
}

export async function saveSessionMetadata(metadata: SessionMetadata): Promise<void> {
  const sessionsDir = await getSessionsDir();
  const filePath = path.join(sessionsDir, `${metadata.sessionName}.json`);
  await fs.writeFile(filePath, JSON.stringify(metadata, null, 2), 'utf-8');
}

export async function writeSessionPromptFile(
  sessionName: string,
  prompt: string
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    const promptsDir = await getSessionPromptsDir();
    const filePath = path.join(promptsDir, `${sessionName}.txt`);
    await fs.writeFile(filePath, prompt, 'utf-8');
    return { success: true, filePath };
  } catch (e: unknown) {
    console.error('Failed to write session prompt file:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

async function ensureGeminiMcpServerConfigured(serverScriptPath: string): Promise<void> {
  const settingsPath = path.join(os.homedir(), '.gemini', 'settings.json');
  await upsertJsonFile(settingsPath, (current) => {
    const existingServers =
      current.mcpServers && typeof current.mcpServers === 'object' && !Array.isArray(current.mcpServers)
        ? { ...(current.mcpServers as Record<string, unknown>) }
        : {};

    existingServers[VIBA_MCP_SERVER_NAME] = {
      command: 'node',
      args: [serverScriptPath],
    };

    return {
      ...current,
      mcpServers: existingServers,
    };
  });
}

async function ensureCursorMcpServerConfigured(serverScriptPath: string): Promise<void> {
  const mcpPath = path.join(os.homedir(), '.cursor', 'mcp.json');
  await upsertJsonFile(mcpPath, (current) => {
    const existingServers =
      current.mcpServers && typeof current.mcpServers === 'object' && !Array.isArray(current.mcpServers)
        ? { ...(current.mcpServers as Record<string, unknown>) }
        : {};

    existingServers[VIBA_MCP_SERVER_NAME] = {
      command: 'node',
      args: [serverScriptPath],
    };

    return {
      ...current,
      mcpServers: existingServers,
    };
  });
}

export async function prepareSessionAgentReplyMcp(
  sessionName: string,
  agentCli: string
): Promise<{ success: boolean; enabled: boolean; instruction?: string; error?: string }> {
  const normalizedAgent = agentCli.trim().toLowerCase();
  const isCodex = normalizedAgent.includes('codex');
  const isGemini = normalizedAgent.includes('gemini');
  const isCursorAgent = normalizedAgent === 'agent' || normalizedAgent.includes('cursor');

  if (!isCodex && !isGemini && !isCursorAgent) {
    return { success: true, enabled: false };
  }

  try {
    const serverScriptPath = path.join(process.cwd(), 'bin', 'viba-agent-mcp.mjs');
    await fs.access(serverScriptPath);

    if (isCodex) {
      const result = spawnSync('codex', ['mcp', 'add', VIBA_MCP_SERVER_NAME, '--', 'node', serverScriptPath], {
        encoding: 'utf8',
      });
      if ((result.status ?? 1) !== 0) {
        return {
          success: false,
          enabled: false,
          error: (result.stderr || result.stdout || 'Failed to configure Codex MCP server.').trim(),
        };
      }
    }

    if (isGemini) {
      await ensureGeminiMcpServerConfigured(serverScriptPath);
    }

    if (isCursorAgent) {
      await ensureCursorMcpServerConfigured(serverScriptPath);
      const enableResult = spawnSync('agent', ['mcp', 'enable', VIBA_MCP_SERVER_NAME], { encoding: 'utf8' });
      if ((enableResult.status ?? 1) !== 0) {
        console.warn(
          `Failed to auto-enable Cursor MCP server "${VIBA_MCP_SERVER_NAME}":`,
          (enableResult.stderr || enableResult.stdout || '').trim()
        );
      }
    }

    const instruction =
      `After each completed reply, call MCP tool "${VIBA_MCP_TOOL_NAME}" with JSON arguments ` +
      `{"session_name":"${sessionName}"}.`;

    return {
      success: true,
      enabled: true,
      instruction,
    };
  } catch (e: unknown) {
    console.error('Failed to configure session MCP notifications:', e);
    return {
      success: false,
      enabled: false,
      error: getErrorMessage(e),
    };
  }
}

export async function readSessionAgentReplyEvents(
  sessionName: string,
  sinceTimestamp: number
): Promise<{ success: boolean; events: SessionAgentReplyEvent[]; latestTimestamp: number; error?: string }> {
  const safeSince = Number.isFinite(sinceTimestamp) ? Math.max(0, Math.floor(sinceTimestamp)) : 0;
  try {
    const filePath = await getSessionAgentEventFilePath(sessionName);
    let content = '';
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (e: unknown) {
      const errorCode =
        typeof e === 'object' && e !== null && 'code' in e
          ? (e as { code?: string }).code
          : undefined;
      if (errorCode === 'ENOENT') {
        return { success: true, events: [], latestTimestamp: safeSince };
      }
      throw e;
    }

    const events: SessionAgentReplyEvent[] = [];
    let latestTimestamp = safeSince;
    const lines = content.split('\n');

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      try {
        const parsed = JSON.parse(line) as unknown;
        if (!parsed || typeof parsed !== 'object') continue;

        const event = parsed as SessionAgentReplyEvent;
        if (typeof event.timestamp !== 'number' || !Number.isFinite(event.timestamp)) continue;
        if (event.timestamp > latestTimestamp) latestTimestamp = event.timestamp;
        if (event.timestamp <= safeSince) continue;
        events.push(event);
      } catch {
        // Ignore malformed lines so one bad entry does not break polling.
      }
    }

    events.sort((a, b) => a.timestamp - b.timestamp);
    return { success: true, events, latestTimestamp };
  } catch (e: unknown) {
    console.error('Failed to read session agent reply events:', e);
    return { success: false, events: [], latestTimestamp: safeSince, error: getErrorMessage(e) };
  }
}

export async function saveSessionLaunchContext(
  sessionName: string,
  context: Omit<SessionLaunchContext, 'sessionName' | 'timestamp'>
): Promise<{ success: boolean; error?: string }> {
  try {
    const filePath = await getSessionContextFilePath(sessionName);
    const contextData: SessionLaunchContext = {
      sessionName,
      ...context,
      timestamp: new Date().toISOString(),
    };
    await fs.writeFile(filePath, JSON.stringify(contextData, null, 2), 'utf-8');
    return { success: true };
  } catch (e: unknown) {
    console.error('Failed to save session launch context:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function consumeSessionLaunchContext(
  sessionName: string
): Promise<{ success: boolean; context?: SessionLaunchContext; error?: string }> {
  try {
    const filePath = await getSessionContextFilePath(sessionName);
    const content = await fs.readFile(filePath, 'utf-8');
    const context = JSON.parse(content) as SessionLaunchContext;
    return { success: true, context };
  } catch (e: unknown) {
    const errorCode =
      typeof e === 'object' && e !== null && 'code' in e
        ? (e as { code?: string }).code
        : undefined;
    if (errorCode === 'ENOENT') {
      return { success: true };
    }
    console.error('Failed to consume session launch context:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

async function getSessionLaunchContext(
  sessionName: string
): Promise<{ success: boolean; context?: SessionLaunchContext; error?: string }> {
  try {
    const filePath = await getSessionContextFilePath(sessionName);
    const content = await fs.readFile(filePath, 'utf-8');
    const context = JSON.parse(content) as SessionLaunchContext;
    return { success: true, context };
  } catch (e: unknown) {
    const errorCode =
      typeof e === 'object' && e !== null && 'code' in e
        ? (e as { code?: string }).code
        : undefined;
    if (errorCode === 'ENOENT') {
      return { success: true };
    }
    console.error('Failed to read session launch context:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function getSessionPrefillContext(
  sessionName: string
): Promise<{ success: boolean; context?: SessionPrefillContext; error?: string }> {
  const metadata = await getSessionMetadata(sessionName);
  if (!metadata) {
    return { success: false, error: 'Session metadata not found' };
  }

  const launchContextResult = await getSessionLaunchContext(sessionName);
  if (!launchContextResult.success) {
    return { success: false, error: launchContextResult.error || 'Failed to load session launch context' };
  }

  const launchContext = launchContextResult.context;
  const prefill: SessionPrefillContext = {
    sourceSessionName: sessionName,
    repoPath: metadata.repoPath,
    title: launchContext?.title || metadata.title,
    initialMessage: launchContext?.rawInitialMessage || launchContext?.initialMessage,
    attachmentNames: launchContext?.attachmentNames || [],
    agentProvider: launchContext?.agentProvider || metadata.agent,
    model: launchContext?.model || metadata.model,
  };

  return { success: true, context: prefill };
}

export async function copySessionAttachments(
  sourceSessionName: string,
  targetWorktreePath: string,
  requestedAttachmentNames: string[]
): Promise<{ success: boolean; copiedAttachmentNames: string[]; missingAttachmentNames: string[]; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sourceSessionName);
    if (!metadata) {
      return {
        success: false,
        copiedAttachmentNames: [],
        missingAttachmentNames: [],
        error: 'Source session metadata not found',
      };
    }

    const sourceAttachmentsDir = `${metadata.worktreePath}-attachments`;
    const targetAttachmentsDir = `${targetWorktreePath}-attachments`;
    await fs.mkdir(targetAttachmentsDir, { recursive: true });

    const copiedAttachmentNames: string[] = [];
    const missingAttachmentNames: string[] = [];
    const dedupedRequestedNames = Array.from(
      new Set(requestedAttachmentNames.map((name) => name.trim()).filter(Boolean))
    );

    for (const name of dedupedRequestedNames) {
      const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const sourcePath = path.join(sourceAttachmentsDir, safeName);
      const targetPath = path.join(targetAttachmentsDir, safeName);

      try {
        await fs.copyFile(sourcePath, targetPath);
        copiedAttachmentNames.push(safeName);
      } catch (e: unknown) {
        const errorCode =
          typeof e === 'object' && e !== null && 'code' in e
            ? (e as { code?: string }).code
            : undefined;

        if (errorCode === 'ENOENT') {
          missingAttachmentNames.push(name);
          continue;
        }

        throw e;
      }
    }

    return { success: true, copiedAttachmentNames, missingAttachmentNames };
  } catch (e: unknown) {
    console.error('Failed to copy session attachments:', e);
    return {
      success: false,
      copiedAttachmentNames: [],
      missingAttachmentNames: [],
      error: getErrorMessage(e),
    };
  }
}

export async function getSessionMetadata(sessionName: string): Promise<SessionMetadata | null> {
  try {
    const sessionsDir = await getSessionsDir();
    const filePath = path.join(sessionsDir, `${sessionName}.json`);
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as SessionMetadata;
  } catch {
    return null;
  }
}

export async function listSessions(repoPath?: string): Promise<SessionMetadata[]> {
  try {
    const sessionsDir = await getSessionsDir();
    const entries = await fs.readdir(sessionsDir);

    const sessionPromises = entries
      .filter((entry) => entry.endsWith('.json'))
      .map(async (entry) => {
        try {
          const filePath = path.join(sessionsDir, entry);
          const content = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(content) as SessionMetadata;
          return data;
        } catch (e) {
          console.error(`Failed to parse session file ${entry}:`, e);
          return null;
        }
      });

    const sessions = (await Promise.all(sessionPromises)).filter((s): s is SessionMetadata => {
      if (!s) return false;
      if (repoPath && s.repoPath !== repoPath) return false;
      return true;
    });

    // Sort by timestamp desc
    return sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  } catch (error) {
    console.error('Failed to list sessions:', error);
    return [];
  }
}

export async function createSession(
  repoPath: string,
  baseBranch: string,
  metadata: { agent: string; model: string; title?: string; devServerScript?: string }
): Promise<{ success: boolean; sessionName?: string; worktreePath?: string; branchName?: string; error?: string }> {
  try {
    // 1. Prepare worktree
    const result = await prepareSessionWorktree(repoPath, baseBranch);

    if (!result.success || !result.sessionName || !result.worktreePath || !result.branchName) {
      return result;
    }

    // 2. Save metadata
    const sessionData: SessionMetadata = {
      sessionName: result.sessionName,
      repoPath,
      worktreePath: result.worktreePath,
      branchName: result.branchName,
      baseBranch,
      agent: metadata.agent,
      model: metadata.model,
      title: metadata.title,
      devServerScript: metadata.devServerScript,
      initialized: false,
      timestamp: new Date().toISOString(),
    };

    await saveSessionMetadata(sessionData);

    return result;
  } catch (e: unknown) {
    console.error("Failed to create session:", e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function markSessionInitialized(sessionName: string): Promise<void> {
  const metadata = await getSessionMetadata(sessionName);
  if (!metadata) return;
  if (metadata.initialized) return;

  metadata.initialized = true;
  await saveSessionMetadata(metadata);
}

export async function deleteSession(sessionName: string): Promise<{ success: boolean; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    // 1. Remove worktree
    const result = await removeWorktree(metadata.repoPath, metadata.worktreePath, metadata.branchName);
    await terminateSessionTerminalSessions(sessionName);
    if (!result.success) {
      return result;
    }

    // 2. Delete metadata file
    const sessionsDir = await getSessionsDir();
    const filePath = path.join(sessionsDir, `${sessionName}.json`);
    await fs.rm(filePath, { force: true });
    const contextFilePath = await getSessionContextFilePath(sessionName);
    await fs.rm(contextFilePath, { force: true });

    // 3. Delete prompt file
    const promptsDir = await getSessionPromptsDir();
    const promptFilePath = path.join(promptsDir, `${sessionName}.txt`);
    await fs.rm(promptFilePath, { force: true });

    // 4. Delete agent reply event file
    const eventFilePath = await getSessionAgentEventFilePath(sessionName);
    await fs.rm(eventFilePath, { force: true });

    return { success: true };
  } catch (e: unknown) {
    console.error("Failed to delete session:", e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function deleteSessionInBackground(sessionName: string): Promise<{ success: boolean; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    // Resolve immediately but continue cleanup in the background.
    // This allows the client to navigate away without the request being cancelled.
    void deleteSession(sessionName).catch((error) => {
      console.error(`Background cleanup of session ${sessionName} failed:`, error);
    });

    return { success: true };
  } catch (e: unknown) {
    console.error('Failed to schedule background session deletion:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function mergeSessionToBase(
  sessionName: string
): Promise<{ success: boolean; branchName?: string; baseBranch?: string; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const baseBranch = metadata.baseBranch?.trim();
    if (!baseBranch) {
      return {
        success: false,
        error: 'Base branch is missing for this session. This session may be from an older version.',
      };
    }

    const worktreeGit = simpleGit(metadata.worktreePath);
    const worktreeStatus = await worktreeGit.status();
    if (!worktreeStatus.isClean()) {
      return {
        success: false,
        error: 'Worktree has uncommitted changes. Commit your changes first.',
      };
    }

    const git = simpleGit(metadata.repoPath);
    const branchSummary = await git.branchLocal();
    if (!branchSummary.all.includes(baseBranch)) {
      return { success: false, error: `Base branch "${baseBranch}" not found in repository.` };
    }
    if (!branchSummary.all.includes(metadata.branchName)) {
      return { success: false, error: `Session branch "${metadata.branchName}" not found in repository.` };
    }

    const originalBranch = branchSummary.current;
    if (originalBranch !== baseBranch) {
      await git.checkout(baseBranch);
    }

    // Always create a merge commit record instead of fast-forwarding.
    await git.merge(['--no-ff', metadata.branchName]);

    if (originalBranch && originalBranch !== baseBranch) {
      await git.checkout(originalBranch);
    }

    return {
      success: true,
      branchName: metadata.branchName,
      baseBranch,
    };
  } catch (e: unknown) {
    console.error('Failed to merge session branch:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function rebaseSessionOntoBase(
  sessionName: string
): Promise<{ success: boolean; branchName?: string; baseBranch?: string; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const baseBranch = metadata.baseBranch?.trim();
    if (!baseBranch) {
      return {
        success: false,
        error: 'Base branch is missing for this session. This session may be from an older version.',
      };
    }

    const worktreeGit = simpleGit(metadata.worktreePath);
    const worktreeStatus = await worktreeGit.status();
    if (!worktreeStatus.isClean()) {
      return {
        success: false,
        error: 'Worktree has uncommitted changes. Commit your changes first.',
      };
    }

    const repoGit = simpleGit(metadata.repoPath);
    const branchSummary = await repoGit.branchLocal();
    if (!branchSummary.all.includes(baseBranch)) {
      return { success: false, error: `Base branch "${baseBranch}" not found in repository.` };
    }
    if (!branchSummary.all.includes(metadata.branchName)) {
      return { success: false, error: `Session branch "${metadata.branchName}" not found in repository.` };
    }

    const worktreeBranchSummary = await worktreeGit.branchLocal();
    if (worktreeBranchSummary.current !== metadata.branchName) {
      await worktreeGit.checkout(metadata.branchName);
    }

    await worktreeGit.rebase([baseBranch]);

    return {
      success: true,
      branchName: metadata.branchName,
      baseBranch,
    };
  } catch (e: unknown) {
    console.error('Failed to rebase session branch:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function getSessionUncommittedFileCount(
  sessionName: string
): Promise<{ success: boolean; count?: number; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const git = simpleGit(metadata.worktreePath);
    const status = await git.status();

    return { success: true, count: status.files.length };
  } catch (e: unknown) {
    console.error('Failed to get uncommitted file count:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function getSessionDivergence(
  sessionName: string
): Promise<{ success: boolean; ahead?: number; behind?: number; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const baseBranch = metadata.baseBranch?.trim();
    if (!baseBranch) {
      return { success: false, error: 'Base branch is unavailable for this session.' };
    }

    const git = simpleGit(metadata.repoPath);
    const branchSummary = await git.branchLocal();
    if (!branchSummary.all.includes(baseBranch)) {
      return { success: false, error: `Base branch "${baseBranch}" not found in repository.` };
    }
    if (!branchSummary.all.includes(metadata.branchName)) {
      return { success: false, error: `Session branch "${metadata.branchName}" not found in repository.` };
    }

    const rawCounts = await git.raw(['rev-list', '--left-right', '--count', `${baseBranch}...${metadata.branchName}`]);
    const [behindRaw, aheadRaw] = rawCounts.trim().split(/\s+/);
    const behind = Number.parseInt(behindRaw, 10);
    const ahead = Number.parseInt(aheadRaw, 10);

    if (Number.isNaN(behind) || Number.isNaN(ahead)) {
      return { success: false, error: 'Failed to parse git divergence output.' };
    }

    return { success: true, ahead, behind };
  } catch (e: unknown) {
    console.error('Failed to get session divergence:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function listSessionBaseBranches(
  sessionName: string
): Promise<{ success: boolean; baseBranch?: string; branches?: string[]; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const git = simpleGit(metadata.repoPath);
    const branchSummary = await git.branchLocal();
    const branches = [...branchSummary.all].sort((a, b) => a.localeCompare(b));
    const baseBranch = metadata.baseBranch?.trim();

    return { success: true, baseBranch, branches };
  } catch (e: unknown) {
    console.error('Failed to list session base branches:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function updateSessionBaseBranch(
  sessionName: string,
  baseBranch: string
): Promise<{ success: boolean; baseBranch?: string; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const nextBaseBranch = baseBranch.trim();
    if (!nextBaseBranch) {
      return { success: false, error: 'Base branch cannot be empty.' };
    }

    const git = simpleGit(metadata.repoPath);
    const branchSummary = await git.branchLocal();
    if (!branchSummary.all.includes(nextBaseBranch)) {
      return { success: false, error: `Base branch "${nextBaseBranch}" not found in repository.` };
    }

    metadata.baseBranch = nextBaseBranch;
    await saveSessionMetadata(metadata);

    return { success: true, baseBranch: nextBaseBranch };
  } catch (e: unknown) {
    console.error('Failed to update session base branch:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}
