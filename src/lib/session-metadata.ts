import path from 'node:path';
import type { LocalSessionRecord } from './local-db.ts';
import {
  normalizeProviderReasoningEffort,
} from './agent/reasoning.ts';
import type {
  AgentProvider,
  ReasoningEffort,
  SessionAgentRunState,
  SessionGitRepoContext,
  SessionWorkspaceFolder,
  SessionWorkspaceMode,
} from './types.ts';

export type SessionMetadataValue = {
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
  repoPath?: string;
  worktreePath?: string;
  branchName?: string;
  baseBranch?: string;
};

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizePath(value: string): string {
  return path.resolve(/* turbopackIgnore: true */ value.trim());
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

function parseWorkspaceFolders(value: string | null | undefined): SessionWorkspaceFolder[] {
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

export function toSessionCompatibilityFields(
  metadata: SessionMetadataValue,
): Pick<SessionMetadataValue, 'repoPath' | 'worktreePath' | 'branchName' | 'baseBranch'> {
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

function getSessionGitReposFromRecord(record: Pick<LocalSessionRecord, 'gitRepos'>): SessionGitRepoContext[] {
  return [...record.gitRepos]
    .sort((left, right) => left.sourceRepoPath.localeCompare(right.sourceRepoPath))
    .map((gitRepo) => ({
      sourceRepoPath: gitRepo.sourceRepoPath,
      relativeRepoPath: gitRepo.relativeRepoPath,
      worktreePath: gitRepo.worktreePath,
      branchName: gitRepo.branchName,
      baseBranch: gitRepo.baseBranch ?? undefined,
      baseCommitId: gitRepo.baseCommitId ?? undefined,
    }));
}

export function sessionRecordToMetadata(record: LocalSessionRecord): SessionMetadataValue {
  const projectPath = record.projectPath?.trim() || record.repoPath?.trim() || '';
  const workspacePath = record.workspacePath?.trim() || record.worktreePath?.trim() || projectPath;
  const workspaceFolders = parseWorkspaceFolders(record.workspaceFoldersJson);
  const gitRepos = getSessionGitReposFromRecord(record);

  const fallbackRepo = record.repoPath?.trim();
  const fallbackWorktree = record.worktreePath?.trim();
  const fallbackBranch = record.branchName?.trim();
  const fallbackBase = record.baseBranch?.trim() || undefined;

  if (gitRepos.length === 0 && fallbackRepo && fallbackWorktree && fallbackBranch) {
    gitRepos.push({
      sourceRepoPath: fallbackRepo,
      relativeRepoPath: projectPath ? (path.relative(projectPath, fallbackRepo) === '.' ? '' : path.relative(projectPath, fallbackRepo)) : '',
      worktreePath: fallbackWorktree,
      branchName: fallbackBranch,
      baseBranch: fallbackBase,
      baseCommitId: undefined,
    });
  }

  const metadata: SessionMetadataValue = {
    sessionName: record.sessionName,
    projectId: normalizeOptionalText(record.projectId) ?? undefined,
    projectPath,
    workspacePath,
    workspaceFolders,
    workspaceMode: normalizeSessionWorkspaceMode(record.workspaceMode),
    activeRepoPath: record.activeRepoPath?.trim() || undefined,
    gitRepos,
    agent: record.agent,
    agentProvider: record.agent as AgentProvider,
    model: record.model,
    reasoningEffort: normalizeProviderReasoningEffort(record.agent, record.reasoningEffort),
    threadId: normalizeOptionalText(record.threadId),
    activeTurnId: normalizeOptionalText(record.activeTurnId),
    runState: normalizeOptionalText(record.runState) as SessionAgentRunState | undefined,
    lastError: normalizeOptionalText(record.lastError),
    lastActivityAt: normalizeOptionalText(record.lastActivityAt),
    title: record.title ?? undefined,
    devServerScript: record.devServerScript ?? undefined,
    initialized: record.initialized === null ? undefined : Boolean(record.initialized),
    timestamp: record.timestamp,
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
    ...toSessionCompatibilityFields(metadata),
  };
}
