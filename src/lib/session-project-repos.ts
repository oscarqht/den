function normalizeRepoPaths(repoPaths: Array<string | null | undefined> | null | undefined): string[] {
  if (!repoPaths || repoPaths.length === 0) {
    return [];
  }

  return Array.from(new Set(
    repoPaths
      .map((repoPath) => repoPath?.trim() || '')
      .filter(Boolean),
  ));
}

export function shouldDiscoverProjectReposForSession(input: {
  launchContextRepoPaths?: Array<string | null | undefined> | null;
  sessionRepoPaths?: Array<string | null | undefined> | null;
}): boolean {
  return normalizeRepoPaths(input.launchContextRepoPaths).length === 0
    && normalizeRepoPaths(input.sessionRepoPaths).length === 0;
}

export function resolveProjectRepoPathsForSession(input: {
  launchContextRepoPaths?: Array<string | null | undefined> | null;
  sessionRepoPaths?: Array<string | null | undefined> | null;
  discoveredProjectRepoPaths?: Array<string | null | undefined> | null;
}): string[] | null {
  const launchContextRepoPaths = normalizeRepoPaths(input.launchContextRepoPaths);
  if (launchContextRepoPaths.length > 0) {
    return launchContextRepoPaths;
  }

  const sessionRepoPaths = normalizeRepoPaths(input.sessionRepoPaths);
  if (sessionRepoPaths.length > 0) {
    return sessionRepoPaths;
  }

  const discoveredProjectRepoPaths = normalizeRepoPaths(input.discoveredProjectRepoPaths);
  return discoveredProjectRepoPaths.length > 0 ? discoveredProjectRepoPaths : null;
}
