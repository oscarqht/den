'use server';

import path from 'node:path';
import { readLocalState, updateLocalState } from '../../lib/local-db.ts';
import {
  repairMissingDraftProjectIds,
  resolveProjectActivityFilter,
} from '../../lib/project-activity-server.ts';
import {
  normalizeNullableProviderReasoningEffort,
  normalizeProviderReasoningEffort,
} from '../../lib/agent/reasoning.ts';
import type { AgentProvider, ReasoningEffort, SessionGitRepoContext } from '../../lib/types.ts';

export type DraftMetadata = {
  id: string;
  projectId?: string;
  projectPath: string;
  gitContexts: SessionGitRepoContext[];
  message: string;
  attachmentPaths: string[];
  agentProvider: AgentProvider;
  model: string;
  reasoningEffort?: ReasoningEffort;
  timestamp: string;
  title: string;
  startupScript: string;
  devServerScript: string;
  sessionMode: 'fast' | 'plan';
  // Backward compatibility fields.
  repoPath?: string;
  branchName?: string;
};

type DraftRow = {
  id: string;
  project_id: string | null;
  project_path: string | null;
  repo_path: string | null;
  branch_name: string | null;
  git_contexts_json: string | null;
  message: string;
  attachment_paths_json: string;
  agent_provider: string;
  model: string;
  reasoning_effort: string | null;
  timestamp: string;
  title: string;
  startup_script: string;
  dev_server_script: string;
  session_mode: string;
};

function parseAttachmentPaths(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

function parseGitContexts(
  value: string | null,
  fallbackRepoPath: string | null,
  fallbackBranchName: string | null,
): SessionGitRepoContext[] {
  if (value) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        const contexts = parsed
          .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
          .map((entry) => {
            const sourceRepoPath = typeof entry.sourceRepoPath === 'string' ? entry.sourceRepoPath.trim() : '';
            const relativeRepoPath = typeof entry.relativeRepoPath === 'string' ? entry.relativeRepoPath.trim() : '';
            const worktreePath = typeof entry.worktreePath === 'string' ? entry.worktreePath.trim() : '';
            const branchName = typeof entry.branchName === 'string' ? entry.branchName.trim() : '';
            const baseBranch = typeof entry.baseBranch === 'string' ? entry.baseBranch.trim() : undefined;
            if (!sourceRepoPath || !branchName) return null;
            return {
              sourceRepoPath,
              relativeRepoPath,
              worktreePath,
              branchName,
              baseBranch,
            } as SessionGitRepoContext;
          })
          .filter((entry): entry is SessionGitRepoContext => Boolean(entry));

        if (contexts.length > 0) {
          return contexts;
        }
      }
    } catch {
      // Ignore malformed JSON.
    }
  }

  if (fallbackRepoPath && fallbackBranchName) {
    return [{
      sourceRepoPath: fallbackRepoPath,
      relativeRepoPath: '',
      worktreePath: '',
      branchName: fallbackBranchName,
    }];
  }

  return [];
}

function rowToDraft(row: DraftRow): DraftMetadata {
  const projectPath = (row.project_path?.trim() || row.repo_path?.trim() || '');
  const gitContexts = parseGitContexts(row.git_contexts_json, row.repo_path, row.branch_name);
  const primaryContext = gitContexts[0];
  const normalizedReasoningEffort = normalizeProviderReasoningEffort(
    row.agent_provider,
    row.reasoning_effort,
  );

  return {
    id: row.id,
    projectId: row.project_id?.trim() || undefined,
    projectPath,
    gitContexts,
    message: row.message,
    attachmentPaths: parseAttachmentPaths(row.attachment_paths_json),
    agentProvider: row.agent_provider as AgentProvider,
    model: row.model,
    reasoningEffort: normalizedReasoningEffort,
    timestamp: row.timestamp,
    title: row.title,
    startupScript: row.startup_script,
    devServerScript: row.dev_server_script,
    sessionMode: row.session_mode === 'plan' ? 'plan' : 'fast',
    repoPath: primaryContext?.sourceRepoPath || row.repo_path || undefined,
    branchName: primaryContext?.branchName || row.branch_name || undefined,
  };
}

function normalizeGitContexts(draft: DraftMetadata): SessionGitRepoContext[] {
  if (draft.gitContexts.length > 0) {
    return draft.gitContexts
      .map((context) => ({
        sourceRepoPath: context.sourceRepoPath.trim(),
        relativeRepoPath: context.relativeRepoPath.trim(),
        worktreePath: context.worktreePath.trim(),
        branchName: context.branchName.trim(),
        baseBranch: context.baseBranch?.trim() || undefined,
      }))
      .filter((context) => context.sourceRepoPath && context.branchName);
  }

  if (draft.repoPath?.trim() && draft.branchName?.trim()) {
    return [{
      sourceRepoPath: draft.repoPath.trim(),
      relativeRepoPath: '',
      worktreePath: '',
      branchName: draft.branchName.trim(),
    }];
  }

  return [];
}

export async function saveDraft(draft: DraftMetadata): Promise<{ success: boolean; error?: string }> {
  try {
    const safeId = path.basename(draft.id);
    const projectPath = draft.projectPath?.trim() || draft.repoPath?.trim() || '';
    const projectId = draft.projectId?.trim() || null;
    if (!projectPath && !projectId) {
      return { success: false, error: 'Project is required.' };
    }

    const gitContexts = normalizeGitContexts(draft);
    const primaryContext = gitContexts[0];
    const normalizedReasoningEffort = normalizeProviderReasoningEffort(
      draft.agentProvider,
      draft.reasoningEffort,
    );

    updateLocalState((state) => {
      state.drafts[safeId] = {
        id: safeId,
        projectId,
        projectPath,
        repoPath: primaryContext?.sourceRepoPath ?? null,
        branchName: primaryContext?.branchName ?? null,
        gitContextsJson: JSON.stringify(gitContexts),
        message: draft.message,
        attachmentPathsJson: JSON.stringify(draft.attachmentPaths),
        agentProvider: draft.agentProvider,
        model: draft.model,
        reasoningEffort: normalizeNullableProviderReasoningEffort(
          draft.agentProvider,
          normalizedReasoningEffort,
        ),
        timestamp: draft.timestamp,
        title: draft.title,
        startupScript: draft.startupScript,
        devServerScript: draft.devServerScript,
        sessionMode: draft.sessionMode,
      };
    });
    return { success: true };
  } catch (e) {
    console.error('Failed to save draft:', e);
    return { success: false, error: 'Failed to save draft' };
  }
}

export async function listDrafts(projectReference?: string): Promise<DraftMetadata[]> {
  try {
    repairMissingDraftProjectIds(projectReference);

    const resolvedFilter = resolveProjectActivityFilter(projectReference);
    const filterValue = resolvedFilter?.filterValue;

    return Object.values(readLocalState().drafts)
      .filter((draft) => {
        if (!projectReference || !resolvedFilter || !filterValue) {
          return true;
        }

        return resolvedFilter.filterColumn === 'project_id'
          ? draft.projectId === filterValue
          : draft.projectPath === filterValue;
      })
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
      .map((draft) => rowToDraft({
        id: draft.id,
        project_id: draft.projectId ?? null,
        project_path: draft.projectPath ?? null,
        repo_path: draft.repoPath ?? null,
        branch_name: draft.branchName ?? null,
        git_contexts_json: draft.gitContextsJson ?? null,
        message: draft.message,
        attachment_paths_json: draft.attachmentPathsJson,
        agent_provider: draft.agentProvider,
        model: draft.model,
        reasoning_effort: draft.reasoningEffort ?? null,
        timestamp: draft.timestamp,
        title: draft.title,
        startup_script: draft.startupScript,
        dev_server_script: draft.devServerScript,
        session_mode: draft.sessionMode,
      }));
  } catch (e) {
    console.error('Failed to list drafts:', e);
    return [];
  }
}

export async function deleteDraft(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const safeId = path.basename(id);
    updateLocalState((state) => {
      delete state.drafts[safeId];
    });
    return { success: true };
  } catch (e) {
    console.error('Failed to delete draft:', e);
    return { success: false, error: 'Failed to delete draft' };
  }
}
