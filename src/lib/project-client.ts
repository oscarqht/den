import type { Project } from './types.ts';
import { getBaseName } from './path.ts';

export type ResolvedProjectReference = {
  key: string;
  project: Project | null;
  primaryPath: string | null;
  sessionReference: string | null;
  displayName: string;
  secondaryLabel: string;
  folderPaths: string[];
  hasAssociatedFolders: boolean;
  isOpenable: boolean;
  compatibilityKeys: string[];
};

export type ProjectActivityReference = {
  projectId?: string | null;
  projectPath?: string | null;
  repoPath?: string | null;
};

function normalizeProjectReference(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').trim();
}

export function getClientProjectPrimaryFolderPath(project: Pick<Project, 'folderPaths'>): string | null {
  const primaryFolderPath = project.folderPaths[0]?.trim();
  return primaryFolderPath ? primaryFolderPath : null;
}

export function getClientProjectCompatibilityKeys(project: Project): string[] {
  return Array.from(new Set([
    project.id,
    ...project.folderPaths,
    getClientProjectPrimaryFolderPath(project) ?? '',
  ].filter(Boolean)));
}

export function findClientProjectByReference(
  projects: Project[],
  reference: string,
): Project | null {
  const trimmedReference = reference.trim();
  if (!trimmedReference) return null;

  const projectById = projects.find((project) => project.id === trimmedReference);
  if (projectById) {
    return projectById;
  }

  const normalizedReference = normalizeProjectReference(trimmedReference);
  return projects.find((project) => project.folderPaths.some((folderPath) => (
    normalizeProjectReference(folderPath) === normalizedReference
  ))) ?? null;
}

export function resolveClientProjectReference(
  projects: Project[],
  reference: string,
): ResolvedProjectReference {
  const project = findClientProjectByReference(projects, reference);
  if (!project) {
    const fallbackPath = reference.trim();
    const fallbackDisplayName = getBaseName(fallbackPath) || fallbackPath || 'Project';
    return {
      key: fallbackPath,
      project: null,
      primaryPath: fallbackPath || null,
      sessionReference: fallbackPath || null,
      displayName: fallbackDisplayName,
      secondaryLabel: fallbackPath || 'No folders associated',
      folderPaths: fallbackPath ? [fallbackPath] : [],
      hasAssociatedFolders: Boolean(fallbackPath),
      isOpenable: Boolean(fallbackPath),
      compatibilityKeys: fallbackPath ? [fallbackPath] : [],
    };
  }

  const primaryPath = getClientProjectPrimaryFolderPath(project);
  const folderCount = project.folderPaths.length;
  const sessionReference = primaryPath || project.id;
  const secondaryLabel = primaryPath
    ? (folderCount > 1 ? `${primaryPath} (${folderCount} folders)` : primaryPath)
    : 'No folders associated';

  return {
    key: project.id,
    project,
    primaryPath,
    sessionReference,
    displayName: project.name.trim() || getBaseName(primaryPath || '') || 'Project',
    secondaryLabel,
    folderPaths: project.folderPaths,
    hasAssociatedFolders: folderCount > 0,
    isOpenable: Boolean(sessionReference),
    compatibilityKeys: getClientProjectCompatibilityKeys(project),
  };
}

export function resolveClientRecentProjects(
  projects: Project[],
  references: string[],
): ResolvedProjectReference[] {
  const resolvedProjects: ResolvedProjectReference[] = [];
  const seenKeys = new Set<string>();

  for (const reference of references) {
    const resolvedReference = resolveClientProjectReference(projects, reference);
    if (!resolvedReference.key || seenKeys.has(resolvedReference.key)) {
      continue;
    }

    seenKeys.add(resolvedReference.key);
    resolvedProjects.push(resolvedReference);
  }

  return resolvedProjects;
}

export function createClientProjectCompatibilityMap(
  resolvedProjects: ResolvedProjectReference[],
): Map<string, string> {
  const compatibilityMap = new Map<string, string>();

  for (const resolvedProject of resolvedProjects) {
    for (const compatibilityKey of resolvedProject.compatibilityKeys) {
      if (!compatibilityKey || compatibilityMap.has(compatibilityKey)) {
        continue;
      }

      compatibilityMap.set(compatibilityKey, resolvedProject.key);
    }
  }

  return compatibilityMap;
}

export function resolveClientProjectActivityKey(
  projects: Project[],
  reference: ProjectActivityReference,
  preferredProjectKeyByCompatibilityKey?: Map<string, string>,
): string {
  const compatibilityReferences = [
    reference.projectId?.trim() || '',
    reference.projectPath?.trim() || '',
    reference.repoPath?.trim() || '',
  ].filter(Boolean);
  for (const compatibilityReference of compatibilityReferences) {
    const preferredProjectKey = preferredProjectKeyByCompatibilityKey?.get(compatibilityReference);
    if (preferredProjectKey) {
      return preferredProjectKey;
    }
  }

  const pathReference = reference.projectPath?.trim() || reference.repoPath?.trim() || '';
  if (pathReference) {
    const projectFromPath = findClientProjectByReference(projects, pathReference);
    if (projectFromPath) {
      return projectFromPath.id;
    }
  }

  const projectIdReference = reference.projectId?.trim() || '';
  if (projectIdReference) {
    const projectFromId = findClientProjectByReference(projects, projectIdReference);
    if (projectFromId) {
      return projectFromId.id;
    }
  }

  return pathReference || projectIdReference;
}
