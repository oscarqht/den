import os from 'node:os';
import { normalizeProjectFolderPath } from './project-folders.ts';
import type { Project, SessionWorkspacePreference } from './types.ts';

export function resolveStoredProjectSessionContext(
  project: Pick<Project, 'id' | 'folderPaths'>,
): {
  projectId: string;
  normalizedProjectPath: string;
  normalizedFolderPaths: string[];
} {
  const normalizedFolderPaths = project.folderPaths.map((folderPath) => normalizeProjectFolderPath(folderPath));
  const primaryFolderPath = normalizedFolderPaths[0];

  return {
    projectId: project.id,
    normalizedProjectPath: primaryFolderPath || normalizeProjectFolderPath(os.homedir()),
    normalizedFolderPaths,
  };
}

export function resolveProjectWorkspacePreference(
  normalizedFolderPaths: string[],
  workspacePreference: SessionWorkspacePreference,
): SessionWorkspacePreference {
  return normalizedFolderPaths.length === 0 ? 'local' : workspacePreference;
}
