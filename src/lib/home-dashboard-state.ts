export function filterHomeProjects(
  sortedRecentProjects: string[],
  homeSearchQuery: string,
  getProjectDisplayName: (projectReference: string) => string,
  getProjectSecondaryLabel: (projectReference: string) => string,
): string[] {
  const normalizedQuery = homeSearchQuery.trim().toLowerCase();
  if (!normalizedQuery) {
    return sortedRecentProjects;
  }

  return sortedRecentProjects.filter((projectReference) => {
    const displayName = getProjectDisplayName(projectReference).toLowerCase();
    const secondaryLabel = getProjectSecondaryLabel(projectReference).toLowerCase();
    return displayName.includes(normalizedQuery) || secondaryLabel.includes(normalizedQuery);
  });
}

export function getHomeDashboardRenderState(input: {
  isBootstrapLoaded: boolean;
  isActivityLoaded: boolean;
  filteredRecentProjects: string[];
  homeSearchQuery: string;
}): {
  kind: 'loading' | 'empty' | 'grid';
  emptyMessage?: string;
} {
  if (!input.isBootstrapLoaded) {
    return { kind: 'loading' };
  }

  if (input.filteredRecentProjects.length > 0) {
    return { kind: 'grid' };
  }

  return {
    kind: 'empty',
    emptyMessage: input.homeSearchQuery.trim()
      ? 'No projects match your search.'
      : 'No recent projects found.',
  };
}
