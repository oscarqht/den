'use server';

import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createHash, randomUUID } from 'crypto';
import simpleGit from 'simple-git';
import { getErrorMessage } from '../../lib/error-utils';
import {
  getSessionTerminalEnvironments,
  removeWorktree,
  terminateSessionTerminalSessions,
} from './git';
import { discoverProjectGitRepos } from './project';
import { getLocalDb } from '@/lib/local-db';
import {
  normalizeNullableProviderReasoningEffort,
  normalizeProviderReasoningEffort,
} from '@/lib/agent/reasoning';
import { buildPlanText, normalizePlanSteps, parsePlanStepsFromText } from '@/lib/agent/plan';
import { sortSessionHistoryForTimeline } from '@/lib/agent/history-order';
import { publishSessionListUpdated } from '@/lib/sessionNotificationServer';
import { runInBackground } from '@/lib/background-task';
import { buildTerminalProcessEnv } from '@/lib/terminal-process-env';
import { getTmuxSessionName } from '@/lib/terminal-session';
import {
  cleanupStaleNextDevLock,
  clearTrackedSessionProcess,
  getSessionRootPath,
  getTrackedSessionProcess,
  inferTrackedProcessPreviewUrl,
  launchTrackedSessionProcess,
  readTrackedDevServerState,
  stopAllTrackedSessionProcesses,
  stopTrackedSessionProcess,
  terminateProcessGracefully,
} from '@/lib/session-processes';
import { findProjectByFolderPath, getProjectById } from '@/lib/store';
import { buildProjectFolderEntries, getProjectPrimaryFolderPath, normalizeProjectFolderPath } from '@/lib/project-folders';
import type {
  AgentProvider,
  HistoryEntry,
  ReasoningEffort,
  SessionAgentHistoryInput,
  SessionAgentHistoryItem,
  SessionAgentRunState,
  SessionAgentRuntimeState,
  SessionGitRepoContext,
  SessionWorkspaceFolder,
  SessionWorkspaceMode,
  SessionWorkspacePreference,
} from '@/lib/types';

export type SessionMetadata = {
  sessionName: string;
  projectId?: string;
  projectPath: string;
  workspacePath: string;
  workspaceFolders: SessionWorkspaceFolder[];
  workspaceMode: SessionWorkspaceMode;
  activeRepoPath?: string;
  gitRepos: SessionGitRepoContext[];
  agent: string;
  agentProvider?: AgentProvider;
  model: string;
  reasoningEffort?: ReasoningEffort;
  threadId?: string;
  activeTurnId?: string;
  runState?: SessionAgentRunState;
  lastError?: string;
  lastActivityAt?: string;
  title?: string;
  devServerScript?: string;
  initialized?: boolean;
  timestamp: string;
  // Backward compatibility fields.
  repoPath?: string;
  worktreePath?: string;
  branchName?: string;
  baseBranch?: string;
};

export type SessionLaunchContext = {
  sessionName: string;
  title?: string;
  initialMessage?: string;
  rawInitialMessage?: string;
  startupScript?: string;
  attachmentPaths?: string[];
  attachmentNames?: string[];
  projectRepoPaths?: string[];
  projectRepoRelativePaths?: string[];
  agentProvider?: AgentProvider;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  sessionMode?: 'fast' | 'plan';
  isResume?: boolean;
  timestamp: string;
};

export type SessionPrefillContext = {
  sourceSessionName: string;
  projectId?: string;
  projectPath: string;
  title?: string;
  initialMessage?: string;
  attachmentPaths: string[];
  agentProvider: AgentProvider;
  model: string;
  reasoningEffort?: ReasoningEffort;
  // Backward compatibility.
  repoPath?: string;
};

export type SessionAgentRuntimeUpdate = {
  agentProvider?: AgentProvider;
  model?: string;
  reasoningEffort?: ReasoningEffort | null;
  threadId?: string | null;
  activeTurnId?: string | null;
  runState?: SessionAgentRunState | null;
  lastError?: string | null;
  lastActivityAt?: string | null;
};

export type SessionAgentSnapshot = {
  metadata: SessionMetadata;
  runtime: SessionAgentRuntimeState;
  history: SessionAgentHistoryItem[];
};

export type SessionAgentHistoryQuery = {
  threadId?: string;
  turnId?: string;
  limit?: number;
};

export type SessionCreateGitContextInput = {
  repoPath: string;
  baseBranch?: string;
};

export type SessionCreateMetadata = {
  agent: string;
  agentProvider?: AgentProvider;
  model: string;
  reasoningEffort?: ReasoningEffort;
  title?: string;
  startupScript?: string;
  devServerScript?: string;
  preparedWorkspaceId?: string;
  workspacePreference?: SessionWorkspacePreference;
};

export type SessionCreateResult = {
  success: boolean;
  sessionName?: string;
  projectId?: string;
  workspacePath?: string;
  workspaceFolders?: SessionWorkspaceFolder[];
  workspaceMode?: SessionWorkspaceMode;
  activeRepoPath?: string;
  gitRepos?: SessionGitRepoContext[];
  branchName?: string;
  worktreePath?: string;
  error?: string;
};

export type SessionWorkspacePreparation = {
  preparationId: string;
  sessionName: string;
  projectId?: string;
  projectPath: string;
  contextFingerprint: string;
  workspacePath: string;
  workspaceFolders: SessionWorkspaceFolder[];
  workspaceMode: SessionWorkspaceMode;
  activeRepoPath?: string;
  gitRepos: SessionGitRepoContext[];
  startupCommandSignature?: string;
  expiresAt: string;
};

type SessionRow = {
  session_name: string;
  project_id: string | null;
  project_path: string | null;
  workspace_path: string | null;
  workspace_folders_json: string | null;
  workspace_mode: string | null;
  active_repo_path: string | null;
  repo_path: string | null;
  worktree_path: string | null;
  branch_name: string | null;
  base_branch: string | null;
  agent: string;
  model: string;
  reasoning_effort: string | null;
  thread_id: string | null;
  active_turn_id: string | null;
  run_state: string | null;
  last_error: string | null;
  last_activity_at: string | null;
  title: string | null;
  dev_server_script: string | null;
  initialized: number | null;
  timestamp: string;
};

type SessionGitRepoRow = {
  session_name: string;
  source_repo_path: string;
  relative_repo_path: string;
  worktree_path: string;
  branch_name: string;
  base_branch: string | null;
};

type SessionLaunchContextRow = {
  session_name: string;
  title: string | null;
  initial_message: string | null;
  raw_initial_message: string | null;
  startup_script: string | null;
  attachment_paths_json: string | null;
  attachment_names_json: string | null;
  project_repo_paths_json: string | null;
  project_repo_relative_paths_json: string | null;
  agent_provider: string | null;
  model: string | null;
  reasoning_effort: string | null;
  session_mode: string | null;
  is_resume: number | null;
  timestamp: string;
};

type SessionWorkspacePreparationRow = {
  preparation_id: string;
  project_id: string | null;
  project_path: string;
  context_fingerprint: string;
  session_name: string;
  payload_json: string;
  status: string;
  cancel_requested: number;
  created_at: string;
  updated_at: string;
  expires_at: string;
  consumed_at: string | null;
  released_at: string | null;
};

type SessionAgentHistoryRow = {
  session_name: string;
  item_id: string;
  thread_id: string | null;
  turn_id: string | null;
  ordinal: number | null;
  kind: string;
  status: string | null;
  payload_json: string;
  created_at: string;
  updated_at: string;
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

function parseWorkspaceFolders(value: string | null): SessionWorkspaceFolder[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
      .map((entry) => {
        const sourcePath = typeof entry.sourcePath === 'string' ? entry.sourcePath.trim() : '';
        const workspaceRelativePath = typeof entry.workspaceRelativePath === 'string'
          ? entry.workspaceRelativePath.trim()
          : '';
        const workspacePath = typeof entry.workspacePath === 'string' ? entry.workspacePath.trim() : '';
        const provisioning = entry.provisioning === 'direct'
          || entry.provisioning === 'link'
          || entry.provisioning === 'copy'
          || entry.provisioning === 'worktree'
          ? entry.provisioning
          : null;

        if (!sourcePath || !workspaceRelativePath || !workspacePath || !provisioning) {
          return null;
        }

        return {
          sourcePath,
          workspaceRelativePath,
          workspacePath,
          provisioning,
        } satisfies SessionWorkspaceFolder;
      })
      .filter((entry): entry is SessionWorkspaceFolder => Boolean(entry));
  } catch {
    return [];
  }
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  return normalizeOptionalText(value) ?? null;
}

function toSessionGitRepoContext(row: SessionGitRepoRow): SessionGitRepoContext {
  return {
    sourceRepoPath: row.source_repo_path,
    relativeRepoPath: row.relative_repo_path,
    worktreePath: row.worktree_path,
    branchName: row.branch_name,
    baseBranch: row.base_branch ?? undefined,
  };
}

function normalizeSessionWorkspaceMode(value: string | null | undefined): SessionWorkspaceMode {
  if (
    value === 'single_worktree'
    || value === 'multi_repo_worktree'
    || value === 'folder'
    || value === 'local_source'
  ) {
    return value;
  }
  return 'folder';
}

function normalizeSessionWorkspacePreference(
  value: SessionWorkspacePreference | string | null | undefined,
): SessionWorkspacePreference {
  return value === 'local' ? 'local' : 'workspace';
}

function toCompatibilityFields(metadata: SessionMetadata): Pick<SessionMetadata, 'repoPath' | 'worktreePath' | 'branchName' | 'baseBranch'> {
  const activeContext = metadata.gitRepos.find((context) => context.sourceRepoPath === metadata.activeRepoPath)
    || metadata.gitRepos[0];
  const compatibilityWorktreePath = metadata.workspaceMode === 'local_source'
    ? metadata.workspacePath
    : (activeContext?.worktreePath || metadata.workspacePath);

  return {
    repoPath: activeContext?.sourceRepoPath || metadata.activeRepoPath || metadata.projectPath,
    worktreePath: compatibilityWorktreePath,
    branchName: activeContext?.branchName,
    baseBranch: activeContext?.baseBranch,
  };
}

async function getSessionGitRepos(sessionName: string): Promise<SessionGitRepoContext[]> {
  const db = getLocalDb();
  const rows = db.prepare(`
    SELECT
      session_name, source_repo_path, relative_repo_path, worktree_path, branch_name, base_branch
    FROM session_git_repos
    WHERE session_name = ?
    ORDER BY source_repo_path ASC
  `).all(sessionName) as SessionGitRepoRow[];

  return rows.map(toSessionGitRepoContext);
}

async function rowToSessionMetadata(row: SessionRow): Promise<SessionMetadata> {
  const projectPath = row.project_path?.trim() || row.repo_path?.trim() || '';
  const workspacePath = row.workspace_path?.trim() || row.worktree_path?.trim() || projectPath;
  const workspaceFolders = parseWorkspaceFolders(row.workspace_folders_json);
  const gitRepos = await getSessionGitRepos(row.session_name);

  const fallbackRepo = row.repo_path?.trim();
  const fallbackWorktree = row.worktree_path?.trim();
  const fallbackBranch = row.branch_name?.trim();
  const fallbackBase = row.base_branch?.trim() || undefined;

  if (gitRepos.length === 0 && fallbackRepo && fallbackWorktree && fallbackBranch) {
    gitRepos.push({
      sourceRepoPath: fallbackRepo,
      relativeRepoPath: projectPath ? (path.relative(projectPath, fallbackRepo) === '.' ? '' : path.relative(projectPath, fallbackRepo)) : '',
      worktreePath: fallbackWorktree,
      branchName: fallbackBranch,
      baseBranch: fallbackBase,
    });
  }

  const metadata: SessionMetadata = {
    sessionName: row.session_name,
    projectId: normalizeOptionalText(row.project_id) ?? undefined,
    projectPath,
    workspacePath,
    workspaceFolders,
    workspaceMode: normalizeSessionWorkspaceMode(row.workspace_mode),
    activeRepoPath: row.active_repo_path?.trim() || undefined,
    gitRepos,
    agent: row.agent,
    agentProvider: row.agent as AgentProvider,
    model: row.model,
    reasoningEffort: normalizeProviderReasoningEffort(row.agent, row.reasoning_effort),
    threadId: normalizeOptionalText(row.thread_id),
    activeTurnId: normalizeOptionalText(row.active_turn_id),
    runState: normalizeOptionalText(row.run_state) as SessionAgentRunState | undefined,
    lastError: normalizeOptionalText(row.last_error),
    lastActivityAt: normalizeOptionalText(row.last_activity_at),
    title: row.title ?? undefined,
    devServerScript: row.dev_server_script ?? undefined,
    initialized: row.initialized === null ? undefined : Boolean(row.initialized),
    timestamp: row.timestamp,
  };

  if (metadata.workspaceFolders.length === 0 && projectPath && workspacePath) {
    metadata.workspaceFolders = [
      buildLocalWorkspaceFolderMapping(
        projectPath,
        workspacePath,
        '.',
        metadata.workspaceMode === 'local_source' ? 'direct' : 'copy',
      ),
    ];
  }

  return {
    ...metadata,
    ...toCompatibilityFields(metadata),
  };
}

function rowToSessionLaunchContext(row: SessionLaunchContextRow): SessionLaunchContext {
  const agentProvider = (row.agent_provider ?? undefined) as AgentProvider | undefined;
  return {
    sessionName: row.session_name,
    title: row.title ?? undefined,
    initialMessage: row.initial_message ?? undefined,
    rawInitialMessage: row.raw_initial_message ?? undefined,
    startupScript: row.startup_script ?? undefined,
    attachmentPaths: parseStringArray(row.attachment_paths_json),
    attachmentNames: parseStringArray(row.attachment_names_json),
    projectRepoPaths: parseStringArray(row.project_repo_paths_json),
    projectRepoRelativePaths: parseStringArray(row.project_repo_relative_paths_json),
    agentProvider,
    model: row.model ?? undefined,
    reasoningEffort: normalizeProviderReasoningEffort(agentProvider, row.reasoning_effort),
    sessionMode: row.session_mode === 'plan' ? 'plan' : (row.session_mode === 'fast' ? 'fast' : undefined),
    isResume: row.is_resume === null ? undefined : Boolean(row.is_resume),
    timestamp: row.timestamp,
  };
}

function toSessionAgentRuntimeState(metadata: SessionMetadata): SessionAgentRuntimeState {
  return {
    sessionName: metadata.sessionName,
    agentProvider: (metadata.agentProvider ?? metadata.agent) as AgentProvider,
    model: metadata.model,
    reasoningEffort: metadata.reasoningEffort,
    threadId: metadata.threadId ?? null,
    activeTurnId: metadata.activeTurnId ?? null,
    runState: metadata.runState ?? null,
    lastError: metadata.lastError ?? null,
    lastActivityAt: metadata.lastActivityAt ?? null,
  };
}

function toSessionAgentHistoryItem(row: SessionAgentHistoryRow): SessionAgentHistoryItem | null {
  try {
    const parsed = JSON.parse(row.payload_json) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const payload = parsed as Record<string, unknown>;
    if (payload.kind !== row.kind) return null;
    if (typeof payload.id !== 'string' || !payload.id.trim()) {
      payload.id = row.item_id;
    }

    if (payload.kind === 'plan') {
      const text = typeof payload.text === 'string' ? payload.text : '';
      const steps = normalizePlanSteps(payload.steps);
      return {
        kind: 'plan',
        id: typeof payload.id === 'string' ? payload.id : row.item_id,
        text: text || buildPlanText(steps),
        steps: steps.length > 0 ? steps : parsePlanStepsFromText(text),
        sessionName: row.session_name,
        threadId: normalizeNullableText(row.thread_id),
        turnId: normalizeNullableText(row.turn_id),
        ordinal: row.ordinal ?? 0,
        itemStatus: normalizeNullableText(row.status),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }

    return {
      ...(payload as HistoryEntry),
      sessionName: row.session_name,
      threadId: normalizeNullableText(row.thread_id),
      turnId: normalizeNullableText(row.turn_id),
      ordinal: row.ordinal ?? 0,
      itemStatus: normalizeNullableText(row.status),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

function normalizePath(value: string): string {
  return path.resolve(value.trim());
}

function normalizeRelativeWorkspacePath(value: string): string {
  const trimmed = value.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
  return trimmed || '.';
}

function buildLocalWorkspaceFolderMapping(
  sourcePath: string,
  workspacePath: string,
  workspaceRelativePath: string,
  provisioning: SessionWorkspaceFolder['provisioning'],
): SessionWorkspaceFolder {
  return {
    sourcePath: normalizePath(sourcePath),
    workspaceRelativePath: normalizeRelativeWorkspacePath(workspaceRelativePath),
    workspacePath: normalizePath(workspacePath),
    provisioning,
  };
}

function getSessionProjectKey(projectId: string | undefined, projectPath: string): string {
  return projectId?.trim() || projectPath;
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const normalizedParent = normalizePath(parentPath);
  const normalizedCandidate = normalizePath(candidatePath);
  if (normalizedParent === normalizedCandidate) return true;
  const relativePath = path.relative(normalizedParent, normalizedCandidate);
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function hasOverlappingRepoRoots(repoPaths: string[]): boolean {
  const normalized = Array.from(new Set(repoPaths.map((repoPath) => normalizePath(repoPath)))).sort((a, b) => a.localeCompare(b));
  for (let i = 0; i < normalized.length; i += 1) {
    for (let j = i + 1; j < normalized.length; j += 1) {
      if (isPathInside(normalized[i], normalized[j])) {
        return true;
      }
    }
  }
  return false;
}

const SESSION_WORKSPACE_PREPARATION_STATUS_READY = 'ready';
const SESSION_WORKSPACE_PREPARATION_STATUS_CONSUMED = 'consumed';
const SESSION_WORKSPACE_PREPARATION_STATUS_RELEASED = 'released';
const SESSION_WORKSPACE_PREPARATION_TTL_MS = 15 * 60 * 1000;

type ProvisionedSessionWorkspace = {
  sessionName: string;
  projectId?: string;
  projectPath: string;
  workspacePath: string;
  workspaceFolders: SessionWorkspaceFolder[];
  workspaceMode: SessionWorkspaceMode;
  activeRepoPath?: string;
  gitRepos: SessionGitRepoContext[];
  contextFingerprint: string;
  startupCommandSignature?: string;
  startupCommandMode?: 'tmux' | 'shell';
  startupCommandProcessPid?: number;
};

type SessionWorkspacePreparationPayload = {
  sessionName: string;
  projectId?: string;
  projectPath: string;
  workspacePath: string;
  workspaceFolders: SessionWorkspaceFolder[];
  workspaceMode: SessionWorkspaceMode;
  activeRepoPath?: string;
  gitRepos: SessionGitRepoContext[];
  contextFingerprint: string;
  startupCommandSignature?: string;
  startupCommandMode?: 'tmux' | 'shell';
  startupCommandProcessPid?: number;
};

type ResolvedSessionWorkspaceContextInput = {
  projectId?: string;
  normalizedProjectPath: string;
  normalizedFolderPaths: string[];
  discoveredRepoPaths: string[];
  repoRelativePathByRepoPath: Record<string, string>;
  hasOverlap: boolean;
  normalizedContexts: SessionCreateGitContextInput[];
  workspacePreference: SessionWorkspacePreference;
  contextFingerprint: string;
};

function toCanonicalGitContexts(
  contexts: SessionCreateGitContextInput[],
): Array<{ repoPath: string; baseBranch: string }> {
  return contexts
    .map((context) => ({
      repoPath: normalizePath(context.repoPath),
      baseBranch: context.baseBranch?.trim() || '',
    }))
    .sort((left, right) => left.repoPath.localeCompare(right.repoPath));
}

async function resolveSessionProjectContext(projectIdOrPath: string): Promise<{
  projectId?: string;
  normalizedProjectPath: string;
  normalizedFolderPaths: string[];
}> {
  const trimmedValue = projectIdOrPath.trim();
  if (!trimmedValue) {
    throw new Error('Project is required.');
  }

  const projectById = getProjectById(trimmedValue);
  if (projectById) {
    const primaryFolderPath = getProjectPrimaryFolderPath(projectById);
    if (!primaryFolderPath) {
      throw new Error('Project does not have any associated folders.');
    }
    return {
      projectId: projectById.id,
      normalizedProjectPath: normalizeProjectFolderPath(primaryFolderPath),
      normalizedFolderPaths: projectById.folderPaths.map((folderPath) => normalizeProjectFolderPath(folderPath)),
    };
  }

  const normalizedPath = normalizeProjectFolderPath(trimmedValue);
  const projectByFolderPath = findProjectByFolderPath(normalizedPath);
  if (projectByFolderPath) {
    const primaryFolderPath = getProjectPrimaryFolderPath(projectByFolderPath);
    if (!primaryFolderPath) {
      throw new Error('Project does not have any associated folders.');
    }
    return {
      projectId: projectByFolderPath.id,
      normalizedProjectPath: normalizeProjectFolderPath(primaryFolderPath),
      normalizedFolderPaths: projectByFolderPath.folderPaths.map((folderPath) => normalizeProjectFolderPath(folderPath)),
    };
  }

  const projectStats = await fs.stat(normalizedPath);
  if (!projectStats.isDirectory()) {
    throw new Error('Project path must be a directory.');
  }

  return {
    normalizedProjectPath: normalizedPath,
    normalizedFolderPaths: [normalizedPath],
  };
}

function buildSessionWorkspaceContextFingerprint(
  projectContext: {
    projectId?: string;
    normalizedProjectPath: string;
    normalizedFolderPaths: string[];
  },
  contexts: SessionCreateGitContextInput[],
  workspacePreference: SessionWorkspacePreference,
): string {
  const canonicalContexts = toCanonicalGitContexts(contexts);
  return createHash('sha1')
    .update(JSON.stringify({
      projectId: projectContext.projectId ?? null,
      projectPath: projectContext.normalizedProjectPath,
      folderPaths: projectContext.normalizedFolderPaths,
      workspacePreference,
      contexts: canonicalContexts,
    }))
    .digest('hex');
}

function normalizeStartupScript(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function buildStartupCommandSignature(
  startupScript: string,
  agentCli?: string,
): string {
  return createHash('sha1')
    .update(JSON.stringify({
      startupScript: startupScript.trim(),
      agentCli: normalizeOptionalText(agentCli) || '',
    }))
    .digest('hex');
}

function getWindowsExecutableNames(command: string): string[] {
  if (process.platform !== 'win32') {
    return [command];
  }

  const pathExtEntries = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const lowerCommand = command.toLowerCase();
  if (pathExtEntries.some((entry) => lowerCommand.endsWith(entry.toLowerCase()))) {
    return [command];
  }

  return [command, ...pathExtEntries.map((entry) => `${command}${entry}`)];
}

function resolveCommandPath(command: string): string | null {
  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const candidateName of getWindowsExecutableNames(command)) {
    if (!candidateName) continue;

    if (candidateName.includes(path.sep) && fsSync.existsSync(candidateName)) {
      return candidateName;
    }

    for (const directory of pathEntries) {
      const candidatePath = path.join(directory, candidateName);
      if (fsSync.existsSync(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return null;
}

function isCommandAvailable(command: string): boolean {
  return Boolean(resolveCommandPath(command));
}

function getStartupShellCommand(): { command: string; args: string[]; shellKind: 'posix' | 'powershell' } {
  if (process.platform === 'win32') {
    const powershellCommand = isCommandAvailable('pwsh.exe') ? 'pwsh.exe' : 'powershell.exe';
    return {
      command: powershellCommand,
      args: ['-NoLogo'],
      shellKind: 'powershell',
    };
  }

  return {
    command: 'bash',
    args: [],
    shellKind: 'posix',
  };
}

function resolveStartupCommandPersistenceMode(): 'tmux' | 'shell' {
  if (process.platform === 'win32') {
    return 'shell';
  }

  return isCommandAvailable('tmux') ? 'tmux' : 'shell';
}

function toSessionWorkspacePreparationPayload(
  provision: ProvisionedSessionWorkspace,
): SessionWorkspacePreparationPayload {
  return {
    sessionName: provision.sessionName,
    projectId: provision.projectId,
    projectPath: provision.projectPath,
    workspacePath: provision.workspacePath,
    workspaceFolders: provision.workspaceFolders,
    workspaceMode: provision.workspaceMode,
    activeRepoPath: provision.activeRepoPath,
    gitRepos: provision.gitRepos,
    contextFingerprint: provision.contextFingerprint,
    startupCommandSignature: provision.startupCommandSignature,
    startupCommandMode: provision.startupCommandMode,
    startupCommandProcessPid: provision.startupCommandProcessPid,
  };
}

function parseSessionWorkspacePreparationPayload(
  payloadJson: string,
): SessionWorkspacePreparationPayload | null {
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const payload = parsed as Partial<SessionWorkspacePreparationPayload>;
    if (
      typeof payload.sessionName !== 'string'
      || (payload.projectId !== undefined && payload.projectId !== null && typeof payload.projectId !== 'string')
      || typeof payload.projectPath !== 'string'
      || typeof payload.workspacePath !== 'string'
      || typeof payload.workspaceMode !== 'string'
      || !Array.isArray(payload.gitRepos)
      || typeof payload.contextFingerprint !== 'string'
    ) {
      return null;
    }

    const normalizedWorkspaceMode = normalizeSessionWorkspaceMode(payload.workspaceMode);
    const gitRepos = payload.gitRepos
      .filter((entry): entry is SessionGitRepoContext => Boolean(entry) && typeof entry === 'object')
      .map((entry) => ({
        sourceRepoPath: normalizeOptionalText(entry.sourceRepoPath) || '',
        relativeRepoPath: normalizeOptionalText(entry.relativeRepoPath) || '',
        worktreePath: normalizeOptionalText(entry.worktreePath) || '',
        branchName: normalizeOptionalText(entry.branchName) || '',
        baseBranch: normalizeOptionalText(entry.baseBranch),
      }))
      .filter((entry) => (
        Boolean(entry.sourceRepoPath)
        && Boolean(entry.worktreePath)
        && Boolean(entry.branchName)
      ));

    return {
      sessionName: payload.sessionName.trim(),
      projectId: normalizeOptionalText(payload.projectId),
      projectPath: normalizePath(payload.projectPath),
      workspacePath: normalizePath(payload.workspacePath),
      workspaceFolders: Array.isArray(payload.workspaceFolders)
        ? parseWorkspaceFolders(JSON.stringify(payload.workspaceFolders))
        : [],
      workspaceMode: normalizedWorkspaceMode,
      activeRepoPath: normalizeOptionalText(payload.activeRepoPath),
      gitRepos,
      contextFingerprint: payload.contextFingerprint.trim(),
      startupCommandSignature: normalizeOptionalText(payload.startupCommandSignature),
      startupCommandMode: payload.startupCommandMode === 'tmux' || payload.startupCommandMode === 'shell'
        ? payload.startupCommandMode
        : undefined,
      startupCommandProcessPid: typeof payload.startupCommandProcessPid === 'number'
        && Number.isFinite(payload.startupCommandProcessPid)
        && payload.startupCommandProcessPid > 0
        ? payload.startupCommandProcessPid
        : undefined,
    };
  } catch {
    return null;
  }
}

function buildSessionName(): string {
  const date = new Date();
  const timestamp = date.toISOString().replace(/[-:]/g, '').slice(0, 8)
    + '-'
    + date.getHours().toString().padStart(2, '0')
    + date.getMinutes().toString().padStart(2, '0');
  const nonce = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${nonce}`;
}

function buildSessionBranchName(sessionName: string, repoPath: string): string {
  const repoHash = createHash('sha1').update(repoPath).digest('hex').slice(0, 8);
  return `palx/${sessionName}/${repoHash}`;
}

async function resolveDefaultBaseBranch(repoPath: string): Promise<string> {
  const git = simpleGit(repoPath);
  const branches = await git.branchLocal();
  if (branches.current?.trim()) return branches.current.trim();
  if (branches.all.includes('main')) return 'main';
  if (branches.all.includes('master')) return 'master';
  if (branches.all.length > 0) return branches.all[0];
  return 'main';
}

async function resolveRepoHeadBranch(repoPath: string): Promise<string> {
  const git = simpleGit(repoPath);
  const branches = await git.branchLocal();
  if (branches.current?.trim()) return branches.current.trim();
  return resolveDefaultBaseBranch(repoPath);
}

async function copyProjectWithoutGitRepos(
  projectPath: string,
  workspacePath: string,
  gitRepoPaths: string[],
): Promise<void> {
  const normalizedProjectPath = normalizePath(projectPath);
  const excludedRoots = gitRepoPaths.map((repoPath) => normalizePath(repoPath));

  await fs.cp(normalizedProjectPath, workspacePath, {
    recursive: true,
    force: false,
    errorOnExist: false,
    filter: (sourcePath) => {
      const normalizedSourcePath = normalizePath(sourcePath);
      if (normalizedSourcePath === normalizedProjectPath) return true;
      for (const excludedRoot of excludedRoots) {
        if (normalizedSourcePath === excludedRoot) return false;
        if (isPathInside(excludedRoot, normalizedSourcePath)) return false;
      }
      return true;
    },
  });
}

function normalizeGitContextInput(
  projectPath: string,
  discoveredRepoPaths: string[],
  requestedContexts: SessionCreateGitContextInput[],
): SessionCreateGitContextInput[] {
  const requestedMap = new Map<string, SessionCreateGitContextInput>();
  for (const context of requestedContexts) {
    const normalizedRepoPath = context.repoPath?.trim();
    if (!normalizedRepoPath) continue;
    requestedMap.set(normalizePath(normalizedRepoPath), {
      repoPath: normalizePath(normalizedRepoPath),
      baseBranch: context.baseBranch?.trim() || undefined,
    });
  }

  return discoveredRepoPaths.map((repoPath) => {
    const normalizedRepoPath = normalizePath(repoPath);
    const requested = requestedMap.get(normalizedRepoPath);
    return {
      repoPath: normalizedRepoPath,
      baseBranch: requested?.baseBranch,
    };
  });
}

function resolveRequestedGitContexts(
  projectPath: string,
  gitContextsOrBaseBranch: string | SessionCreateGitContextInput[],
): SessionCreateGitContextInput[] {
  return typeof gitContextsOrBaseBranch === 'string'
    ? [{ repoPath: projectPath, baseBranch: gitContextsOrBaseBranch }]
    : gitContextsOrBaseBranch;
}

async function resolveSessionWorkspaceContextInput(
  projectIdOrPath: string,
  gitContextsOrBaseBranch: string | SessionCreateGitContextInput[],
  workspacePreference: SessionWorkspacePreference = 'workspace',
): Promise<ResolvedSessionWorkspaceContextInput> {
  const projectContext = await resolveSessionProjectContext(projectIdOrPath);
  const discovery = await discoverProjectGitRepos(projectContext.projectId ?? projectContext.normalizedProjectPath);
  const discoveredRepoPaths = discovery.repos.map((repo) => repo.repoPath);
  const repoRelativePathByRepoPath = Object.fromEntries(
    discovery.repos.map((repo) => [repo.repoPath, repo.relativePath]),
  );
  const hasOverlap = hasOverlappingRepoRoots(discoveredRepoPaths);
  const requestedContexts = resolveRequestedGitContexts(projectContext.normalizedProjectPath, gitContextsOrBaseBranch);
  const normalizedContexts = normalizeGitContextInput(
    projectContext.normalizedProjectPath,
    discoveredRepoPaths,
    requestedContexts,
  );
  const normalizedWorkspacePreference = normalizeSessionWorkspacePreference(workspacePreference);
  const contextFingerprint = buildSessionWorkspaceContextFingerprint(
    projectContext,
    normalizedContexts,
    normalizedWorkspacePreference,
  );

  return {
    projectId: projectContext.projectId,
    normalizedProjectPath: projectContext.normalizedProjectPath,
    normalizedFolderPaths: projectContext.normalizedFolderPaths,
    discoveredRepoPaths,
    repoRelativePathByRepoPath,
    hasOverlap,
    normalizedContexts,
    workspacePreference: normalizedWorkspacePreference,
    contextFingerprint,
  };
}

function getWorkspaceRelativeRepoPath(
  repoRelativePathByRepoPath: Record<string, string>,
  projectPath: string,
  repoPath: string,
): string {
  const mappedRelativePath = repoRelativePathByRepoPath[repoPath];
  if (mappedRelativePath !== undefined) {
    return mappedRelativePath;
  }

  const relativeRepoPath = path.relative(projectPath, repoPath);
  return relativeRepoPath === '.' ? '' : relativeRepoPath;
}

async function ensureWorkspaceParent(workspacePath: string): Promise<void> {
  await fs.mkdir(path.dirname(workspacePath), { recursive: true });
}

async function linkWorkspaceFolder(sourcePath: string, targetPath: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.symlink(sourcePath, targetPath, process.platform === 'win32' ? 'junction' : 'dir');
}

async function createSingleRepoSession(
  projectKey: string,
  projectPath: string,
  sessionName: string,
  context: SessionCreateGitContextInput,
): Promise<{
  workspacePath: string;
  workspaceFolders: SessionWorkspaceFolder[];
  gitRepos: SessionGitRepoContext[];
  activeRepoPath: string;
}> {
  const sessionRootPath = getSessionRootPath(projectKey, sessionName);
  const workspacePath = path.join(sessionRootPath, 'workspace');
  await ensureWorkspaceParent(workspacePath);

  const baseBranch = context.baseBranch || await resolveDefaultBaseBranch(context.repoPath);
  const branchName = buildSessionBranchName(sessionName, context.repoPath);
  const git = simpleGit(context.repoPath);
  await git.raw(['worktree', 'add', '-b', branchName, workspacePath, baseBranch]);

  return {
    workspacePath,
    workspaceFolders: [
      buildLocalWorkspaceFolderMapping(projectPath, workspacePath, '.', 'worktree'),
    ],
    activeRepoPath: context.repoPath,
    gitRepos: [{
      sourceRepoPath: context.repoPath,
      relativeRepoPath: '',
      worktreePath: workspacePath,
      branchName,
      baseBranch,
    }],
  };
}

async function copyFolderWithoutGitRepos(
  sourcePath: string,
  destinationPath: string,
  gitRepoPaths: string[],
): Promise<void> {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await copyProjectWithoutGitRepos(sourcePath, destinationPath, gitRepoPaths);
}

async function createWorkspaceModeSession(
  projectKey: string,
  projectPath: string,
  sessionName: string,
  folderPaths: string[],
  contexts: SessionCreateGitContextInput[],
  repoRelativePathByRepoPath: Record<string, string>,
): Promise<{
  workspacePath: string;
  workspaceFolders: SessionWorkspaceFolder[];
  gitRepos: SessionGitRepoContext[];
  activeRepoPath?: string;
}> {
  const sessionRootPath = getSessionRootPath(projectKey, sessionName);
  const workspacePath = path.join(sessionRootPath, 'workspace');
  await fs.mkdir(workspacePath, { recursive: true });

  const folderEntries = buildProjectFolderEntries(folderPaths);
  const hasMultipleFolders = folderEntries.length > 1;
  const workspaceFolders: SessionWorkspaceFolder[] = [];
  const gitRepos: SessionGitRepoContext[] = [];
  const sourceRepoPaths = contexts.map((context) => context.repoPath);

  for (const folderEntry of folderEntries) {
    const folderWorkspaceRelativePath = hasMultipleFolders ? folderEntry.entryName : '.';
    const folderWorkspacePath = hasMultipleFolders
      ? path.join(workspacePath, folderEntry.entryName)
      : workspacePath;
    const nestedRepoPaths = sourceRepoPaths.filter((repoPath) => (
      isPathInside(folderEntry.sourcePath, repoPath)
    ));

    await copyFolderWithoutGitRepos(folderEntry.sourcePath, folderWorkspacePath, nestedRepoPaths);
    workspaceFolders.push(buildLocalWorkspaceFolderMapping(
      folderEntry.sourcePath,
      folderWorkspacePath,
      folderWorkspaceRelativePath,
      'copy',
    ));
  }

  for (const context of contexts) {
    const relativeRepoPath = getWorkspaceRelativeRepoPath(
      repoRelativePathByRepoPath,
      projectPath,
      context.repoPath,
    );
    const normalizedRelativeRepoPath = normalizeRelativeWorkspacePath(relativeRepoPath === '' ? '.' : relativeRepoPath);
    const targetWorktreePath = normalizedRelativeRepoPath === '.'
      ? workspacePath
      : path.join(workspacePath, normalizedRelativeRepoPath);

    await fs.rm(targetWorktreePath, { recursive: true, force: true }).catch(() => {
      // Ignore cleanup before worktree creation.
    });
    await fs.mkdir(path.dirname(targetWorktreePath), { recursive: true });

    const baseBranch = context.baseBranch || await resolveDefaultBaseBranch(context.repoPath);
    const branchName = buildSessionBranchName(sessionName, context.repoPath);
    const git = simpleGit(context.repoPath);
    await git.raw(['worktree', 'add', '-b', branchName, targetWorktreePath, baseBranch]);

    gitRepos.push({
      sourceRepoPath: context.repoPath,
      relativeRepoPath: normalizedRelativeRepoPath === '.' ? '' : normalizedRelativeRepoPath,
      worktreePath: targetWorktreePath,
      branchName,
      baseBranch,
    });

    const existingWorkspaceFolderIndex = workspaceFolders.findIndex((workspaceFolder) => (
      workspaceFolder.workspacePath === targetWorktreePath
    ));
    const workspaceFolderMapping = buildLocalWorkspaceFolderMapping(
      context.repoPath,
      targetWorktreePath,
      normalizedRelativeRepoPath,
      'worktree',
    );
    if (existingWorkspaceFolderIndex >= 0) {
      workspaceFolders[existingWorkspaceFolderIndex] = workspaceFolderMapping;
    } else {
      workspaceFolders.push(workspaceFolderMapping);
    }
  }

  return {
    workspacePath,
    workspaceFolders,
    activeRepoPath: contexts[0]?.repoPath,
    gitRepos,
  };
}

async function createLocalSourceSession(
  projectKey: string,
  projectPath: string,
  sessionName: string,
  folderPaths: string[],
  contexts: SessionCreateGitContextInput[],
  repoRelativePathByRepoPath: Record<string, string>,
): Promise<{
  workspacePath: string;
  workspaceFolders: SessionWorkspaceFolder[];
  gitRepos: SessionGitRepoContext[];
  activeRepoPath?: string;
}> {
  const folderEntries = buildProjectFolderEntries(folderPaths);
  const hasMultipleFolders = folderEntries.length > 1;
  let workspacePath = projectPath;
  const workspaceFolders: SessionWorkspaceFolder[] = [];

  if (hasMultipleFolders) {
    const sessionRootPath = getSessionRootPath(projectKey, sessionName);
    workspacePath = path.join(sessionRootPath, 'workspace');
    await fs.mkdir(workspacePath, { recursive: true });

    for (const folderEntry of folderEntries) {
      const targetPath = path.join(workspacePath, folderEntry.entryName);
      await linkWorkspaceFolder(folderEntry.sourcePath, targetPath);
      workspaceFolders.push(buildLocalWorkspaceFolderMapping(
        folderEntry.sourcePath,
        targetPath,
        folderEntry.entryName,
        'link',
      ));
    }
  } else {
    workspaceFolders.push(buildLocalWorkspaceFolderMapping(projectPath, projectPath, '.', 'direct'));
  }

  const gitRepos = await Promise.all(contexts.map(async (context) => {
    const relativeRepoPath = getWorkspaceRelativeRepoPath(
      repoRelativePathByRepoPath,
      projectPath,
      context.repoPath,
    );
    const normalizedRelativeRepoPath = relativeRepoPath === '.' ? '' : relativeRepoPath;
    const branchName = await resolveRepoHeadBranch(context.repoPath);
    const baseBranch = context.baseBranch || await resolveDefaultBaseBranch(context.repoPath);
    const worktreePath = hasMultipleFolders
      ? path.join(workspacePath, normalizeRelativeWorkspacePath(normalizedRelativeRepoPath || '.'))
      : context.repoPath;

    return {
      sourceRepoPath: context.repoPath,
      relativeRepoPath: normalizedRelativeRepoPath,
      worktreePath,
      branchName,
      baseBranch,
    } satisfies SessionGitRepoContext;
  }));

  return {
    workspacePath,
    workspaceFolders,
    activeRepoPath: contexts[0]?.repoPath,
    gitRepos,
  };
}

async function provisionSessionWorkspace(
  projectIdOrPath: string,
  gitContextsOrBaseBranch: string | SessionCreateGitContextInput[],
  options: { sessionName?: string; resolvedInput?: ResolvedSessionWorkspaceContextInput } = {},
): Promise<ProvisionedSessionWorkspace> {
  const resolvedInput = options.resolvedInput
    ?? await resolveSessionWorkspaceContextInput(projectIdOrPath, gitContextsOrBaseBranch);

  const sessionName = normalizeOptionalText(options.sessionName) || buildSessionName();
  const projectKey = getSessionProjectKey(resolvedInput.projectId, resolvedInput.normalizedProjectPath);
  let workspaceMode: SessionWorkspaceMode = 'folder';
  let workspacePath = resolvedInput.normalizedProjectPath;
  let workspaceFolders: SessionWorkspaceFolder[] = [
    buildLocalWorkspaceFolderMapping(
      resolvedInput.normalizedProjectPath,
      resolvedInput.normalizedProjectPath,
      '.',
      'direct',
    ),
  ];
  let activeRepoPath: string | undefined;
  let gitRepos: SessionGitRepoContext[] = [];

  if (resolvedInput.workspacePreference === 'local') {
    workspaceMode = 'local_source';
    const localResult = await createLocalSourceSession(
      projectKey,
      resolvedInput.normalizedProjectPath,
      sessionName,
      resolvedInput.normalizedFolderPaths,
      resolvedInput.normalizedContexts,
      resolvedInput.repoRelativePathByRepoPath,
    );
    workspacePath = localResult.workspacePath;
    workspaceFolders = localResult.workspaceFolders;
    activeRepoPath = localResult.activeRepoPath;
    gitRepos = localResult.gitRepos;
  } else if (
    resolvedInput.normalizedFolderPaths.length === 1
    && resolvedInput.discoveredRepoPaths.length === 1
    && !resolvedInput.hasOverlap
    && (resolvedInput.repoRelativePathByRepoPath[resolvedInput.discoveredRepoPaths[0]] ?? '') === ''
  ) {
    workspaceMode = 'single_worktree';
    const singleResult = await createSingleRepoSession(
      projectKey,
      resolvedInput.normalizedProjectPath,
      sessionName,
      resolvedInput.normalizedContexts[0] ?? { repoPath: resolvedInput.discoveredRepoPaths[0] },
    );
    workspacePath = singleResult.workspacePath;
    workspaceFolders = singleResult.workspaceFolders;
    activeRepoPath = singleResult.activeRepoPath;
    gitRepos = singleResult.gitRepos;
  } else {
    const workspaceResult = await createWorkspaceModeSession(
      projectKey,
      resolvedInput.normalizedProjectPath,
      sessionName,
      resolvedInput.normalizedFolderPaths,
      resolvedInput.normalizedContexts,
      resolvedInput.repoRelativePathByRepoPath,
    );
    workspaceMode = resolvedInput.discoveredRepoPaths.length > 0 && !resolvedInput.hasOverlap
      ? 'multi_repo_worktree'
      : 'folder';
    workspacePath = workspaceResult.workspacePath;
    workspaceFolders = workspaceResult.workspaceFolders;
    activeRepoPath = workspaceResult.activeRepoPath;
    gitRepos = workspaceResult.gitRepos;
  }

  return {
    sessionName,
    projectId: resolvedInput.projectId,
    projectPath: resolvedInput.normalizedProjectPath,
    workspacePath,
    workspaceFolders,
    workspaceMode,
    activeRepoPath,
    gitRepos,
    contextFingerprint: resolvedInput.contextFingerprint,
  };
}

async function persistSessionMetadataFromProvision(
  provision: ProvisionedSessionWorkspace,
  metadata: SessionCreateMetadata,
): Promise<SessionMetadata> {
  const sessionData: SessionMetadata = {
    sessionName: provision.sessionName,
    projectId: provision.projectId,
    projectPath: provision.projectPath,
    workspacePath: provision.workspacePath,
    workspaceFolders: provision.workspaceFolders,
    workspaceMode: provision.workspaceMode,
    activeRepoPath: provision.activeRepoPath,
    gitRepos: provision.gitRepos,
    agent: metadata.agent,
    agentProvider: metadata.agentProvider ?? (metadata.agent as AgentProvider),
    model: metadata.model,
    reasoningEffort: metadata.reasoningEffort,
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

  return sessionData;
}

function toSessionCreateResult(metadata: SessionMetadata): SessionCreateResult {
  const compatibility = toCompatibilityFields(metadata);
  return {
    success: true,
    sessionName: metadata.sessionName,
    projectId: metadata.projectId,
    workspacePath: metadata.workspacePath,
    workspaceFolders: metadata.workspaceFolders,
    workspaceMode: metadata.workspaceMode,
    activeRepoPath: metadata.activeRepoPath,
    gitRepos: metadata.gitRepos,
    branchName: compatibility.branchName,
    worktreePath: compatibility.worktreePath,
  };
}

function getProvisionRepoPaths(
  provision: Pick<ProvisionedSessionWorkspace, 'projectPath' | 'gitRepos'>,
): string[] {
  if (provision.gitRepos.length > 0) {
    return provision.gitRepos.map((gitRepo) => gitRepo.sourceRepoPath);
  }
  return [];
}

async function terminateProvisionedStartupCommand(
  provision: Pick<
    ProvisionedSessionWorkspace,
    'projectId' | 'projectPath' | 'sessionName' | 'startupCommandMode' | 'startupCommandProcessPid'
  >,
): Promise<void> {
  const projectKey = getSessionProjectKey(provision.projectId, provision.projectPath);
  if (provision.startupCommandMode === 'tmux') {
    await terminateSessionTerminalSessions(provision.sessionName);
    await clearTrackedSessionProcess(projectKey, provision.sessionName, 'startup-script');
    return;
  }

  const trackedProcess = await getTrackedSessionProcess(projectKey, provision.sessionName, 'startup-script');
  if (trackedProcess) {
    await stopTrackedSessionProcess(projectKey, provision.sessionName, 'startup-script');
    return;
  }

  if (provision.startupCommandMode === 'shell' && provision.startupCommandProcessPid) {
    await terminateProcessGracefully({
      pid: provision.startupCommandProcessPid,
      processGroupId: provision.startupCommandProcessPid,
    }).catch(() => {
      // Ignore missing or already-exited startup processes.
    });
  }
}

async function launchStartupCommandForProvision(
  provision: ProvisionedSessionWorkspace,
  startupScript: string,
  agentCli?: string,
): Promise<Pick<ProvisionedSessionWorkspace, 'startupCommandSignature' | 'startupCommandMode' | 'startupCommandProcessPid'>> {
  const signature = buildStartupCommandSignature(startupScript, agentCli);
  const repoPaths = getProvisionRepoPaths(provision);
  const environments = await getSessionTerminalEnvironments(repoPaths, agentCli).catch((error) => {
    console.warn('Failed to resolve startup command terminal environment:', error);
    return [];
  });
  const persistenceMode = resolveStartupCommandPersistenceMode();

  if (persistenceMode === 'tmux') {
    const { spawnSync } = await import('child_process');
    const tmuxSession = getTmuxSessionName(provision.sessionName, 'terminal');
    const terminalEnv = buildTerminalProcessEnv();
    const hasSessionResult = spawnSync('tmux', ['has-session', '-t', tmuxSession], {
      stdio: 'ignore',
      env: terminalEnv as NodeJS.ProcessEnv,
    });

    if (typeof hasSessionResult.status === 'number' && hasSessionResult.status !== 0) {
      spawnSync('tmux', ['set-environment', '-gu', 'NODE_ENV'], {
        stdio: 'ignore',
        env: terminalEnv as NodeJS.ProcessEnv,
      });
      const createArgs = ['new-session', '-d'];
      for (const environment of environments) {
        if (!environment.value) continue;
        createArgs.push('-e', `${environment.name}=${environment.value}`);
      }
      createArgs.push('-c', provision.workspacePath, '-s', tmuxSession);

      const createResult = spawnSync('tmux', createArgs, {
        stdio: 'ignore',
        env: terminalEnv as NodeJS.ProcessEnv,
      });
      if (typeof createResult.status === 'number' && createResult.status !== 0) {
        throw new Error(`tmux new-session exited with status ${createResult.status}`);
      }
    }

    const sendLiteralResult = spawnSync('tmux', ['send-keys', '-t', tmuxSession, '-l', startupScript], {
      stdio: 'ignore',
      env: terminalEnv as NodeJS.ProcessEnv,
    });
    if (typeof sendLiteralResult.status === 'number' && sendLiteralResult.status !== 0) {
      throw new Error(`tmux send-keys -l exited with status ${sendLiteralResult.status}`);
    }

    const sendResult = spawnSync('tmux', ['send-keys', '-t', tmuxSession, 'C-m'], {
      stdio: 'ignore',
      env: terminalEnv as NodeJS.ProcessEnv,
    });
    if (typeof sendResult.status === 'number' && sendResult.status !== 0) {
      throw new Error(`tmux send-keys exited with status ${sendResult.status}`);
    }

    return {
      startupCommandSignature: signature,
      startupCommandMode: 'tmux',
    };
  }

  const shellCommand = getStartupShellCommand();
  const processRecord = await launchTrackedSessionProcess({
    role: 'startup-script',
    source: 'startup-script',
    sessionName: provision.sessionName,
    projectPath: getSessionProjectKey(provision.projectId, provision.projectPath),
    workspacePath: provision.workspacePath,
    command: startupScript,
    shellCommand,
    env: Object.fromEntries(environments.map((entry) => [entry.name, entry.value])),
  });

  return {
    startupCommandSignature: signature,
    startupCommandMode: 'shell',
    startupCommandProcessPid: processRecord.pid,
  };
}

async function syncStartupCommandForProvision(
  provision: ProvisionedSessionWorkspace,
  startupScript: string | null | undefined,
  agentCli?: string,
): Promise<ProvisionedSessionWorkspace> {
  const normalizedStartupScript = normalizeStartupScript(startupScript);
  if (!normalizedStartupScript) {
    if (provision.startupCommandSignature) {
      await terminateProvisionedStartupCommand(provision);
      return {
        ...provision,
        startupCommandSignature: undefined,
        startupCommandMode: undefined,
        startupCommandProcessPid: undefined,
      };
    }
    return provision;
  }

  const signature = buildStartupCommandSignature(normalizedStartupScript, agentCli);
  if (provision.startupCommandSignature === signature) {
    return provision;
  }

  if (provision.startupCommandSignature) {
    await terminateProvisionedStartupCommand(provision);
  }

  const startupState = await launchStartupCommandForProvision(provision, normalizedStartupScript, agentCli);
  return {
    ...provision,
    ...startupState,
  };
}

async function cleanupWorkspaceRoot(
  workspacePath: string,
  workspaceMode: SessionWorkspaceMode,
): Promise<void> {
  const sessionRootPath = path.dirname(workspacePath);
  const managedProjectsRoot = path.join(os.homedir(), '.viba', 'projects');
  if (workspaceMode === 'folder' || workspaceMode === 'local_source') {
    if (!sessionRootPath || !sessionRootPath.startsWith(managedProjectsRoot)) {
      return;
    }
  }

  if (sessionRootPath && sessionRootPath.startsWith(managedProjectsRoot)) {
    try {
      await fs.rm(sessionRootPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors.
    }
  }
}

async function cleanupProvisionedSessionWorkspace(
  provision: Pick<
    ProvisionedSessionWorkspace,
    'projectId' | 'projectPath' | 'sessionName' | 'workspaceMode' | 'workspacePath' | 'gitRepos' | 'startupCommandMode' | 'startupCommandProcessPid'
  >,
): Promise<void> {
  await terminateProvisionedStartupCommand(provision);

  if (provision.workspaceMode === 'single_worktree' || provision.workspaceMode === 'multi_repo_worktree') {
    for (const gitRepo of provision.gitRepos) {
      await removeWorktree(gitRepo.sourceRepoPath, gitRepo.worktreePath, gitRepo.branchName);
    }
  }

  await cleanupWorkspaceRoot(provision.workspacePath, provision.workspaceMode);
}

function getPreparationExpiryTimestamp(
  now = Date.now(),
): string {
  return new Date(now + SESSION_WORKSPACE_PREPARATION_TTL_MS).toISOString();
}

function rowToSessionWorkspacePreparation(
  row: SessionWorkspacePreparationRow,
): (SessionWorkspacePreparation & { status: string; cancelRequested: boolean }) | null {
  const payload = parseSessionWorkspacePreparationPayload(row.payload_json);
  if (!payload) return null;

  return {
    preparationId: row.preparation_id,
    sessionName: payload.sessionName,
    projectId: payload.projectId,
    projectPath: payload.projectPath,
    contextFingerprint: row.context_fingerprint,
    workspacePath: payload.workspacePath,
    workspaceFolders: payload.workspaceFolders,
    workspaceMode: payload.workspaceMode,
    activeRepoPath: payload.activeRepoPath,
    gitRepos: payload.gitRepos,
    startupCommandSignature: payload.startupCommandSignature,
    expiresAt: row.expires_at,
    status: row.status,
    cancelRequested: row.cancel_requested === 1,
  };
}

async function sweepExpiredSessionWorkspacePreparations(): Promise<void> {
  const db = getLocalDb();
  const nowIso = new Date().toISOString();
  const expiredRows = db.prepare(`
    SELECT
      preparation_id, project_path, context_fingerprint, session_name, payload_json,
      status, cancel_requested, created_at, updated_at, expires_at, consumed_at, released_at
    FROM session_workspace_preparations
    WHERE
      status = @readyStatus
      AND expires_at <= @now
  `).all({
    readyStatus: SESSION_WORKSPACE_PREPARATION_STATUS_READY,
    now: nowIso,
  }) as SessionWorkspacePreparationRow[];

  for (const row of expiredRows) {
    const payload = parseSessionWorkspacePreparationPayload(row.payload_json);
    if (payload) {
      try {
        await cleanupProvisionedSessionWorkspace({
          projectId: payload.projectId,
          projectPath: payload.projectPath,
          sessionName: payload.sessionName,
          workspaceMode: payload.workspaceMode,
          workspacePath: payload.workspacePath,
          gitRepos: payload.gitRepos,
          startupCommandMode: payload.startupCommandMode,
          startupCommandProcessPid: payload.startupCommandProcessPid,
        });
      } catch (cleanupError) {
        console.warn('Failed to cleanup expired session workspace preparation:', cleanupError);
      }
    }

    db.prepare(`
      UPDATE session_workspace_preparations
      SET
        status = @releasedStatus,
        updated_at = @now,
        released_at = COALESCE(released_at, @now)
      WHERE preparation_id = @preparationId
    `).run({
      releasedStatus: SESSION_WORKSPACE_PREPARATION_STATUS_RELEASED,
      now: nowIso,
      preparationId: row.preparation_id,
    });
  }

  db.prepare(`
    DELETE FROM session_workspace_preparations
    WHERE
      status IN (@consumedStatus, @releasedStatus)
      AND updated_at <= @cutoff
  `).run({
    consumedStatus: SESSION_WORKSPACE_PREPARATION_STATUS_CONSUMED,
    releasedStatus: SESSION_WORKSPACE_PREPARATION_STATUS_RELEASED,
    cutoff: new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString(),
  });
}

async function getSessionPromptsDir(): Promise<string> {
  const promptsDir = path.join(os.homedir(), '.viba', 'session-prompts');
  await fs.mkdir(promptsDir, { recursive: true });
  return promptsDir;
}

export async function saveSessionMetadata(metadata: SessionMetadata): Promise<void> {
  const db = getLocalDb();
  const compatibility = toCompatibilityFields(metadata);

  const transaction = db.transaction((nextMetadata: SessionMetadata) => {
    const agentProvider = normalizeOptionalText(nextMetadata.agentProvider ?? nextMetadata.agent) ?? nextMetadata.agent;
    const reasoningEffort = normalizeNullableProviderReasoningEffort(
      agentProvider,
      nextMetadata.reasoningEffort,
    );
    db.prepare(`
      INSERT OR REPLACE INTO sessions (
        session_name, project_id, project_path, workspace_path, workspace_folders_json, workspace_mode, active_repo_path,
        repo_path, worktree_path, branch_name, base_branch,
        agent, model, reasoning_effort, thread_id, active_turn_id, run_state,
        last_error, last_activity_at, title, dev_server_script, initialized, timestamp
      ) VALUES (
        @sessionName, @projectId, @projectPath, @workspacePath, @workspaceFoldersJson, @workspaceMode, @activeRepoPath,
        @repoPath, @worktreePath, @branchName, @baseBranch,
        @agent, @model, @reasoningEffort, @threadId, @activeTurnId, @runState,
        @lastError, @lastActivityAt, @title, @devServerScript, @initialized, @timestamp
      )
    `).run({
      sessionName: nextMetadata.sessionName,
      projectId: nextMetadata.projectId ?? null,
      projectPath: nextMetadata.projectPath,
      workspacePath: nextMetadata.workspacePath,
      workspaceFoldersJson: JSON.stringify(nextMetadata.workspaceFolders ?? []),
      workspaceMode: nextMetadata.workspaceMode,
      activeRepoPath: nextMetadata.activeRepoPath ?? null,
      repoPath: compatibility.repoPath ?? null,
      worktreePath: compatibility.worktreePath ?? null,
      branchName: compatibility.branchName ?? null,
      baseBranch: compatibility.baseBranch ?? null,
      agent: agentProvider,
      model: nextMetadata.model,
      reasoningEffort,
      threadId: normalizeNullableText(nextMetadata.threadId),
      activeTurnId: normalizeNullableText(nextMetadata.activeTurnId),
      runState: normalizeNullableText(nextMetadata.runState),
      lastError: normalizeNullableText(nextMetadata.lastError),
      lastActivityAt: normalizeNullableText(nextMetadata.lastActivityAt),
      title: nextMetadata.title ?? null,
      devServerScript: nextMetadata.devServerScript ?? null,
      initialized: nextMetadata.initialized === undefined ? null : Number(nextMetadata.initialized),
      timestamp: nextMetadata.timestamp,
    });

    db.prepare(`DELETE FROM session_git_repos WHERE session_name = ?`).run(nextMetadata.sessionName);
    const insertGitRepo = db.prepare(`
      INSERT INTO session_git_repos (
        session_name, source_repo_path, relative_repo_path, worktree_path, branch_name, base_branch
      ) VALUES (
        @sessionName, @sourceRepoPath, @relativeRepoPath, @worktreePath, @branchName, @baseBranch
      )
    `);

    for (const gitRepo of nextMetadata.gitRepos) {
      insertGitRepo.run({
        sessionName: nextMetadata.sessionName,
        sourceRepoPath: gitRepo.sourceRepoPath,
        relativeRepoPath: gitRepo.relativeRepoPath,
        worktreePath: gitRepo.worktreePath,
        branchName: gitRepo.branchName,
        baseBranch: gitRepo.baseBranch ?? null,
      });
    }
  });

  transaction(metadata);
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
    const agentProvider = contextData.agentProvider;
    const db = getLocalDb();
    db.prepare(`
      INSERT OR REPLACE INTO session_launch_contexts (
        session_name, title, initial_message, raw_initial_message, startup_script,
        attachment_paths_json, attachment_names_json, project_repo_paths_json, project_repo_relative_paths_json,
        agent_provider, model, reasoning_effort, session_mode, is_resume, timestamp
      ) VALUES (
        @sessionName, @title, @initialMessage, @rawInitialMessage, @startupScript,
        @attachmentPathsJson, @attachmentNamesJson, @projectRepoPathsJson, @projectRepoRelativePathsJson,
        @agentProvider, @model, @reasoningEffort, @sessionMode, @isResume, @timestamp
      )
    `).run({
      sessionName: contextData.sessionName,
      title: contextData.title ?? null,
      initialMessage: contextData.initialMessage ?? null,
      rawInitialMessage: contextData.rawInitialMessage ?? null,
      startupScript: contextData.startupScript ?? null,
      attachmentPathsJson: contextData.attachmentPaths ? JSON.stringify(contextData.attachmentPaths) : null,
      attachmentNamesJson: contextData.attachmentNames ? JSON.stringify(contextData.attachmentNames) : null,
      projectRepoPathsJson: contextData.projectRepoPaths ? JSON.stringify(contextData.projectRepoPaths) : null,
      projectRepoRelativePathsJson: contextData.projectRepoRelativePaths
        ? JSON.stringify(contextData.projectRepoRelativePaths)
        : null,
      agentProvider: agentProvider ?? null,
      model: contextData.model ?? null,
      reasoningEffort: normalizeNullableProviderReasoningEffort(
        agentProvider,
        contextData.reasoningEffort,
      ),
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
        attachment_paths_json, attachment_names_json, project_repo_paths_json, project_repo_relative_paths_json,
        agent_provider, model, reasoning_effort, session_mode, is_resume, timestamp
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

export async function readSessionLaunchContext(
  sessionName: string
): Promise<{ success: boolean; context?: SessionLaunchContext; error?: string }> {
  try {
    const db = getLocalDb();
    const row = db.prepare(`
      SELECT
        session_name, title, initial_message, raw_initial_message, startup_script,
        attachment_paths_json, attachment_names_json, project_repo_paths_json, project_repo_relative_paths_json,
        agent_provider, model, reasoning_effort, session_mode, is_resume, timestamp
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

  const launchContextResult = await readSessionLaunchContext(sessionName);
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
          .map((name) => path.join(`${metadata.workspacePath}-attachments`, name))
      )
    );

  const prefill: SessionPrefillContext = {
    sourceSessionName: sessionName,
    projectId: metadata.projectId,
    projectPath: metadata.projectPath,
    repoPath: metadata.repoPath,
    title: launchContext?.title || metadata.title,
    initialMessage: launchContext?.rawInitialMessage || launchContext?.initialMessage,
    attachmentPaths,
    agentProvider: (launchContext?.agentProvider || metadata.agent) as AgentProvider,
    model: launchContext?.model || metadata.model,
    reasoningEffort: launchContext?.reasoningEffort || metadata.reasoningEffort,
  };

  return { success: true, context: prefill };
}

export async function copySessionAttachments(
  sourceSessionName: string,
  targetWorkspacePath: string,
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

    const sourceAttachmentsDir = `${metadata.workspacePath}-attachments`;
    const targetAttachmentsDir = `${targetWorkspacePath}-attachments`;
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
        session_name, project_id, project_path, workspace_path, workspace_folders_json, workspace_mode, active_repo_path,
        repo_path, worktree_path, branch_name, base_branch,
        agent, model, reasoning_effort, thread_id, active_turn_id, run_state,
        last_error, last_activity_at, title, dev_server_script, initialized, timestamp
      FROM sessions
      WHERE session_name = ?
    `).get(sessionName) as SessionRow | undefined;

    if (!row) return null;
    return await rowToSessionMetadata(row);
  } catch {
    return null;
  }
}

export async function listSessions(projectPath?: string): Promise<SessionMetadata[]> {
  try {
    const db = getLocalDb();
    const projectId = projectPath ? getProjectById(projectPath)?.id ?? null : null;
    const filterColumn = projectPath ? (projectId ? 'project_id' : 'project_path') : null;
    const query = projectPath
      ? `
        SELECT
          session_name, project_id, project_path, workspace_path, workspace_folders_json, workspace_mode, active_repo_path,
          repo_path, worktree_path, branch_name, base_branch,
          agent, model, reasoning_effort, thread_id, active_turn_id, run_state,
          last_error, last_activity_at, title, dev_server_script, initialized, timestamp
        FROM sessions
        WHERE ${filterColumn} = ?
        ORDER BY timestamp DESC
      `
      : `
        SELECT
          session_name, project_id, project_path, workspace_path, workspace_folders_json, workspace_mode, active_repo_path,
          repo_path, worktree_path, branch_name, base_branch,
          agent, model, reasoning_effort, thread_id, active_turn_id, run_state,
          last_error, last_activity_at, title, dev_server_script, initialized, timestamp
        FROM sessions
        ORDER BY timestamp DESC
      `;

    const rows = projectPath
      ? (db.prepare(query).all(projectId ?? projectPath) as SessionRow[])
      : (db.prepare(query).all() as SessionRow[]);

    return Promise.all(rows.map((row) => rowToSessionMetadata(row)));
  } catch (error) {
    console.error('Failed to list sessions:', error);
    return [];
  }
}

export async function getSessionAgentRuntimeState(sessionName: string): Promise<SessionAgentRuntimeState | null> {
  const metadata = await getSessionMetadata(sessionName);
  return metadata ? toSessionAgentRuntimeState(metadata) : null;
}

export async function updateSessionAgentRuntimeState(
  sessionName: string,
  updates: SessionAgentRuntimeUpdate,
): Promise<{ success: boolean; runtime?: SessionAgentRuntimeState; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const nextAgentProvider = normalizeOptionalText(updates.agentProvider) ?? metadata.agent;
    const nextModel = normalizeOptionalText(updates.model) ?? metadata.model;
    const nextMetadata: SessionMetadata = {
      ...metadata,
      agent: nextAgentProvider,
      agentProvider: nextAgentProvider as AgentProvider,
      model: nextModel,
      reasoningEffort: updates.reasoningEffort === undefined
        ? metadata.reasoningEffort
        : normalizeProviderReasoningEffort(nextAgentProvider, updates.reasoningEffort),
      threadId: updates.threadId === undefined ? metadata.threadId : (normalizeOptionalText(updates.threadId) ?? undefined),
      activeTurnId: updates.activeTurnId === undefined
        ? metadata.activeTurnId
        : (normalizeOptionalText(updates.activeTurnId) ?? undefined),
      runState: updates.runState === undefined
        ? metadata.runState
        : (normalizeOptionalText(updates.runState) as SessionAgentRunState | undefined),
      lastError: updates.lastError === undefined ? metadata.lastError : (normalizeOptionalText(updates.lastError) ?? undefined),
      lastActivityAt: updates.lastActivityAt === undefined
        ? metadata.lastActivityAt
        : (normalizeOptionalText(updates.lastActivityAt) ?? undefined),
    };

    await saveSessionMetadata(nextMetadata);
    return { success: true, runtime: toSessionAgentRuntimeState(nextMetadata) };
  } catch (e: unknown) {
    console.error('Failed to update session agent runtime state:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function listSessionAgentHistory(
  sessionName: string,
  query: SessionAgentHistoryQuery = {},
): Promise<SessionAgentHistoryItem[]> {
  try {
    const db = getLocalDb();
    const clauses = ['session_name = ?'];
    const params: Array<string | number> = [sessionName];
    const threadId = normalizeOptionalText(query.threadId);
    const turnId = normalizeOptionalText(query.turnId);
    const limit = typeof query.limit === 'number' && Number.isFinite(query.limit) && query.limit > 0
      ? Math.floor(query.limit)
      : undefined;

    if (threadId) {
      clauses.push('thread_id = ?');
      params.push(threadId);
    }

    if (turnId) {
      clauses.push('turn_id = ?');
      params.push(turnId);
    }

    let sql = `
      SELECT
        session_name, item_id, thread_id, turn_id, ordinal, kind, status,
        payload_json, created_at, updated_at
      FROM session_agent_history_items
      WHERE ${clauses.join(' AND ')}
      ORDER BY ordinal ASC, created_at ASC, item_id ASC
    `;

    if (limit !== undefined) {
      sql += '\nLIMIT ?';
      params.push(limit);
    }

    const rows = db.prepare(sql).all(...params) as SessionAgentHistoryRow[];
    return sortSessionHistoryForTimeline(rows
      .map((row) => toSessionAgentHistoryItem(row))
      .filter((item): item is SessionAgentHistoryItem => Boolean(item)));
  } catch (e) {
    console.error('Failed to list session agent history:', e);
    return [];
  }
}

export async function getSessionAgentSnapshot(
  sessionName: string,
): Promise<{ success: boolean; snapshot?: SessionAgentSnapshot; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const history = await listSessionAgentHistory(sessionName);
    return {
      success: true,
      snapshot: {
        metadata,
        runtime: toSessionAgentRuntimeState(metadata),
        history,
      },
    };
  } catch (e: unknown) {
    console.error('Failed to get session agent snapshot:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

type NormalizedHistoryWrite = {
  itemId: string;
  entry: HistoryEntry;
  kind: HistoryEntry['kind'];
  payloadJson: string;
  threadIdProvided: boolean;
  threadId: string | null;
  turnIdProvided: boolean;
  turnId: string | null;
  ordinal: number;
  statusProvided: boolean;
  itemStatus: string | null;
  createdAt: string;
  updatedAt: string;
};

function normalizeHistoryWrite(input: SessionAgentHistoryInput): NormalizedHistoryWrite | null {
  const itemId = normalizeOptionalText(input.id);
  if (!itemId) return null;

  const {
    threadId,
    turnId,
    ordinal,
    itemStatus,
    createdAt,
    updatedAt,
    ...entry
  } = input;

  const normalizedEntry = { ...entry, id: itemId } as HistoryEntry;
  const normalizedOrdinal = typeof ordinal === 'number' && Number.isFinite(ordinal)
    ? Math.max(0, Math.floor(ordinal))
    : 0;

  return {
    itemId,
    entry: normalizedEntry,
    kind: normalizedEntry.kind,
    payloadJson: JSON.stringify(normalizedEntry),
    threadIdProvided: Object.prototype.hasOwnProperty.call(input, 'threadId'),
    threadId: normalizeNullableText(threadId),
    turnIdProvided: Object.prototype.hasOwnProperty.call(input, 'turnId'),
    turnId: normalizeNullableText(turnId),
    ordinal: normalizedOrdinal,
    statusProvided: Object.prototype.hasOwnProperty.call(input, 'itemStatus'),
    itemStatus: normalizeNullableText(itemStatus),
    createdAt: normalizeOptionalText(createdAt) ?? new Date().toISOString(),
    updatedAt: normalizeOptionalText(updatedAt) ?? new Date().toISOString(),
  };
}

function parseHistoryEntryPayload(value: string): HistoryEntry | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const entry = parsed as Partial<HistoryEntry>;
    return typeof entry.kind === 'string' && typeof entry.id === 'string'
      ? (entry as HistoryEntry)
      : null;
  } catch {
    return null;
  }
}

function mergeHistoryEntry(existing: HistoryEntry | null, next: HistoryEntry): HistoryEntry {
  if (!existing || existing.kind !== next.kind) {
    return next;
  }

  switch (next.kind) {
    case 'user': {
      const incoming = next as Extract<HistoryEntry, { kind: 'user' }>;
      const current = existing as Extract<HistoryEntry, { kind: 'user' }>;
      return {
        ...incoming,
        text: incoming.text || current.text,
      };
    }
    case 'assistant': {
      const incoming = next as Extract<HistoryEntry, { kind: 'assistant' }>;
      const current = existing as Extract<HistoryEntry, { kind: 'assistant' }>;
      return {
        ...incoming,
        text: incoming.text || current.text,
        phase: incoming.phase ?? current.phase,
      };
    }
    case 'reasoning': {
      const incoming = next as Extract<HistoryEntry, { kind: 'reasoning' }>;
      const current = existing as Extract<HistoryEntry, { kind: 'reasoning' }>;
      return {
        ...incoming,
        summary: incoming.summary || current.summary,
        text: incoming.text || current.text,
      };
    }
    case 'command': {
      const incoming = next as Extract<HistoryEntry, { kind: 'command' }>;
      const current = existing as Extract<HistoryEntry, { kind: 'command' }>;
      return {
        ...incoming,
        output: incoming.output || current.output,
        status: incoming.status || current.status,
        exitCode: incoming.exitCode ?? current.exitCode,
        toolName: incoming.toolName ?? current.toolName,
        toolInput: incoming.toolInput ?? current.toolInput,
      };
    }
    case 'tool': {
      const incoming = next as Extract<HistoryEntry, { kind: 'tool' }>;
      const current = existing as Extract<HistoryEntry, { kind: 'tool' }>;
      return {
        ...incoming,
        source: incoming.source || current.source,
        server: incoming.server ?? current.server,
        status: incoming.status || current.status,
        input: incoming.input ?? current.input,
        message: incoming.message ?? current.message,
        result: incoming.result ?? current.result,
        error: incoming.error ?? current.error,
      };
    }
    case 'fileChange': {
      const incoming = next as Extract<HistoryEntry, { kind: 'fileChange' }>;
      const current = existing as Extract<HistoryEntry, { kind: 'fileChange' }>;
      return {
        ...incoming,
        status: incoming.status || current.status,
        output: incoming.output || current.output,
        changes: incoming.changes.length > 0 ? incoming.changes : current.changes,
      };
    }
    case 'plan': {
      const incoming = next as Extract<HistoryEntry, { kind: 'plan' }>;
      const current = existing as Extract<HistoryEntry, { kind: 'plan' }>;
      const steps = incoming.steps && incoming.steps.length > 0
        ? incoming.steps
        : current.steps;
      return {
        ...incoming,
        text: incoming.text || current.text || buildPlanText(steps ?? []),
        steps,
      };
    }
  }
}

export async function upsertSessionAgentHistory(
  sessionName: string,
  entries: SessionAgentHistoryInput[],
): Promise<{ success: boolean; history?: SessionAgentHistoryItem[]; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const normalizedEntries = entries
      .map((entry) => normalizeHistoryWrite(entry))
      .filter((entry): entry is NormalizedHistoryWrite => Boolean(entry));

    if (normalizedEntries.length === 0) {
      return { success: true, history: await listSessionAgentHistory(sessionName) };
    }

    const db = getLocalDb();
    const selectExisting = db.prepare(`
      SELECT
        session_name, item_id, thread_id, turn_id, ordinal, kind, status,
        payload_json, created_at, updated_at
      FROM session_agent_history_items
      WHERE session_name = ? AND item_id = ?
    `);
    const insertOrReplace = db.prepare(`
      INSERT OR REPLACE INTO session_agent_history_items (
        session_name, item_id, thread_id, turn_id, ordinal, kind, status,
        payload_json, created_at, updated_at
      ) VALUES (
        @sessionName, @itemId, @threadId, @turnId, @ordinal, @kind, @status,
        @payloadJson, @createdAt, @updatedAt
      )
    `);

    const transaction = db.transaction((writes: NormalizedHistoryWrite[]) => {
      for (const write of writes) {
        const existing = selectExisting.get(sessionName, write.itemId) as SessionAgentHistoryRow | undefined;
        const mergedEntry = mergeHistoryEntry(
          existing ? parseHistoryEntryPayload(existing.payload_json) : null,
          write.entry,
        );
        insertOrReplace.run({
          sessionName,
          itemId: write.itemId,
          threadId: write.threadIdProvided ? write.threadId : (existing?.thread_id ?? null),
          turnId: write.turnIdProvided ? write.turnId : (existing?.turn_id ?? null),
          ordinal: write.ordinal,
          kind: write.kind,
          status: write.statusProvided ? write.itemStatus : (existing?.status ?? null),
          payloadJson: JSON.stringify(mergedEntry),
          createdAt: existing?.created_at ?? write.createdAt,
          updatedAt: write.updatedAt,
        });
      }
    });

    transaction(normalizedEntries);
    const latestUpdatedAt = normalizedEntries.reduce(
      (latest, entry) => (latest > entry.updatedAt ? latest : entry.updatedAt),
      normalizedEntries[0]?.updatedAt ?? new Date().toISOString(),
    );
    db.prepare(`
      UPDATE sessions
      SET last_activity_at = ?
      WHERE session_name = ?
    `).run(latestUpdatedAt, sessionName);
    return { success: true, history: await listSessionAgentHistory(sessionName) };
  } catch (e: unknown) {
    console.error('Failed to upsert session agent history:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function replaceSessionAgentHistory(
  sessionName: string,
  entries: SessionAgentHistoryInput[],
): Promise<{ success: boolean; history?: SessionAgentHistoryItem[]; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const db = getLocalDb();
    const normalizedEntries = entries
      .map((entry) => normalizeHistoryWrite(entry))
      .filter((entry): entry is NormalizedHistoryWrite => Boolean(entry));

    const transaction = db.transaction((writes: NormalizedHistoryWrite[]) => {
      db.prepare(`DELETE FROM session_agent_history_items WHERE session_name = ?`).run(sessionName);
      const insert = db.prepare(`
        INSERT INTO session_agent_history_items (
          session_name, item_id, thread_id, turn_id, ordinal, kind, status,
          payload_json, created_at, updated_at
        ) VALUES (
          @sessionName, @itemId, @threadId, @turnId, @ordinal, @kind, @status,
          @payloadJson, @createdAt, @updatedAt
        )
      `);

      for (const write of writes) {
        insert.run({
          sessionName,
          itemId: write.itemId,
          threadId: write.threadId,
          turnId: write.turnId,
          ordinal: write.ordinal,
          kind: write.kind,
          status: write.itemStatus,
          payloadJson: write.payloadJson,
          createdAt: write.createdAt,
          updatedAt: write.updatedAt,
        });
      }
    });

    transaction(normalizedEntries);
    const latestUpdatedAt = normalizedEntries.reduce(
      (latest, entry) => (latest > entry.updatedAt ? latest : entry.updatedAt),
      normalizedEntries[0]?.updatedAt ?? new Date().toISOString(),
    );
    db.prepare(`
      UPDATE sessions
      SET last_activity_at = ?
      WHERE session_name = ?
    `).run(latestUpdatedAt, sessionName);
    return { success: true, history: await listSessionAgentHistory(sessionName) };
  } catch (e: unknown) {
    console.error('Failed to replace session agent history:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function clearSessionAgentHistory(
  sessionName: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getLocalDb();
    db.prepare(`DELETE FROM session_agent_history_items WHERE session_name = ?`).run(sessionName);
    return { success: true };
  } catch (e: unknown) {
    console.error('Failed to clear session agent history:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

async function getSessionWorkspacePreparationRow(
  preparationId: string,
): Promise<SessionWorkspacePreparationRow | null> {
  const normalizedPreparationId = normalizeOptionalText(preparationId);
  if (!normalizedPreparationId) return null;

  const db = getLocalDb();
  const row = db.prepare(`
    SELECT
      preparation_id, project_id, project_path, context_fingerprint, session_name, payload_json,
      status, cancel_requested, created_at, updated_at, expires_at, consumed_at, released_at
    FROM session_workspace_preparations
    WHERE preparation_id = ?
  `).get(normalizedPreparationId) as SessionWorkspacePreparationRow | undefined;
  return row ?? null;
}

function toProvisionedSessionWorkspaceFromPreparationPayload(
  payload: SessionWorkspacePreparationPayload,
): ProvisionedSessionWorkspace {
  return {
    sessionName: payload.sessionName,
    projectId: payload.projectId,
    projectPath: payload.projectPath,
    workspacePath: payload.workspacePath,
    workspaceFolders: payload.workspaceFolders,
    workspaceMode: payload.workspaceMode,
    activeRepoPath: payload.activeRepoPath,
    gitRepos: payload.gitRepos,
    contextFingerprint: payload.contextFingerprint,
    startupCommandSignature: payload.startupCommandSignature,
    startupCommandMode: payload.startupCommandMode,
    startupCommandProcessPid: payload.startupCommandProcessPid,
  };
}

function persistPreparationPayload(
  preparationId: string,
  payload: SessionWorkspacePreparationPayload,
): void {
  const db = getLocalDb();
  db.prepare(`
    UPDATE session_workspace_preparations
    SET
      payload_json = @payloadJson,
      updated_at = @now
    WHERE preparation_id = @preparationId
  `).run({
    preparationId,
    payloadJson: JSON.stringify(payload),
    now: new Date().toISOString(),
  });
}

export async function prepareSessionWorkspace(
  projectPath: string,
  gitContextsOrBaseBranch: string | SessionCreateGitContextInput[],
  options: { workspacePreference?: SessionWorkspacePreference } = {},
): Promise<{ success: boolean; preparation?: SessionWorkspacePreparation; error?: string }> {
  try {
    await sweepExpiredSessionWorkspacePreparations();

    const resolvedInput = await resolveSessionWorkspaceContextInput(
      projectPath,
      gitContextsOrBaseBranch,
      options.workspacePreference,
    );
    const db = getLocalDb();
    const nowIso = new Date().toISOString();
    const existingQuery = resolvedInput.projectId
      ? `
        SELECT
          preparation_id, project_id, project_path, context_fingerprint, session_name, payload_json,
          status, cancel_requested, created_at, updated_at, expires_at, consumed_at, released_at
        FROM session_workspace_preparations
        WHERE
          project_id = @projectId
          AND context_fingerprint = @contextFingerprint
          AND status = @readyStatus
          AND expires_at > @now
        ORDER BY created_at DESC
        LIMIT 1
      `
      : `
        SELECT
          preparation_id, project_id, project_path, context_fingerprint, session_name, payload_json,
          status, cancel_requested, created_at, updated_at, expires_at, consumed_at, released_at
        FROM session_workspace_preparations
        WHERE
          project_path = @projectPath
          AND context_fingerprint = @contextFingerprint
          AND status = @readyStatus
          AND expires_at > @now
        ORDER BY created_at DESC
        LIMIT 1
      `;
    const existing = db.prepare(existingQuery).get({
      projectId: resolvedInput.projectId ?? null,
      projectPath: resolvedInput.normalizedProjectPath,
      contextFingerprint: resolvedInput.contextFingerprint,
      readyStatus: SESSION_WORKSPACE_PREPARATION_STATUS_READY,
      now: nowIso,
    }) as SessionWorkspacePreparationRow | undefined;

    if (existing) {
      const parsedExisting = rowToSessionWorkspacePreparation(existing);
      if (parsedExisting) {
        return { success: true, preparation: parsedExisting };
      }
    }

    const provision = await provisionSessionWorkspace(projectPath, gitContextsOrBaseBranch, {
      resolvedInput,
      sessionName: buildSessionName(),
    });
    const preparationId = randomUUID();
    const expiresAt = getPreparationExpiryTimestamp();
    const payloadJson = JSON.stringify(toSessionWorkspacePreparationPayload(provision));

    db.prepare(`
      INSERT INTO session_workspace_preparations (
        preparation_id, project_id, project_path, context_fingerprint, session_name, payload_json,
        status, cancel_requested, created_at, updated_at, expires_at, consumed_at, released_at
      ) VALUES (
        @preparationId, @projectId, @projectPath, @contextFingerprint, @sessionName, @payloadJson,
        @status, 0, @now, @now, @expiresAt, NULL, NULL
      )
    `).run({
      preparationId,
      projectId: provision.projectId ?? null,
      projectPath: provision.projectPath,
      contextFingerprint: provision.contextFingerprint,
      sessionName: provision.sessionName,
      payloadJson,
      status: SESSION_WORKSPACE_PREPARATION_STATUS_READY,
      now: nowIso,
      expiresAt,
    });

    return {
      success: true,
      preparation: {
        preparationId,
        sessionName: provision.sessionName,
        projectId: provision.projectId,
        projectPath: provision.projectPath,
        contextFingerprint: provision.contextFingerprint,
        workspacePath: provision.workspacePath,
        workspaceFolders: provision.workspaceFolders,
        workspaceMode: provision.workspaceMode,
        activeRepoPath: provision.activeRepoPath,
        gitRepos: provision.gitRepos,
        startupCommandSignature: provision.startupCommandSignature,
        expiresAt,
      },
    };
  } catch (e: unknown) {
    console.error('Failed to prepare session workspace:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function startPreparedSessionWorkspaceStartupCommand(
  preparationId: string,
  startupScript: string | null | undefined,
  agentCli?: string,
): Promise<{ success: boolean; started: boolean; error?: string }> {
  try {
    await sweepExpiredSessionWorkspacePreparations();

    const row = await getSessionWorkspacePreparationRow(preparationId);
    if (!row || row.status !== SESSION_WORKSPACE_PREPARATION_STATUS_READY) {
      return { success: true, started: false };
    }

    const payload = parseSessionWorkspacePreparationPayload(row.payload_json);
    if (!payload) {
      return { success: false, started: false, error: 'Prepared workspace payload is invalid.' };
    }

    const syncedProvision = await syncStartupCommandForProvision(
      toProvisionedSessionWorkspaceFromPreparationPayload(payload),
      startupScript,
      agentCli,
    );
    const nextPayload = toSessionWorkspacePreparationPayload(syncedProvision);
    if (JSON.stringify(nextPayload) !== row.payload_json) {
      persistPreparationPayload(row.preparation_id, nextPayload);
    }

    return {
      success: true,
      started: Boolean(syncedProvision.startupCommandSignature),
    };
  } catch (e: unknown) {
    console.error('Failed to start prepared session startup command:', e);
    return { success: false, started: false, error: getErrorMessage(e) };
  }
}

export async function releasePreparedSessionWorkspace(
  preparationId: string,
): Promise<{ success: boolean; released: boolean; error?: string }> {
  try {
    await sweepExpiredSessionWorkspacePreparations();

    const row = await getSessionWorkspacePreparationRow(preparationId);
    if (!row) {
      return { success: true, released: false };
    }

    if (row.status !== SESSION_WORKSPACE_PREPARATION_STATUS_READY) {
      return { success: true, released: false };
    }

    const payload = parseSessionWorkspacePreparationPayload(row.payload_json);
    if (payload) {
      await cleanupProvisionedSessionWorkspace({
        projectId: payload.projectId,
        projectPath: payload.projectPath,
        sessionName: payload.sessionName,
        workspaceMode: payload.workspaceMode,
        workspacePath: payload.workspacePath,
        gitRepos: payload.gitRepos,
        startupCommandMode: payload.startupCommandMode,
        startupCommandProcessPid: payload.startupCommandProcessPid,
      });
    }

    const db = getLocalDb();
    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE session_workspace_preparations
      SET
        status = @releasedStatus,
        updated_at = @now,
        released_at = COALESCE(released_at, @now)
      WHERE
        preparation_id = @preparationId
        AND status = @readyStatus
    `).run({
      releasedStatus: SESSION_WORKSPACE_PREPARATION_STATUS_RELEASED,
      now: nowIso,
      preparationId: row.preparation_id,
      readyStatus: SESSION_WORKSPACE_PREPARATION_STATUS_READY,
    });

    return { success: true, released: true };
  } catch (e: unknown) {
    console.error('Failed to release prepared session workspace:', e);
    return { success: false, released: false, error: getErrorMessage(e) };
  }
}

export async function consumePreparedSessionWorkspace(
  preparationId: string,
  projectPath: string,
  gitContextsOrBaseBranch: string | SessionCreateGitContextInput[],
  workspacePreference: SessionWorkspacePreference = 'workspace',
): Promise<{
  success: boolean;
  consumed: boolean;
  preparation?: SessionWorkspacePreparation;
  mismatch?: boolean;
  error?: string;
}> {
  try {
    await sweepExpiredSessionWorkspacePreparations();

    const row = await getSessionWorkspacePreparationRow(preparationId);
    if (!row) {
      return { success: true, consumed: false };
    }

    if (row.status !== SESSION_WORKSPACE_PREPARATION_STATUS_READY) {
      return { success: true, consumed: false };
    }

    const parsedPreparation = rowToSessionWorkspacePreparation(row);
    if (!parsedPreparation) {
      return { success: false, consumed: false, error: 'Prepared workspace payload is invalid.' };
    }

    const resolvedInput = await resolveSessionWorkspaceContextInput(
      projectPath,
      gitContextsOrBaseBranch,
      workspacePreference,
    );
    if (
      ((parsedPreparation.projectId ?? null) !== (resolvedInput.projectId ?? null))
      || parsedPreparation.projectPath !== resolvedInput.normalizedProjectPath
      || parsedPreparation.contextFingerprint !== resolvedInput.contextFingerprint
    ) {
      return { success: true, consumed: false, mismatch: true };
    }

    const db = getLocalDb();
    const nowIso = new Date().toISOString();
    const consumeResult = db.prepare(`
      UPDATE session_workspace_preparations
      SET
        status = @consumedStatus,
        updated_at = @now,
        consumed_at = COALESCE(consumed_at, @now)
      WHERE
        preparation_id = @preparationId
        AND status = @readyStatus
    `).run({
      consumedStatus: SESSION_WORKSPACE_PREPARATION_STATUS_CONSUMED,
      now: nowIso,
      preparationId: row.preparation_id,
      readyStatus: SESSION_WORKSPACE_PREPARATION_STATUS_READY,
    });

    if (consumeResult.changes === 0) {
      return { success: true, consumed: false };
    }

    return {
      success: true,
      consumed: true,
      preparation: parsedPreparation,
    };
  } catch (e: unknown) {
    console.error('Failed to consume prepared session workspace:', e);
    return { success: false, consumed: false, error: getErrorMessage(e) };
  }
}

export async function createSession(
  projectPath: string,
  gitContextsOrBaseBranch: string | SessionCreateGitContextInput[],
  metadata: SessionCreateMetadata,
): Promise<SessionCreateResult> {
  try {
    await sweepExpiredSessionWorkspacePreparations();
    const workspacePreference = normalizeSessionWorkspacePreference(metadata.workspacePreference);

    let provision: ProvisionedSessionWorkspace | null = null;
    const normalizedPreparationId = normalizeOptionalText(metadata.preparedWorkspaceId);
    if (normalizedPreparationId) {
      const consumedPreparedWorkspace = await consumePreparedSessionWorkspace(
        normalizedPreparationId,
        projectPath,
        gitContextsOrBaseBranch,
        workspacePreference,
      );
      if (!consumedPreparedWorkspace.success) {
        console.warn(
          `Failed to consume prepared workspace ${normalizedPreparationId}: ${consumedPreparedWorkspace.error || 'unknown error'}`,
        );
      } else if (consumedPreparedWorkspace.consumed && consumedPreparedWorkspace.preparation) {
        const prepared = consumedPreparedWorkspace.preparation;
        provision = {
          sessionName: prepared.sessionName,
          projectId: prepared.projectId,
          projectPath: prepared.projectPath,
          workspacePath: prepared.workspacePath,
          workspaceFolders: prepared.workspaceFolders,
          workspaceMode: prepared.workspaceMode,
          activeRepoPath: prepared.activeRepoPath,
          gitRepos: prepared.gitRepos,
          contextFingerprint: prepared.contextFingerprint,
          startupCommandSignature: prepared.startupCommandSignature,
        };
      }
    }

    if (!provision) {
      const resolvedInput = await resolveSessionWorkspaceContextInput(
        projectPath,
        gitContextsOrBaseBranch,
        workspacePreference,
      );
      provision = await provisionSessionWorkspace(projectPath, gitContextsOrBaseBranch, {
        resolvedInput,
      });
    }

    try {
      provision = await syncStartupCommandForProvision(
        provision,
        metadata.startupScript,
        metadata.agentProvider ?? metadata.agent,
      );
    } catch (startupError) {
      console.warn('Failed to start session startup command:', startupError);
    }

    const sessionData = await persistSessionMetadataFromProvision(provision, metadata);
    return toSessionCreateResult(sessionData);
  } catch (e: unknown) {
    console.error('Failed to create session:', e);
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

async function cleanupSessionWorkspace(metadata: SessionMetadata): Promise<void> {
  await cleanupWorkspaceRoot(metadata.workspacePath, metadata.workspaceMode);
}

export async function prepareSessionDevServerTerminalRun(sessionName: string): Promise<{
  success: boolean;
  removedStaleLock?: boolean;
  error?: string;
}> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const script = metadata.devServerScript?.trim();
    if (!script) {
      return { success: false, error: 'Dev server script is not configured for this session.' };
    }

    const removedStaleLock = await cleanupStaleNextDevLock(metadata.workspacePath).catch((error) => {
      console.warn('Failed to cleanup stale Next dev lock:', error);
      return false;
    });

    return {
      success: true,
      removedStaleLock,
    };
  } catch (error) {
    console.error('Failed to prepare session dev server terminal run:', error);
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
}

export async function getSessionDevServerState(sessionName: string): Promise<{
  success: boolean;
  running?: boolean;
  previewUrl?: string | null;
  error?: string;
}> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const projectKey = getSessionProjectKey(metadata.projectId, metadata.projectPath);
    const state = await readTrackedDevServerState(projectKey, sessionName);
    return {
      success: true,
      running: state.running,
      previewUrl: state.previewUrl,
    };
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
}

export async function startSessionDevServer(sessionName: string): Promise<{
  success: boolean;
  started?: boolean;
  alreadyRunning?: boolean;
  previewUrl?: string | null;
  removedStaleLock?: boolean;
  error?: string;
}> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const script = metadata.devServerScript?.trim();
    if (!script) {
      return { success: false, error: 'Dev server script is not configured for this session.' };
    }

    const projectKey = getSessionProjectKey(metadata.projectId, metadata.projectPath);
    const currentState = await readTrackedDevServerState(projectKey, sessionName);
    if (currentState.running) {
      return {
        success: true,
        started: false,
        alreadyRunning: true,
        previewUrl: currentState.previewUrl,
      };
    }

    const repoPaths = metadata.gitRepos.length > 0
      ? metadata.gitRepos.map((repo) => repo.sourceRepoPath)
      : [metadata.projectPath];
    const environments = await getSessionTerminalEnvironments(repoPaths, metadata.agentProvider ?? metadata.agent).catch((error) => {
      console.warn('Failed to resolve dev server terminal environment:', error);
      return [];
    });
    const removedStaleLock = await cleanupStaleNextDevLock(metadata.workspacePath).catch((error) => {
      console.warn('Failed to cleanup stale Next dev lock:', error);
      return false;
    });
    const processRecord = await launchTrackedSessionProcess({
      role: 'dev-server',
      source: 'ui-dev-button',
      sessionName,
      projectPath: projectKey,
      workspacePath: metadata.workspacePath,
      command: script,
      shellCommand: getStartupShellCommand(),
      env: Object.fromEntries(environments.map((entry) => [entry.name, entry.value])),
    });

    return {
      success: true,
      started: true,
      alreadyRunning: false,
      previewUrl: await inferTrackedProcessPreviewUrl(processRecord),
      removedStaleLock,
    };
  } catch (error) {
    console.error('Failed to start session dev server:', error);
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
}

export async function stopSessionDevServer(sessionName: string): Promise<{
  success: boolean;
  stopped?: boolean;
  error?: string;
}> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const projectKey = getSessionProjectKey(metadata.projectId, metadata.projectPath);
    const result = await stopTrackedSessionProcess(projectKey, sessionName, 'dev-server');
    return {
      success: true,
      stopped: result.stopped || !result.process,
    };
  } catch (error) {
    console.error('Failed to stop session dev server:', error);
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
}

export async function deleteSession(sessionName: string): Promise<{ success: boolean; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const projectKey = getSessionProjectKey(metadata.projectId, metadata.projectPath);
    await stopAllTrackedSessionProcesses(projectKey, sessionName);
    await terminateProvisionedStartupCommand({
      projectId: metadata.projectId,
      projectPath: metadata.projectPath,
      sessionName,
      startupCommandMode: 'shell',
      startupCommandProcessPid: undefined,
    });
    await terminateSessionTerminalSessions(sessionName);

    if (metadata.workspaceMode === 'single_worktree' || metadata.workspaceMode === 'multi_repo_worktree') {
      for (const gitRepo of metadata.gitRepos) {
        await removeWorktree(gitRepo.sourceRepoPath, gitRepo.worktreePath, gitRepo.branchName);
      }
    }
    await cleanupSessionWorkspace(metadata);

    const db = getLocalDb();
    db.prepare(`DELETE FROM sessions WHERE session_name = ?`).run(sessionName);
    db.prepare(`DELETE FROM session_git_repos WHERE session_name = ?`).run(sessionName);
    db.prepare(`DELETE FROM session_launch_contexts WHERE session_name = ?`).run(sessionName);
    db.prepare(`DELETE FROM session_canvas_layouts WHERE session_name = ?`).run(sessionName);
    db.prepare(`DELETE FROM session_agent_history_items WHERE session_name = ?`).run(sessionName);

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
    console.error('Failed to delete session:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function deleteSessionInBackground(sessionName: string): Promise<{ success: boolean; error?: string }> {
  try {
    runInBackground(async () => {
      await deleteSession(sessionName);
    }, (error) => {
      console.error(`Failed to execute background session deletion for "${sessionName}":`, error);
    });

    return { success: true };
  } catch (e: unknown) {
    console.error('Failed to schedule background session deletion:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

async function resolveSessionGitTarget(
  sessionName: string,
  sourceRepoPath?: string,
): Promise<{ metadata: SessionMetadata; gitRepo: SessionGitRepoContext } | { error: string }> {
  const metadata = await getSessionMetadata(sessionName);
  if (!metadata) {
    return { error: 'Session metadata not found' };
  }

  if (metadata.gitRepos.length === 0) {
    return { error: 'This session has no Git context.' };
  }

  const normalizedRequestedRepoPath = sourceRepoPath?.trim();
  const gitRepo = normalizedRequestedRepoPath
    ? metadata.gitRepos.find((repo) => repo.sourceRepoPath === normalizedRequestedRepoPath)
    : metadata.gitRepos.find((repo) => repo.sourceRepoPath === metadata.activeRepoPath) || metadata.gitRepos[0];

  if (!gitRepo) {
    return { error: 'Requested repository context was not found for this session.' };
  }

  return { metadata, gitRepo };
}

async function updateSessionGitRepoBaseBranch(
  sessionName: string,
  sourceRepoPath: string,
  baseBranch: string,
): Promise<void> {
  const db = getLocalDb();
  db.prepare(`
    UPDATE session_git_repos
    SET base_branch = ?
    WHERE session_name = ? AND source_repo_path = ?
  `).run(baseBranch, sessionName, sourceRepoPath);
}

export async function updateSessionActiveRepo(
  sessionName: string,
  activeRepoPath: string,
): Promise<{ success: boolean; activeRepoPath?: string; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    if (metadata.gitRepos.length === 0) {
      return { success: false, error: 'This session has no Git context.' };
    }

    if (!metadata.gitRepos.some((gitRepo) => gitRepo.sourceRepoPath === activeRepoPath)) {
      return { success: false, error: 'Repository is not part of this session.' };
    }

    metadata.activeRepoPath = activeRepoPath;
    await saveSessionMetadata(metadata);

    return { success: true, activeRepoPath };
  } catch (e: unknown) {
    console.error('Failed to update active repo:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function mergeSessionToBase(
  sessionName: string,
  sourceRepoPath?: string,
): Promise<{ success: boolean; branchName?: string; baseBranch?: string; error?: string }> {
  try {
    const target = await resolveSessionGitTarget(sessionName, sourceRepoPath);
    if ('error' in target) {
      return { success: false, error: target.error };
    }

    const { gitRepo } = target;
    const baseBranch = gitRepo.baseBranch?.trim();
    if (!baseBranch) {
      return { success: false, error: 'Base branch is missing for the selected repository context.' };
    }

    const worktreeGit = simpleGit(gitRepo.worktreePath);
    const worktreeStatus = await worktreeGit.status();
    if (!worktreeStatus.isClean()) {
      return { success: false, error: 'Worktree has uncommitted changes. Commit your changes first.' };
    }

    const git = simpleGit(gitRepo.sourceRepoPath);
    const branchSummary = await git.branchLocal();
    if (!branchSummary.all.includes(baseBranch)) {
      return { success: false, error: `Base branch "${baseBranch}" not found in repository.` };
    }
    if (!branchSummary.all.includes(gitRepo.branchName)) {
      return { success: false, error: `Session branch "${gitRepo.branchName}" not found in repository.` };
    }

    const originalBranch = branchSummary.current;
    if (originalBranch !== baseBranch) {
      await git.checkout(baseBranch);
    }

    await git.merge(['--no-ff', gitRepo.branchName]);

    if (originalBranch && originalBranch !== baseBranch) {
      await git.checkout(originalBranch);
    }

    return {
      success: true,
      branchName: gitRepo.branchName,
      baseBranch,
    };
  } catch (e: unknown) {
    console.error('Failed to merge session branch:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function rebaseSessionOntoBase(
  sessionName: string,
  sourceRepoPath?: string,
): Promise<{ success: boolean; branchName?: string; baseBranch?: string; error?: string }> {
  try {
    const target = await resolveSessionGitTarget(sessionName, sourceRepoPath);
    if ('error' in target) {
      return { success: false, error: target.error };
    }

    const { gitRepo } = target;
    const baseBranch = gitRepo.baseBranch?.trim();
    if (!baseBranch) {
      return { success: false, error: 'Base branch is missing for the selected repository context.' };
    }

    const worktreeGit = simpleGit(gitRepo.worktreePath);
    const worktreeStatus = await worktreeGit.status();
    if (!worktreeStatus.isClean()) {
      return { success: false, error: 'Worktree has uncommitted changes. Commit your changes first.' };
    }

    const repoGit = simpleGit(gitRepo.sourceRepoPath);
    const branchSummary = await repoGit.branchLocal();
    if (!branchSummary.all.includes(baseBranch)) {
      return { success: false, error: `Base branch "${baseBranch}" not found in repository.` };
    }
    if (!branchSummary.all.includes(gitRepo.branchName)) {
      return { success: false, error: `Session branch "${gitRepo.branchName}" not found in repository.` };
    }

    const worktreeBranchSummary = await worktreeGit.branchLocal();
    if (worktreeBranchSummary.current !== gitRepo.branchName) {
      await worktreeGit.checkout(gitRepo.branchName);
    }

    await worktreeGit.rebase([baseBranch]);

    return {
      success: true,
      branchName: gitRepo.branchName,
      baseBranch,
    };
  } catch (e: unknown) {
    console.error('Failed to rebase session branch:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function getSessionUncommittedFileCount(
  sessionName: string,
  sourceRepoPath?: string,
): Promise<{ success: boolean; count?: number; error?: string }> {
  try {
    const target = await resolveSessionGitTarget(sessionName, sourceRepoPath);
    if ('error' in target) {
      return { success: false, error: target.error };
    }

    const git = simpleGit(target.gitRepo.worktreePath);
    const status = await git.status();

    return { success: true, count: status.files.length };
  } catch (e: unknown) {
    console.error('Failed to get uncommitted file count:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function getSessionDivergence(
  sessionName: string,
  sourceRepoPath?: string,
): Promise<{ success: boolean; ahead?: number; behind?: number; error?: string }> {
  try {
    const target = await resolveSessionGitTarget(sessionName, sourceRepoPath);
    if ('error' in target) {
      return { success: false, error: target.error };
    }

    const { gitRepo } = target;
    const baseBranch = gitRepo.baseBranch?.trim();
    if (!baseBranch) {
      return { success: false, error: 'Base branch is unavailable for this session.' };
    }

    const git = simpleGit(gitRepo.sourceRepoPath);
    const branchSummary = await git.branchLocal();
    if (!branchSummary.all.includes(baseBranch)) {
      return { success: false, error: `Base branch "${baseBranch}" not found in repository.` };
    }
    if (!branchSummary.all.includes(gitRepo.branchName)) {
      return { success: false, error: `Session branch "${gitRepo.branchName}" not found in repository.` };
    }

    const rawCounts = await git.raw(['rev-list', '--left-right', '--count', `${baseBranch}...${gitRepo.branchName}`]);
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
  sessionName: string,
  sourceRepoPath?: string,
): Promise<{ success: boolean; baseBranch?: string; branches?: string[]; mainWorktreeBranch?: string; error?: string }> {
  try {
    const target = await resolveSessionGitTarget(sessionName, sourceRepoPath);
    if ('error' in target) {
      return { success: false, error: target.error };
    }

    const { gitRepo } = target;
    const git = simpleGit(gitRepo.sourceRepoPath);
    const branchSummary = await git.branchLocal();
    const branches = [...branchSummary.all].sort((a, b) => a.localeCompare(b));
    const baseBranch = gitRepo.baseBranch?.trim();
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
  fromBranch: string,
  sourceRepoPath?: string,
): Promise<{ success: boolean; branchName?: string; fromBranch?: string; error?: string }> {
  try {
    const target = await resolveSessionGitTarget(sessionName, sourceRepoPath);
    if ('error' in target) {
      return { success: false, error: target.error };
    }

    const { gitRepo } = target;
    const nextBranchName = branchName.trim();
    if (!nextBranchName) {
      return { success: false, error: 'Branch name cannot be empty.' };
    }

    const nextFromBranch = fromBranch.trim();
    if (!nextFromBranch) {
      return { success: false, error: 'Base branch cannot be empty.' };
    }

    const git = simpleGit(gitRepo.sourceRepoPath);

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
  baseBranch: string,
  sourceRepoPath?: string,
): Promise<{ success: boolean; baseBranch?: string; error?: string }> {
  try {
    const target = await resolveSessionGitTarget(sessionName, sourceRepoPath);
    if ('error' in target) {
      return { success: false, error: target.error };
    }

    const { gitRepo } = target;
    const nextBaseBranch = baseBranch.trim();
    if (!nextBaseBranch) {
      return { success: false, error: 'Base branch cannot be empty.' };
    }

    const git = simpleGit(gitRepo.sourceRepoPath);
    const branchSummary = await git.branchLocal();
    if (!branchSummary.all.includes(nextBaseBranch)) {
      return { success: false, error: `Base branch "${nextBaseBranch}" not found in repository.` };
    }

    await updateSessionGitRepoBaseBranch(sessionName, gitRepo.sourceRepoPath, nextBaseBranch);

    const metadata = await getSessionMetadata(sessionName);
    if (metadata) {
      metadata.gitRepos = metadata.gitRepos.map((context) => (
        context.sourceRepoPath === gitRepo.sourceRepoPath
          ? { ...context, baseBranch: nextBaseBranch }
          : context
      ));
      await saveSessionMetadata(metadata);
    }

    return { success: true, baseBranch: nextBaseBranch };
  } catch (e: unknown) {
    console.error('Failed to update session base branch:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}
