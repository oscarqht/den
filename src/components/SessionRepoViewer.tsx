'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useGitAction, useGitBranches, useGitLog, useGitMergeBase, useGitStatus } from '@/hooks/use-git';
import { useEscapeDismiss } from '@/hooks/use-escape-dismiss';
import { isSameCommitHash, selectSessionHistoryCommits } from '@/lib/session-git-history';
import { Commit } from '@/lib/types';
import { CommitChangesView } from './git/commit-changes-view';

type CommitBadgeTone = 'current' | 'base' | 'ref';

function formatCommitDate(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

function commitLabel(commit: Commit): string {
  return `${commit.hash} ${commit.message}`.trim();
}

function parseBranchHintList(value: string | undefined): string[] {
  if (!value) return [];

  return Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function appendCommitBadge(
  badges: Array<{ label: string; tone: CommitBadgeTone }>,
  label: string,
  tone: CommitBadgeTone,
) {
  const normalizedLabel = label.trim();
  if (!normalizedLabel || badges.some((badge) => badge.label === normalizedLabel)) {
    return;
  }
  badges.push({ label: normalizedLabel, tone });
}

function parseCommitRefBadges(refs: string): string[] {
  const normalizedRefs = refs.trim();
  if (!normalizedRefs) return [];

  const body = normalizedRefs.startsWith('(') && normalizedRefs.endsWith(')')
    ? normalizedRefs.slice(1, -1)
    : normalizedRefs;

  return Array.from(new Set(
    body
      .split(',')
      .map((entry) => entry.trim())
      .flatMap((entry) => {
        if (!entry || entry === 'HEAD') return [];
        if (entry.startsWith('tag: ')) return [];
        if (entry.includes('->')) {
          const [, target = ''] = entry.split('->').map((part) => part.trim());
          if (!target || target.endsWith('/HEAD')) return [];
          return [target];
        }
        if (entry.endsWith('/HEAD')) return [];
        return [entry];
      })
      .filter(Boolean),
  ));
}

function normalizeCommitMessage(message: string): string {
  return message.replace(/\r\n/g, '\n').replace(/\s+$/, '');
}

function hasCommitSubject(message: string): boolean {
  const [firstLine = ''] = message.replace(/\r\n/g, '\n').split('\n');
  return firstLine.trim().length > 0;
}

type SessionRepoViewerProps = {
  repoPath: string;
  branchHint?: string;
  baseBranchHint?: string;
  baseCommitIdHint?: string;
  repoOptions?: SessionRepoViewerOption[];
  refreshToken?: number;
};

type CommitSelectionState =
  | { mode: 'auto'; hash: null }
  | { mode: 'manual'; hash: string }
  | { mode: 'unselected'; hash: null };

export type SessionRepoViewerOption = {
  path: string;
  label: string;
  branchHint?: string;
  baseBranchHint?: string;
};

export function SessionRepoViewer({
  repoPath,
  branchHint,
  baseBranchHint,
  baseCommitIdHint,
  repoOptions = [],
  refreshToken,
}: SessionRepoViewerProps) {
  const normalizedRepoOptions = useMemo<SessionRepoViewerOption[]>(() => {
    const explicitOptions = repoOptions
      .map((option) => ({
        path: option.path.trim(),
        label: option.label.trim(),
        branchHint: option.branchHint?.trim() || undefined,
        baseBranchHint: option.baseBranchHint?.trim() || undefined,
      }))
      .filter((option) => option.path);

    if (explicitOptions.length > 0) return explicitOptions;

    const fallbackRepoPath = repoPath.trim();
    if (!fallbackRepoPath) return [];
    return [{
      path: fallbackRepoPath,
      label: fallbackRepoPath,
      branchHint: branchHint?.trim() || undefined,
      baseBranchHint: baseBranchHint?.trim() || undefined,
    }];
  }, [baseBranchHint, branchHint, repoOptions, repoPath]);
  const [selectedRepoPath, setSelectedRepoPath] = useState<string>(
    () => normalizedRepoOptions[0]?.path || repoPath.trim(),
  );
  const selectedRepoOption = useMemo(() => {
    if (normalizedRepoOptions.length === 0) return null;
    return normalizedRepoOptions.find((option) => option.path === selectedRepoPath) || normalizedRepoOptions[0];
  }, [normalizedRepoOptions, selectedRepoPath]);
  const effectiveRepoPath = selectedRepoOption?.path || repoPath;
  const effectiveBranchHint = selectedRepoOption?.branchHint || branchHint;
  const effectiveBaseBranchHint = selectedRepoOption?.baseBranchHint || baseBranchHint;
  const [selection, setSelection] = useState<CommitSelectionState>({ mode: 'auto', hash: null });
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [commitMessageError, setCommitMessageError] = useState<string | null>(null);
  const [isRefreshingRepoData, setIsRefreshingRepoData] = useState(false);
  const lastExternalRefreshTokenRef = useRef<number | undefined>(refreshToken);
  const queryClient = useQueryClient();
  const action = useGitAction();
  const { data: branchData } = useGitBranches(effectiveRepoPath);
  const currentBranchRef = branchData?.current?.trim() || effectiveBranchHint?.trim() || null;
  const currentBranch = currentBranchRef || 'unknown';
  const baseBranchRef = effectiveBaseBranchHint?.trim() || null;
  const baseCommitIdRef = baseCommitIdHint?.trim() || null;
  const { data: statusData } = useGitStatus(effectiveRepoPath);
  const {
    data: log,
    isLoading,
    isFetching,
    isError,
    error,
  } = useGitLog(effectiveRepoPath, baseCommitIdRef ? null : 200, {
    scope: 'current',
    baseCommitId: baseCommitIdRef,
    headRef: currentBranchRef,
    includeBoundary: true,
    fallbackToCurrent: true,
  });
  const allCommits = useMemo(() => log?.all ?? [], [log]);
  const { data: mergeBaseHash } = useGitMergeBase(effectiveRepoPath, baseBranchRef, currentBranchRef);
  const commits = useMemo(() => {
    return selectSessionHistoryCommits(allCommits, {
      baseCommitId: baseCommitIdRef,
      mergeBaseHash,
    });
  }, [allCommits, baseCommitIdRef, mergeBaseHash]);
  const displayCommitCount = commits.length;
  const currentBranchHeadHash = branchData?.branchCommits?.[currentBranchRef || ''] || commits[0]?.hash || null;
  const fallbackBaseBranchTags = useMemo(() => {
    const hintedBranches = parseBranchHintList(effectiveBaseBranchHint);
    if (!mergeBaseHash) return hintedBranches;

    const localBranches = branchData?.branches ?? [];
    const localBranchCommits = branchData?.branchCommits ?? {};
    const normalizedCurrentBranch = currentBranchRef?.trim() || '';
    const branchNamesAtMergeBase = localBranches.filter((branchName) => {
      if (normalizedCurrentBranch && branchName === normalizedCurrentBranch) return false;
      const branchHeadHash = localBranchCommits[branchName];
      if (!branchHeadHash) return false;
      return isSameCommitHash(branchHeadHash, mergeBaseHash);
    });

    return Array.from(new Set([...hintedBranches, ...branchNamesAtMergeBase])).sort((a, b) => a.localeCompare(b));
  }, [branchData?.branchCommits, branchData?.branches, currentBranchRef, effectiveBaseBranchHint, mergeBaseHash]);
  const selectedCommitHash = useMemo(() => {
    if (commits.length === 0) return null;
    if (selection.mode === 'unselected') return null;
    if (selection.mode === 'manual' && commits.some((commit) => commit.hash === selection.hash)) {
      return selection.hash;
    }
    return commits[0].hash;
  }, [commits, selection]);
  const hasUnstagedChanges = (statusData?.files ?? []).some(
    (file) => file.working_dir !== ' ' || file.index === '?'
  );
  const hasAnyChanges = (statusData?.files?.length ?? 0) > 0;

  useEffect(() => {
    if (normalizedRepoOptions.length === 0) {
      setSelectedRepoPath(repoPath.trim());
      return;
    }

    setSelectedRepoPath((previous) => (
      normalizedRepoOptions.some((option) => option.path === previous)
        ? previous
        : normalizedRepoOptions[0].path
    ));
  }, [normalizedRepoOptions, repoPath]);

  useEffect(() => {
    setSelection({ mode: 'auto', hash: null });
  }, [effectiveRepoPath]);

  const closeCommitDialog = () => {
    setCommitDialogOpen(false);
    setCommitMessageError(null);
  };

  const handleDiscard = async () => {
    await action.mutateAsync({ repoPath: effectiveRepoPath, action: 'discard', data: { includeUntracked: true } });
    setDiscardDialogOpen(false);
    setSelection({ mode: 'auto', hash: null });
  };

  const handleCommitAll = async () => {
    const normalizedMessage = normalizeCommitMessage(commitMessage);
    if (!hasCommitSubject(normalizedMessage)) {
      setCommitMessageError('Commit message first line (subject) is required.');
      return;
    }

    await action.mutateAsync({
      repoPath: effectiveRepoPath,
      action: 'commit',
      data: { message: normalizedMessage, files: ['.'] },
    });
    setCommitDialogOpen(false);
    setCommitMessage('');
    setCommitMessageError(null);
    setSelection({ mode: 'auto', hash: null });
  };

  useEscapeDismiss(discardDialogOpen, () => setDiscardDialogOpen(false), () => {
    if (action.isPending) return;
    void handleDiscard();
  });
  useEscapeDismiss(commitDialogOpen, closeCommitDialog, () => {
    if (action.isPending) return;
    void handleCommitAll();
  });

  const handleCommitClick = (commitHash: string) => {
    if (selectedCommitHash === commitHash) {
      setSelection({ mode: 'unselected', hash: null });
      return;
    }
    setSelection({ mode: 'manual', hash: commitHash });
  };

  const refetchCommitHistoryData = useCallback(async () => {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ['git', effectiveRepoPath, 'log'], type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['git', effectiveRepoPath, 'branches'], type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['git', effectiveRepoPath, 'merge-base'], type: 'active' }),
    ]);
  }, [effectiveRepoPath, queryClient]);

  const handleRefreshRepoData = useCallback(async () => {
    setIsRefreshingRepoData(true);
    try {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['git', effectiveRepoPath, 'status'], type: 'active' }),
        queryClient.refetchQueries({ queryKey: ['git', effectiveRepoPath, 'diff'], type: 'active' }),
        queryClient.refetchQueries({ queryKey: ['git', effectiveRepoPath, 'commit-diff'], type: 'active' }),
        queryClient.refetchQueries({ queryKey: ['git', effectiveRepoPath, 'commit-file-diff'], type: 'active' }),
        refetchCommitHistoryData(),
      ]);
    } finally {
      setIsRefreshingRepoData(false);
    }
  }, [effectiveRepoPath, queryClient, refetchCommitHistoryData]);

  useEffect(() => {
    if (refreshToken === undefined) {
      return;
    }
    if (lastExternalRefreshTokenRef.current === refreshToken) {
      return;
    }

    lastExternalRefreshTokenRef.current = refreshToken;
    void handleRefreshRepoData();
  }, [handleRefreshRepoData, refreshToken]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50 app-dark-root">
      <div className="flex min-h-0 flex-[2] flex-col border-b border-slate-200 dark:border-slate-700">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-slate-200 px-3 text-[11px] font-semibold text-slate-600 app-dark-surface-raised">
          <div className="flex min-w-0 items-center gap-2 uppercase tracking-wide">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500"></span>
            <span className="truncate">Repo Diff</span>
            <span className="truncate opacity-70 normal-case" title={currentBranch}>
              {currentBranch}
            </span>
            {normalizedRepoOptions.length > 1 && (
              <select
                className="select select-xs h-6 min-h-6 max-w-[220px] rounded border-slate-300 bg-white text-[10px] font-medium normal-case text-slate-700 focus:outline-none app-dark-input"
                value={selectedRepoOption?.path || effectiveRepoPath}
                onChange={(event) => setSelectedRepoPath(event.target.value)}
                title="Select repository"
              >
                {normalizedRepoOptions.map((option) => (
                  <option key={option.path} value={option.path}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[10px] opacity-70">
              {displayCommitCount} commit{displayCommitCount === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-xs h-6 min-h-6 border-none px-2 text-[10px] text-slate-600 hover:bg-slate-100 disabled:text-slate-400 dark:text-slate-300 app-dark-hover dark:disabled:text-slate-600"
              onClick={() => void handleRefreshRepoData()}
              disabled={action.isPending || isRefreshingRepoData}
              title="Refresh repo diff and commit history"
              aria-label="Refresh repo diff and commit history"
            >
              <RefreshCw className={`h-3 w-3 ${isRefreshingRepoData ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs h-6 min-h-6 border-none px-2 text-[10px] text-red-600 hover:bg-red-50 disabled:text-slate-400 dark:text-red-300 dark:hover:bg-red-500/10 dark:disabled:text-slate-600"
              onClick={() => setDiscardDialogOpen(true)}
              disabled={!hasUnstagedChanges || action.isPending}
              title="Discard all unstaged changes"
            >
              Discard
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs h-6 min-h-6 border-none px-2 text-[10px] text-emerald-700 hover:bg-emerald-50 disabled:text-slate-400 dark:text-emerald-300 dark:hover:bg-emerald-500/10 dark:disabled:text-slate-600"
              onClick={() => {
                setCommitMessageError(null);
                setCommitDialogOpen(true);
              }}
              disabled={!hasAnyChanges || action.isPending}
              title="Stage all and commit"
            >
              Commit
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <CommitChangesView
            repoPath={effectiveRepoPath}
            commitHash={selectedCommitHash}
            showWorkingTreeWhenNoCommit
            fileListWidthClass="w-52"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-slate-200 px-3 text-[11px] font-semibold text-slate-600 app-dark-surface-raised">
          <span className="uppercase tracking-wide">Commit History</span>
          <button
            type="button"
            className="btn btn-ghost btn-xs h-6 min-h-6 w-7 border-none p-0 text-slate-600 hover:bg-slate-100 dark:text-slate-300 app-dark-hover"
            onClick={() => void refetchCommitHistoryData()}
            title="Refresh commit history"
            aria-label="Refresh commit history"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${(isFetching || isRefreshingRepoData) ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-xs text-slate-500 dark:text-slate-400">
              <span className="loading loading-spinner loading-sm"></span>
            </div>
          ) : isError ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-xs text-red-500 dark:text-red-300">
              {error instanceof Error ? error.message : 'Failed to load commit history'}
            </div>
          ) : commits.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No commits found on this branch.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-[color:var(--app-dark-border-subtle)]">
              {commits.map((commit, index) => {
                const isSelected = selectedCommitHash === commit.hash;
                const commitBadges: Array<{ label: string; tone: CommitBadgeTone }> = [];

                if (currentBranch && currentBranchHeadHash && isSameCommitHash(commit.hash, currentBranchHeadHash)) {
                  appendCommitBadge(commitBadges, currentBranch, 'current');
                }
                if (baseBranchRef && baseCommitIdRef && isSameCommitHash(commit.hash, baseCommitIdRef)) {
                  appendCommitBadge(commitBadges, baseBranchRef, 'base');
                }
                parseCommitRefBadges(commit.refs).forEach((label) => appendCommitBadge(commitBadges, label, 'ref'));
                if (
                  commitBadges.length === 0
                  && index === commits.length - 1
                  && !baseCommitIdRef
                  && !!mergeBaseHash
                  && isSameCommitHash(commit.hash, mergeBaseHash)
                ) {
                  fallbackBaseBranchTags.forEach((label) => appendCommitBadge(commitBadges, label, 'base'));
                }
                return (
                  <button
                    key={commit.hash}
                    type="button"
                    onClick={() => handleCommitClick(commit.hash)}
                    className={`w-full px-3 py-2 text-left transition-colors ${isSelected
                      ? 'bg-amber-100/80 dark:bg-[color-mix(in_srgb,var(--app-dark-accent)_18%,var(--app-dark-panel))]'
                      : 'hover:bg-slate-100 app-dark-hover-soft'
                      }`}
                    title={commitLabel(commit)}
                  >
                    <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 app-dark-surface-raised">{commit.hash}</span>
                      <span className="truncate">{formatCommitDate(commit.date)}</span>
                    </div>
                    <div className="mt-1 truncate text-xs font-medium text-slate-800 dark:text-slate-100">
                      {commit.message || '(no subject)'}
                    </div>
                    {commitBadges.length > 0 && (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {commitBadges.map((badge) => (
                          <span
                            key={badge.label}
                            className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                              badge.tone === 'current'
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200'
                                : badge.tone === 'base'
                                  ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200'
                                  : 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-700/40 dark:text-slate-200'
                            }`}
                            title={badge.tone === 'base'
                              ? `Base branch: ${badge.label}`
                              : badge.tone === 'current'
                                ? `Current branch: ${badge.label}`
                                : `Ref: ${badge.label}`}
                          >
                            {badge.label}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {commit.author_name}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {discardDialogOpen && (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Discard Unstaged Changes</h3>
            <p className="py-4">
              Are you sure you want to discard all unstaged local changes and new files? This action cannot be undone.
            </p>
            <div className="modal-action">
              <button className="btn" onClick={() => setDiscardDialogOpen(false)} disabled={action.isPending}>
                Cancel
              </button>
              <button className="btn btn-error" onClick={() => void handleDiscard()} disabled={action.isPending}>
                {action.isPending && <span className="loading loading-spinner loading-xs"></span>}
                Discard
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setDiscardDialogOpen(false)}>close</button>
          </form>
        </dialog>
      )}

      {commitDialogOpen && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-2xl">
            <h3 className="font-bold text-lg">Commit All Changes</h3>
            <p className="py-3 opacity-70">
              Provide a commit message. The first line is used as the subject.
            </p>
            <textarea
              className="textarea textarea-bordered h-48 w-full font-sans"
              value={commitMessage}
              onChange={(event) => {
                setCommitMessage(event.target.value);
                if (commitMessageError) setCommitMessageError(null);
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  if (!action.isPending) {
                    void handleCommitAll();
                  }
                }
              }}
              autoFocus
              placeholder={'feat: describe your change\n\nOptional details...'}
            />
            {commitMessageError && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-300">{commitMessageError}</p>
            )}
            <div className="modal-action">
              <button className="btn" onClick={closeCommitDialog} disabled={action.isPending}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={() => void handleCommitAll()} disabled={action.isPending}>
                {action.isPending && <span className="loading loading-spinner loading-xs"></span>}
                Commit
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={closeCommitDialog}>close</button>
          </form>
        </dialog>
      )}
    </div>
  );
}
