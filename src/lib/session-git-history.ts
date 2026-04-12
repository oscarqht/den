import type { Commit } from './types.ts';

export function isSameCommitHash(left: string, right: string): boolean {
  const normalizedLeft = left.trim();
  const normalizedRight = right.trim();
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft.startsWith(normalizedRight) || normalizedRight.startsWith(normalizedLeft);
}

export function selectSessionHistoryCommits(
  allCommits: Commit[],
  options: {
    baseCommitId?: string | null;
    mergeBaseHash?: string | null;
  } = {},
): Commit[] {
  const baseCommitId = options.baseCommitId?.trim() || '';
  if (baseCommitId && allCommits.some((commit) => isSameCommitHash(baseCommitId, commit.hash))) {
    return allCommits;
  }

  const mergeBaseHash = options.mergeBaseHash?.trim() || '';
  if (!mergeBaseHash) {
    return allCommits;
  }

  const branchPointIndex = allCommits.findIndex((commit) => isSameCommitHash(mergeBaseHash, commit.hash));
  if (branchPointIndex < 0) {
    return allCommits;
  }

  return allCommits.slice(0, branchPointIndex + 1);
}
