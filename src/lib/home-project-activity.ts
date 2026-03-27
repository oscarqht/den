type HomeProjectSessionLike = {
  projectId?: string | null;
  projectPath?: string | null;
  repoPath?: string | null;
};

export function countHomeProjectSessionsByProject(
  sessions: HomeProjectSessionLike[],
  resolveProjectKey: (session: HomeProjectSessionLike) => string,
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const session of sessions) {
    const projectKey = resolveProjectKey(session).trim();
    if (!projectKey) {
      continue;
    }

    counts.set(projectKey, (counts.get(projectKey) ?? 0) + 1);
  }

  return counts;
}
