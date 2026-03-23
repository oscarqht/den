export type HomeProjectSort = 'last-update' | 'name';

export const DEFAULT_HOME_PROJECT_SORT: HomeProjectSort = 'last-update';

export function normalizeHomeProjectSort(value: unknown): HomeProjectSort {
  return value === 'name' ? 'name' : DEFAULT_HOME_PROJECT_SORT;
}

export function sortHomeProjects(
  projectPaths: string[],
  sort: HomeProjectSort,
  getProjectDisplayName: (projectPath: string) => string,
): string[] {
  if (sort !== 'name') {
    return projectPaths;
  }

  return [...projectPaths].sort((left, right) => {
    const leftName = getProjectDisplayName(left);
    const rightName = getProjectDisplayName(right);
    const byName = leftName.localeCompare(rightName, undefined, {
      sensitivity: 'base',
      numeric: true,
    });
    if (byName !== 0) {
      return byName;
    }
    return left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });
  });
}
