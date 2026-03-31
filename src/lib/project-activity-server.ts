import path from 'node:path';
import { readLocalState, updateLocalState } from './local-db.ts';
import { getProjectPrimaryFolderPath, isSameOrNestedPath, normalizeProjectFolderPath } from './project-folders.ts';
import { findProjectByFolderPath, getProjectById } from './store.ts';

export type ResolvedProjectActivityFilter = {
  projectId: string | null;
  projectPath: string | null;
  folderPaths: string[];
  filterColumn: 'project_id' | 'project_path';
  filterValue: string;
};

export function resolveProjectActivityFilter(
  projectReference?: string | null,
): ResolvedProjectActivityFilter | null {
  const trimmedReference = projectReference?.trim();
  if (!trimmedReference) return null;

  const projectById = getProjectById(trimmedReference);
  if (projectById) {
    return {
      projectId: projectById.id,
      projectPath: getProjectPrimaryFolderPath(projectById),
      folderPaths: projectById.folderPaths,
      filterColumn: 'project_id',
      filterValue: projectById.id,
    };
  }

  if (!path.isAbsolute(trimmedReference)) {
    return {
      projectId: null,
      projectPath: trimmedReference,
      folderPaths: [],
      filterColumn: 'project_path',
      filterValue: trimmedReference,
    };
  }

  const normalizedProjectPath = normalizeProjectFolderPath(trimmedReference);
  const projectByFolderPath = findProjectByFolderPath(normalizedProjectPath);
  if (projectByFolderPath) {
    return {
      projectId: projectByFolderPath.id,
      projectPath: getProjectPrimaryFolderPath(projectByFolderPath),
      folderPaths: projectByFolderPath.folderPaths,
      filterColumn: 'project_id',
      filterValue: projectByFolderPath.id,
    };
  }

  return {
    projectId: null,
    projectPath: normalizedProjectPath,
    folderPaths: [normalizedProjectPath],
    filterColumn: 'project_path',
    filterValue: normalizedProjectPath,
  };
}

function matchesStoredProjectFolder(
  folderPaths: string[],
  candidatePath?: string | null,
): boolean {
  const trimmedCandidate = candidatePath?.trim();
  if (!trimmedCandidate || !path.isAbsolute(trimmedCandidate)) {
    return false;
  }

  try {
    return folderPaths.some((folderPath) => isSameOrNestedPath(folderPath, trimmedCandidate));
  } catch {
    return false;
  }
}

function repairMissingProjectIds(
  tableName: 'sessions' | 'drafts',
  projectReference?: string | null,
): void {
  const resolvedFilter = resolveProjectActivityFilter(projectReference);
  if (!resolvedFilter?.projectId || resolvedFilter.folderPaths.length === 0) {
    return;
  }

  updateLocalState((state) => {
    if (tableName === 'sessions') {
      for (const session of Object.values(state.sessions)) {
        if (session.projectId && session.projectId.trim()) {
          continue;
        }

        if (
          !matchesStoredProjectFolder(resolvedFilter.folderPaths, session.projectPath)
          && !matchesStoredProjectFolder(resolvedFilter.folderPaths, session.repoPath)
        ) {
          continue;
        }

        session.projectId = resolvedFilter.projectId;
      }
      return;
    }

    for (const draft of Object.values(state.drafts)) {
      if (draft.projectId && draft.projectId.trim()) {
        continue;
      }

      if (
        !matchesStoredProjectFolder(resolvedFilter.folderPaths, draft.projectPath)
        && !matchesStoredProjectFolder(resolvedFilter.folderPaths, draft.repoPath)
      ) {
        continue;
      }

      draft.projectId = resolvedFilter.projectId;
    }
  });
}

export function repairMissingSessionProjectIds(projectReference?: string | null): void {
  repairMissingProjectIds('sessions', projectReference);
}

export function repairMissingDraftProjectIds(projectReference?: string | null): void {
  repairMissingProjectIds('drafts', projectReference);
}
