import path from 'node:path';
import type { Project } from './types.ts';
import { pickPreferredProject } from './project-preference.ts';

export type ProjectFolderEntry = {
  sourcePath: string;
  entryName: string;
};

export function normalizeProjectFolderPath(folderPath: string): string {
  const trimmed = folderPath.trim();
  if (!trimmed) {
    throw new Error('Folder path is required.');
  }
  return path.resolve(trimmed);
}

export function normalizeProjectFolderPaths(folderPaths: string[] | undefined): string[] {
  return Array.from(new Set((folderPaths ?? []).map((folderPath) => normalizeProjectFolderPath(folderPath))));
}

export function isSameOrNestedPath(parentPath: string, candidatePath: string): boolean {
  const normalizedParent = normalizeProjectFolderPath(parentPath);
  const normalizedCandidate = normalizeProjectFolderPath(candidatePath);
  if (normalizedParent === normalizedCandidate) return true;

  const relativePath = path.relative(normalizedParent, normalizedCandidate);
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

export function validateProjectFolderAssociations(folderPaths: string[]): void {
  const normalizedFolderPaths = normalizeProjectFolderPaths(folderPaths);

  for (let index = 0; index < normalizedFolderPaths.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < normalizedFolderPaths.length; compareIndex += 1) {
      const left = normalizedFolderPaths[index];
      const right = normalizedFolderPaths[compareIndex];
      if (isSameOrNestedPath(left, right) || isSameOrNestedPath(right, left)) {
        throw new Error('Project folders cannot duplicate or overlap through parent and child paths.');
      }
    }
  }
}

export function getProjectPrimaryFolderPath(project: Pick<Project, 'folderPaths'>): string | null {
  const primaryFolderPath = project.folderPaths[0]?.trim();
  return primaryFolderPath ? primaryFolderPath : null;
}

function sanitizeWorkspaceEntryName(name: string): string {
  const trimmed = name.trim();
  const fallback = trimmed || 'folder';
  return fallback
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'folder';
}

export function buildProjectFolderEntries(folderPaths: string[]): ProjectFolderEntry[] {
  const normalizedFolderPaths = normalizeProjectFolderPaths(folderPaths);
  const usedEntryNames = new Set<string>();

  return normalizedFolderPaths.map((sourcePath) => {
    const baseName = sanitizeWorkspaceEntryName(path.basename(sourcePath));
    let entryName = baseName;
    let suffix = 2;
    while (usedEntryNames.has(entryName)) {
      entryName = `${baseName}-${suffix}`;
      suffix += 1;
    }
    usedEntryNames.add(entryName);

    return {
      sourcePath,
      entryName,
    };
  });
}

export function findProjectByIdOrFolderPath(projects: Project[], projectIdOrFolderPath: string): Project | null {
  const trimmedValue = projectIdOrFolderPath.trim();
  if (!trimmedValue) return null;

  const byId = projects.find((project) => project.id === trimmedValue);
  if (byId) return byId;

  const normalizedFolderPath = path.resolve(trimmedValue);
  return pickPreferredProject(projects.filter((project) => (
    project.folderPaths.some((folderPath) => path.resolve(folderPath) === normalizedFolderPath)
  )));
}
