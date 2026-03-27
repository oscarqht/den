'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitBranch, GitMerge, GitPullRequestArrow, RefreshCw } from 'lucide-react';

import {
  getSessionDivergence,
  listSessionBaseBranches,
  mergeSessionToBase,
  rebaseSessionOntoBase,
  updateSessionBaseBranch,
} from '@/app/actions/session';
import { SessionRepoViewer } from '@/components/SessionRepoViewer';
import { getBaseName } from '@/lib/path';
import type { SessionGitRepoContext } from '@/lib/types';

type SessionCanvasGitPanelProps = {
  sessionId: string;
  gitRepos: SessionGitRepoContext[];
  selectedSourceRepoPath?: string | null;
  onSelectedSourceRepoPathChange: (sourceRepoPath: string) => void;
};

export function SessionCanvasGitPanel({
  sessionId,
  gitRepos,
  selectedSourceRepoPath,
  onSelectedSourceRepoPathChange,
}: SessionCanvasGitPanelProps) {
  const selectedRepo = useMemo(() => {
    if (gitRepos.length === 0) return null;
    if (selectedSourceRepoPath) {
      return gitRepos.find((repo) => repo.sourceRepoPath === selectedSourceRepoPath) || gitRepos[0];
    }
    return gitRepos[0];
  }, [gitRepos, selectedSourceRepoPath]);

  const [baseBranchOptions, setBaseBranchOptions] = useState<string[]>([]);
  const [currentBaseBranch, setCurrentBaseBranch] = useState<string>(selectedRepo?.baseBranch?.trim() || '');
  const [divergence, setDivergence] = useState({ ahead: 0, behind: 0 });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isUpdatingBaseBranch, setIsUpdatingBaseBranch] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [isRebasing, setIsRebasing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setCurrentBaseBranch(selectedRepo?.baseBranch?.trim() || '');
  }, [selectedRepo?.baseBranch, selectedRepo?.sourceRepoPath]);

  const refreshGitState = useCallback(async () => {
    if (!selectedRepo) return;

    setIsRefreshing(true);
    try {
      const [branchResult, divergenceResult] = await Promise.all([
        listSessionBaseBranches(sessionId, selectedRepo.sourceRepoPath),
        getSessionDivergence(sessionId, selectedRepo.sourceRepoPath),
      ]);

      if (branchResult.success) {
        setBaseBranchOptions(branchResult.branches || []);
        if (branchResult.baseBranch?.trim()) {
          setCurrentBaseBranch(branchResult.baseBranch.trim());
        }
      }

      if (divergenceResult.success) {
        setDivergence({
          ahead: divergenceResult.ahead ?? 0,
          behind: divergenceResult.behind ?? 0,
        });
      }
    } catch (error) {
      console.error('Failed to refresh session git panel:', error);
      setFeedback(error instanceof Error ? error.message : 'Failed to refresh Git state');
    } finally {
      setIsRefreshing(false);
    }
  }, [selectedRepo, sessionId]);

  useEffect(() => {
    void refreshGitState();
  }, [refreshGitState]);

  const handleBaseBranchChange = useCallback(async (nextBaseBranch: string) => {
    if (!selectedRepo) return;

    const normalized = nextBaseBranch.trim();
    setCurrentBaseBranch(normalized);
    setIsUpdatingBaseBranch(true);
    setFeedback(null);

    try {
      const result = await updateSessionBaseBranch(sessionId, normalized, selectedRepo.sourceRepoPath);
      if (!result.success) {
        throw new Error(result.error || 'Failed to update base branch');
      }
      setFeedback(`Base branch set to ${normalized}`);
      await refreshGitState();
    } catch (error) {
      console.error('Failed to update session base branch:', error);
      setFeedback(error instanceof Error ? error.message : 'Failed to update base branch');
    } finally {
      setIsUpdatingBaseBranch(false);
    }
  }, [refreshGitState, selectedRepo, sessionId]);

  const handleMerge = useCallback(async () => {
    if (!selectedRepo) return;

    setIsMerging(true);
    setFeedback(null);
    try {
      const result = await mergeSessionToBase(sessionId, selectedRepo.sourceRepoPath);
      if (!result.success) {
        throw new Error(result.error || 'Failed to merge into base branch');
      }
      setFeedback(`Merged ${result.branchName} into ${result.baseBranch}`);
      await refreshGitState();
    } catch (error) {
      console.error('Failed to merge session branch:', error);
      setFeedback(error instanceof Error ? error.message : 'Failed to merge session branch');
    } finally {
      setIsMerging(false);
    }
  }, [refreshGitState, selectedRepo, sessionId]);

  const handleRebase = useCallback(async () => {
    if (!selectedRepo) return;

    setIsRebasing(true);
    setFeedback(null);
    try {
      const result = await rebaseSessionOntoBase(sessionId, selectedRepo.sourceRepoPath);
      if (!result.success) {
        throw new Error(result.error || 'Failed to rebase onto base branch');
      }
      setFeedback(`Rebased ${result.branchName} onto ${result.baseBranch}`);
      await refreshGitState();
    } catch (error) {
      console.error('Failed to rebase session branch:', error);
      setFeedback(error instanceof Error ? error.message : 'Failed to rebase session branch');
    } finally {
      setIsRebasing(false);
    }
  }, [refreshGitState, selectedRepo, sessionId]);

  const repoOptions = useMemo(() => {
    return gitRepos.map((repo) => {
      const relativeLabel = repo.relativeRepoPath?.trim();
      return {
        value: repo.sourceRepoPath,
        label: relativeLabel && relativeLabel !== '.'
          ? relativeLabel
          : (getBaseName(repo.sourceRepoPath) || repo.sourceRepoPath),
      };
    });
  }, [gitRepos]);

  if (!selectedRepo) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500 dark:text-slate-400">
        This session has no Git repository context.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-[#111827]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2 text-xs dark:border-slate-800">
        {repoOptions.length > 1 ? (
          <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
            <GitBranch className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
            <select
              className="min-w-0 bg-transparent outline-none"
              value={selectedRepo.sourceRepoPath}
              onChange={(event) => onSelectedSourceRepoPathChange(event.target.value)}
            >
              {repoOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            {repoOptions[0]?.label}
          </div>
        )}

        <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
          <span className="text-slate-500 dark:text-slate-400">Base</span>
          <select
            className="min-w-0 bg-transparent outline-none"
            value={currentBaseBranch}
            onChange={(event) => {
              void handleBaseBranchChange(event.target.value);
            }}
            disabled={isUpdatingBaseBranch}
          >
            <option value="">Select branch</option>
            {baseBranchOptions.map((branchOption) => (
              <option key={branchOption} value={branchOption}>
                {branchOption}
              </option>
            ))}
          </select>
        </label>

        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            Ahead {divergence.ahead}
          </span>
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            Behind {divergence.behind}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-xs gap-1"
            onClick={() => {
              void refreshGitState();
            }}
            disabled={isRefreshing}
          >
            {isRefreshing ? <span className="loading loading-spinner loading-xs" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs gap-1"
            onClick={() => {
              void handleRebase();
            }}
            disabled={isRebasing || !currentBaseBranch}
          >
            {isRebasing ? <span className="loading loading-spinner loading-xs" /> : <GitMerge className="h-3.5 w-3.5" />}
            Rebase
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs gap-1"
            onClick={() => {
              void handleMerge();
            }}
            disabled={isMerging || !currentBaseBranch}
          >
            {isMerging ? <span className="loading loading-spinner loading-xs" /> : <GitPullRequestArrow className="h-3.5 w-3.5" />}
            Merge
          </button>
        </div>
      </div>

      {feedback ? (
        <div className="shrink-0 border-b border-slate-200 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
          {feedback}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        <SessionRepoViewer
          repoPath={selectedRepo.worktreePath || selectedRepo.sourceRepoPath}
          branchHint={selectedRepo.branchName}
          baseBranchHint={currentBaseBranch || selectedRepo.baseBranch}
        />
      </div>
    </div>
  );
}
