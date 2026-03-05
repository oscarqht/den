'use server';

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import simpleGit from 'simple-git';
import { getErrorMessage } from '../../lib/error-utils';
import { prepareSessionWorktree, removeWorktree, terminateSessionTerminalSessions } from './git';
import { getLocalDb } from '@/lib/local-db';
import { publishSessionListUpdated } from '@/lib/sessionNotificationServer';

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
  attachmentPaths?: string[];
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
  attachmentPaths: string[];
  agentProvider: string;
  model: string;
};

type SessionRow = {
  session_name: string;
  repo_path: string;
  worktree_path: string;
  branch_name: string;
  base_branch: string | null;
  agent: string;
  model: string;
  title: string | null;
  dev_server_script: string | null;
  initialized: number | null;
  timestamp: string;
};

type SessionLaunchContextRow = {
  session_name: string;
  title: string | null;
  initial_message: string | null;
  raw_initial_message: string | null;
  startup_script: string | null;
  attachment_paths_json: string | null;
  attachment_names_json: string | null;
  agent_provider: string | null;
  model: string | null;
  session_mode: string | null;
  is_resume: number | null;
  timestamp: string;
};

function parseStringArray(value: string | null): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return undefined;
  }
}

type TrackingBranch = {
  remote: string;
  branch: string;
};

function parseTrackingUpstream(upstream: string): TrackingBranch | null {
  const slashIndex = upstream.indexOf('/');
  if (slashIndex <= 0 || slashIndex >= upstream.length - 1) return null;
  return {
    remote: upstream.slice(0, slashIndex),
    branch: upstream.slice(slashIndex + 1),
  };
}

async function getTrackingBranch(
  git: ReturnType<typeof simpleGit>,
  localBranch: string,
): Promise<TrackingBranch | null> {
  try {
    const upstream = await git.raw([
      'for-each-ref',
      '--format=%(upstream:short)',
      `refs/heads/${localBranch}`,
    ]);
    const upstreamBranch = upstream.trim();
    if (!upstreamBranch) return null;
    return parseTrackingUpstream(upstreamBranch);
  } catch {
    return null;
  }
}

function rowToSessionMetadata(row: SessionRow): SessionMetadata {
  return {
    sessionName: row.session_name,
    repoPath: row.repo_path,
    worktreePath: row.worktree_path,
    branchName: row.branch_name,
    baseBranch: row.base_branch ?? undefined,
    agent: row.agent,
    model: row.model,
    title: row.title ?? undefined,
    devServerScript: row.dev_server_script ?? undefined,
    initialized: row.initialized === null ? undefined : Boolean(row.initialized),
    timestamp: row.timestamp,
  };
}

function rowToSessionLaunchContext(row: SessionLaunchContextRow): SessionLaunchContext {
  return {
    sessionName: row.session_name,
    title: row.title ?? undefined,
    initialMessage: row.initial_message ?? undefined,
    rawInitialMessage: row.raw_initial_message ?? undefined,
    startupScript: row.startup_script ?? undefined,
    attachmentPaths: parseStringArray(row.attachment_paths_json),
    attachmentNames: parseStringArray(row.attachment_names_json),
    agentProvider: row.agent_provider ?? undefined,
    model: row.model ?? undefined,
    sessionMode: row.session_mode === 'plan' ? 'plan' : (row.session_mode === 'fast' ? 'fast' : undefined),
    isResume: row.is_resume === null ? undefined : Boolean(row.is_resume),
    timestamp: row.timestamp,
  };
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

export async function saveSessionMetadata(metadata: SessionMetadata): Promise<void> {
  const db = getLocalDb();
  db.prepare(`
    INSERT OR REPLACE INTO sessions (
      session_name, repo_path, worktree_path, branch_name, base_branch, agent, model,
      title, dev_server_script, initialized, timestamp
    ) VALUES (
      @sessionName, @repoPath, @worktreePath, @branchName, @baseBranch, @agent, @model,
      @title, @devServerScript, @initialized, @timestamp
    )
  `).run({
    sessionName: metadata.sessionName,
    repoPath: metadata.repoPath,
    worktreePath: metadata.worktreePath,
    branchName: metadata.branchName,
    baseBranch: metadata.baseBranch ?? null,
    agent: metadata.agent,
    model: metadata.model,
    title: metadata.title ?? null,
    devServerScript: metadata.devServerScript ?? null,
    initialized: metadata.initialized === undefined ? null : Number(metadata.initialized),
    timestamp: metadata.timestamp,
  });
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

export async function saveSessionLaunchContext(
  sessionName: string,
  context: Omit<SessionLaunchContext, 'sessionName' | 'timestamp'>
): Promise<{ success: boolean; error?: string }> {
  try {
    const contextData: SessionLaunchContext = {
      sessionName,
      ...context,
      timestamp: new Date().toISOString(),
    };
    const db = getLocalDb();
    db.prepare(`
      INSERT OR REPLACE INTO session_launch_contexts (
        session_name, title, initial_message, raw_initial_message, startup_script,
        attachment_paths_json, attachment_names_json, agent_provider, model,
        session_mode, is_resume, timestamp
      ) VALUES (
        @sessionName, @title, @initialMessage, @rawInitialMessage, @startupScript,
        @attachmentPathsJson, @attachmentNamesJson, @agentProvider, @model,
        @sessionMode, @isResume, @timestamp
      )
    `).run({
      sessionName: contextData.sessionName,
      title: contextData.title ?? null,
      initialMessage: contextData.initialMessage ?? null,
      rawInitialMessage: contextData.rawInitialMessage ?? null,
      startupScript: contextData.startupScript ?? null,
      attachmentPathsJson: contextData.attachmentPaths ? JSON.stringify(contextData.attachmentPaths) : null,
      attachmentNamesJson: contextData.attachmentNames ? JSON.stringify(contextData.attachmentNames) : null,
      agentProvider: contextData.agentProvider ?? null,
      model: contextData.model ?? null,
      sessionMode: contextData.sessionMode ?? null,
      isResume: contextData.isResume === undefined ? null : Number(contextData.isResume),
      timestamp: contextData.timestamp,
    });
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
    const db = getLocalDb();
    const row = db.prepare(`
      SELECT
        session_name, title, initial_message, raw_initial_message, startup_script,
        attachment_paths_json, attachment_names_json, agent_provider, model,
        session_mode, is_resume, timestamp
      FROM session_launch_contexts
      WHERE session_name = ?
    `).get(sessionName) as SessionLaunchContextRow | undefined;
    const context = row ? rowToSessionLaunchContext(row) : undefined;
    return { success: true, context };
  } catch (e: unknown) {
    console.error('Failed to consume session launch context:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

async function getSessionLaunchContext(
  sessionName: string
): Promise<{ success: boolean; context?: SessionLaunchContext; error?: string }> {
  try {
    const db = getLocalDb();
    const row = db.prepare(`
      SELECT
        session_name, title, initial_message, raw_initial_message, startup_script,
        attachment_paths_json, attachment_names_json, agent_provider, model,
        session_mode, is_resume, timestamp
      FROM session_launch_contexts
      WHERE session_name = ?
    `).get(sessionName) as SessionLaunchContextRow | undefined;
    const context = row ? rowToSessionLaunchContext(row) : undefined;
    return { success: true, context };
  } catch (e: unknown) {
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
  const rawAttachmentPaths = launchContext?.attachmentPaths || [];
  const normalizedAttachmentPaths = rawAttachmentPaths
    .map((entry) => entry.trim())
    .filter(Boolean);
  const attachmentPaths = normalizedAttachmentPaths.length > 0
    ? Array.from(new Set(normalizedAttachmentPaths))
    : Array.from(
      new Set(
        (launchContext?.attachmentNames || [])
          .map((name) => name.trim())
          .filter(Boolean)
          .map((name) => path.join(`${metadata.worktreePath}-attachments`, name))
      )
    );

  const prefill: SessionPrefillContext = {
    sourceSessionName: sessionName,
    repoPath: metadata.repoPath,
    title: launchContext?.title || metadata.title,
    initialMessage: launchContext?.rawInitialMessage || launchContext?.initialMessage,
    attachmentPaths,
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
    const db = getLocalDb();
    const row = db.prepare(`
      SELECT
        session_name, repo_path, worktree_path, branch_name, base_branch, agent, model,
        title, dev_server_script, initialized, timestamp
      FROM sessions
      WHERE session_name = ?
    `).get(sessionName) as SessionRow | undefined;
    return row ? rowToSessionMetadata(row) : null;
  } catch {
    return null;
  }
}

export async function listSessions(repoPath?: string): Promise<SessionMetadata[]> {
  try {
    const db = getLocalDb();
    const query = repoPath
      ? `
        SELECT
          session_name, repo_path, worktree_path, branch_name, base_branch, agent, model,
          title, dev_server_script, initialized, timestamp
        FROM sessions
        WHERE repo_path = ?
        ORDER BY timestamp DESC
      `
      : `
        SELECT
          session_name, repo_path, worktree_path, branch_name, base_branch, agent, model,
          title, dev_server_script, initialized, timestamp
        FROM sessions
        ORDER BY timestamp DESC
      `;
    const rows = repoPath
      ? (db.prepare(query).all(repoPath) as SessionRow[])
      : (db.prepare(query).all() as SessionRow[]);

    return rows.map(rowToSessionMetadata);
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
    try {
      await publishSessionListUpdated();
    } catch (notificationError) {
      console.warn('Failed to publish session list update after create:', notificationError);
    }

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

    // 2. Delete persisted metadata/context
    const db = getLocalDb();
    db.prepare(`
      DELETE FROM sessions WHERE session_name = ?
    `).run(sessionName);
    db.prepare(`
      DELETE FROM session_launch_contexts WHERE session_name = ?
    `).run(sessionName);

    // 3. Delete prompt file
    const promptsDir = await getSessionPromptsDir();
    const promptFilePath = path.join(promptsDir, `${sessionName}.txt`);
    await fs.rm(promptFilePath, { force: true });
    try {
      await publishSessionListUpdated();
    } catch (notificationError) {
      console.warn('Failed to publish session list update after delete:', notificationError);
    }

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

    const baseBranchTracking = await getTrackingBranch(repoGit, baseBranch);
    const repoOriginalBranch = branchSummary.current;
    if (baseBranchTracking) {
      if (repoOriginalBranch !== baseBranch) {
        await repoGit.checkout(baseBranch);
      }
      try {
        await repoGit.raw(['pull', '--ff-only', baseBranchTracking.remote, baseBranchTracking.branch]);
      } finally {
        if (repoOriginalBranch && repoOriginalBranch !== baseBranch) {
          await repoGit.checkout(repoOriginalBranch);
        }
      }
    }

    const worktreeBranchSummary = await worktreeGit.branchLocal();
    if (worktreeBranchSummary.current !== metadata.branchName) {
      await worktreeGit.checkout(metadata.branchName);
    }

    await worktreeGit.rebase([baseBranch]);

    const sessionBranchTracking = await getTrackingBranch(worktreeGit, metadata.branchName);
    if (sessionBranchTracking) {
      await worktreeGit.push([
        '--force-with-lease',
        sessionBranchTracking.remote,
        `${metadata.branchName}:${sessionBranchTracking.branch}`,
      ]);
    }

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
): Promise<{ success: boolean; baseBranch?: string; branches?: string[]; mainWorktreeBranch?: string; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const git = simpleGit(metadata.repoPath);
    const branchSummary = await git.branchLocal();
    const branches = [...branchSummary.all].sort((a, b) => a.localeCompare(b));
    const baseBranch = metadata.baseBranch?.trim();
    const mainWorktreeBranch = branchSummary.current?.trim() || undefined;

    return { success: true, baseBranch, branches, mainWorktreeBranch };
  } catch (e: unknown) {
    console.error('Failed to list session base branches:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function createSessionBaseBranch(
  sessionName: string,
  branchName: string,
  fromBranch: string
): Promise<{ success: boolean; branchName?: string; fromBranch?: string; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const nextBranchName = branchName.trim();
    if (!nextBranchName) {
      return { success: false, error: 'Branch name cannot be empty.' };
    }

    const nextFromBranch = fromBranch.trim();
    if (!nextFromBranch) {
      return { success: false, error: 'Base branch cannot be empty.' };
    }

    const git = simpleGit(metadata.repoPath);

    try {
      await git.raw(['check-ref-format', '--branch', nextBranchName]);
    } catch {
      return { success: false, error: `Invalid branch name: "${nextBranchName}".` };
    }

    const branchSummary = await git.branchLocal();
    if (!branchSummary.all.includes(nextFromBranch)) {
      return { success: false, error: `Base branch "${nextFromBranch}" not found in repository.` };
    }
    if (branchSummary.all.includes(nextBranchName)) {
      return { success: false, error: `Branch "${nextBranchName}" already exists.` };
    }

    await git.raw(['branch', nextBranchName, nextFromBranch]);

    return {
      success: true,
      branchName: nextBranchName,
      fromBranch: nextFromBranch,
    };
  } catch (e: unknown) {
    console.error('Failed to create session base branch:', e);
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
