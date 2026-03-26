import { getBaseName } from './path.ts';

export type HomeProjectGitRepo = {
  repoPath: string;
  label: string;
};

export type DiscoveredHomeProjectGitRepo = {
  repoPath: string;
  relativePath: string;
};

export function getHomeProjectGitRepoLabel(relativePath: string, repoPath: string): string {
  const trimmedRelativePath = relativePath.trim();
  if (trimmedRelativePath) {
    return trimmedRelativePath;
  }

  const baseName = getBaseName(repoPath);
  return baseName || repoPath;
}

export function toHomeProjectGitRepos(
  repos: DiscoveredHomeProjectGitRepo[],
): HomeProjectGitRepo[] {
  return repos.map((repo) => ({
    repoPath: repo.repoPath,
    label: getHomeProjectGitRepoLabel(repo.relativePath, repo.repoPath),
  }));
}

export function omitRecordKeys<T>(
  record: Record<string, T>,
  keysToRemove: string[],
): Record<string, T> {
  if (keysToRemove.length === 0) {
    return record;
  }

  const blockedKeys = new Set(keysToRemove);
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !blockedKeys.has(key)),
  );
}
