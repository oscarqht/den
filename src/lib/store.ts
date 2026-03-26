import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppSettings, Project, Repository } from './types.ts';
import { getLocalDb } from './local-db.ts';

type ProjectEntityRow = {
  id: string;
  name: string;
  icon_path: string | null;
  last_opened_at: string | null;
};

type ProjectFolderRow = {
  project_id: string;
  folder_path: string;
  position: number;
};

type RepositoryRow = {
  path: string;
  name: string;
  display_name: string | null;
  expanded_folders_json: string | null;
  visibility_map_json: string | null;
  local_group_expanded: number | null;
  remotes_group_expanded: number | null;
  worktrees_group_expanded: number | null;
};

type AppSettingsRow = {
  default_root_folder: string | null;
  sidebar_collapsed: number | null;
  history_panel_height: number | null;
};

function parseJsonValue<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function normalizeProjectName(name: string): string {
  const normalized = name.trim();
  if (!normalized) {
    throw new Error('Project name is required');
  }
  return normalized;
}

function normalizeFolderPath(folderPath: string): string {
  const normalized = folderPath.trim();
  if (!normalized) {
    throw new Error('Folder path is required');
  }
  return path.resolve(normalized);
}

function normalizeFolderPaths(folderPaths: string[] | undefined): string[] {
  return Array.from(
    new Set((folderPaths ?? []).map((folderPath) => normalizeFolderPath(folderPath))),
  );
}

function normalizeIconPath(iconPath?: string | null): string | null | undefined {
  if (iconPath === undefined) return undefined;
  if (iconPath === null) return null;
  const normalized = iconPath.trim();
  return normalized.length > 0 ? normalized : null;
}

function rowToProject(row: ProjectEntityRow, folderRows: ProjectFolderRow[]): Project {
  const project: Project = {
    id: row.id,
    name: row.name,
    folderPaths: folderRows
      .sort((left, right) => left.position - right.position)
      .map((folderRow) => folderRow.folder_path),
  };

  if (row.icon_path !== null) project.iconPath = row.icon_path;
  if (row.last_opened_at !== null) project.lastOpenedAt = row.last_opened_at;
  return project;
}

function writeProject(project: Project): void {
  const db = getLocalDb();
  const normalizedProject: Project = {
    id: project.id.trim(),
    name: normalizeProjectName(project.name),
    folderPaths: normalizeFolderPaths(project.folderPaths),
    iconPath: normalizeIconPath(project.iconPath),
    lastOpenedAt: project.lastOpenedAt?.trim() || undefined,
  };

  if (!normalizedProject.id) {
    throw new Error('Project id is required');
  }

  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT OR REPLACE INTO project_entities (
        id, name, icon_path, last_opened_at, created_at, updated_at
      ) VALUES (
        @id, @name, @iconPath, @lastOpenedAt,
        COALESCE((SELECT created_at FROM project_entities WHERE id = @id), datetime('now')),
        datetime('now')
      )
    `).run({
      id: normalizedProject.id,
      name: normalizedProject.name,
      iconPath: normalizedProject.iconPath ?? null,
      lastOpenedAt: normalizedProject.lastOpenedAt ?? null,
    });

    db.prepare(`DELETE FROM project_entity_folders WHERE project_id = ?`).run(normalizedProject.id);
    const insertFolder = db.prepare(`
      INSERT INTO project_entity_folders (project_id, folder_path, position)
      VALUES (@projectId, @folderPath, @position)
    `);
    normalizedProject.folderPaths.forEach((folderPath, index) => {
      insertFolder.run({
        projectId: normalizedProject.id,
        folderPath,
        position: index,
      });
    });
  });

  transaction();
}

function rowToRepository(row: RepositoryRow): Repository {
  const repository: Repository = {
    path: row.path,
    name: row.display_name?.trim() || row.name || path.basename(row.path),
  };

  const expandedFolders = parseJsonValue<Repository['expandedFolders']>(row.expanded_folders_json);
  if (expandedFolders) repository.expandedFolders = expandedFolders;
  const visibilityMap = parseJsonValue<Repository['visibilityMap']>(row.visibility_map_json);
  if (visibilityMap) repository.visibilityMap = visibilityMap;
  if (row.local_group_expanded !== null) repository.localGroupExpanded = Boolean(row.local_group_expanded);
  if (row.remotes_group_expanded !== null) repository.remotesGroupExpanded = Boolean(row.remotes_group_expanded);
  if (row.worktrees_group_expanded !== null) repository.worktreesGroupExpanded = Boolean(row.worktrees_group_expanded);
  return repository;
}

function ensureRepositoryRow(repoPath: string): void {
  const db = getLocalDb();
  const normalizedPath = normalizeFolderPath(repoPath);
  db.prepare(`
    INSERT OR IGNORE INTO repositories (
      path, name, display_name, last_opened_at, credential_id,
      expanded_folders_json, visibility_map_json, local_group_expanded,
      remotes_group_expanded, worktrees_group_expanded
    ) VALUES (
      @path, @name, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
    )
  `).run({
    path: normalizedPath,
    name: path.basename(normalizedPath),
  });
}

export function getProjects(): Project[] {
  const db = getLocalDb();
  const projectRows = db.prepare(`
    SELECT id, name, icon_path, last_opened_at
    FROM project_entities
    ORDER BY COALESCE(last_opened_at, ''), id ASC
  `).all() as ProjectEntityRow[];

  if (projectRows.length === 0) {
    return [];
  }

  const folderRows = db.prepare(`
    SELECT project_id, folder_path, position
    FROM project_entity_folders
    ORDER BY project_id ASC, position ASC
  `).all() as ProjectFolderRow[];
  const folderRowsByProjectId = new Map<string, ProjectFolderRow[]>();
  for (const folderRow of folderRows) {
    const current = folderRowsByProjectId.get(folderRow.project_id) ?? [];
    current.push(folderRow);
    folderRowsByProjectId.set(folderRow.project_id, current);
  }

  return projectRows.map((row) => rowToProject(row, folderRowsByProjectId.get(row.id) ?? []));
}

export function getProjectById(projectId: string): Project | null {
  const normalizedProjectId = projectId.trim();
  if (!normalizedProjectId) return null;
  return getProjects().find((project) => project.id === normalizedProjectId) ?? null;
}

export function findProjectByFolderPath(folderPath: string): Project | null {
  const normalizedFolderPath = normalizeFolderPath(folderPath);
  return getProjects().find((project) => project.folderPaths.includes(normalizedFolderPath)) ?? null;
}

export function findProjectsContainingPath(targetPath: string): Project[] {
  const normalizedTargetPath = normalizeFolderPath(targetPath);
  return getProjects().filter((project) => (
    project.folderPaths.some((folderPath) => {
      const relativePath = path.relative(folderPath, normalizedTargetPath);
      return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
    })
  ));
}

export function addProject(input: {
  name: string;
  folderPaths?: string[];
  iconPath?: string | null;
  lastOpenedAt?: string;
}): Project {
  const project: Project = {
    id: randomUUID(),
    name: normalizeProjectName(input.name),
    folderPaths: normalizeFolderPaths(input.folderPaths),
    ...(input.iconPath !== undefined ? { iconPath: normalizeIconPath(input.iconPath) ?? null } : {}),
    ...(input.lastOpenedAt?.trim() ? { lastOpenedAt: input.lastOpenedAt.trim() } : {}),
  };

  writeProject(project);
  return project;
}

export function updateProject(
  projectId: string,
  updates: Partial<Pick<Project, 'name' | 'folderPaths' | 'iconPath' | 'lastOpenedAt'>>,
): Project {
  const current = getProjectById(projectId);
  if (!current) {
    throw new Error('Project not found');
  }

  const updatedProject: Project = {
    ...current,
    ...(updates.name !== undefined ? { name: normalizeProjectName(updates.name) } : {}),
    ...(updates.folderPaths !== undefined ? { folderPaths: normalizeFolderPaths(updates.folderPaths) } : {}),
    ...(updates.iconPath !== undefined ? { iconPath: normalizeIconPath(updates.iconPath) ?? null } : {}),
    ...(updates.lastOpenedAt !== undefined ? { lastOpenedAt: updates.lastOpenedAt?.trim() || undefined } : {}),
  };

  writeProject(updatedProject);
  return updatedProject;
}

export function removeProject(projectId: string): void {
  const db = getLocalDb();
  const normalizedProjectId = projectId.trim();
  if (!normalizedProjectId) {
    throw new Error('Project id is required');
  }

  const transaction = db.transaction(() => {
    db.prepare(`DELETE FROM project_entity_folders WHERE project_id = ?`).run(normalizedProjectId);
    db.prepare(`DELETE FROM project_entities WHERE id = ?`).run(normalizedProjectId);
  });
  transaction();
}

export function getRepository(repoPath: string): Repository | null {
  const db = getLocalDb();
  const normalizedPath = normalizeFolderPath(repoPath);
  const row = db.prepare(`
    SELECT
      path, name, display_name, expanded_folders_json, visibility_map_json,
      local_group_expanded, remotes_group_expanded, worktrees_group_expanded
    FROM repositories
    WHERE path = ?
  `).get(normalizedPath) as RepositoryRow | undefined;

  if (!row) {
    return null;
  }

  return rowToRepository(row);
}

export function getRepositories(): Repository[] {
  const db = getLocalDb();
  const rows = db.prepare(`
    SELECT
      path, name, display_name, expanded_folders_json, visibility_map_json,
      local_group_expanded, remotes_group_expanded, worktrees_group_expanded
    FROM repositories
    ORDER BY path ASC
  `).all() as RepositoryRow[];
  return rows.map(rowToRepository);
}

export function updateRepository(repoPath: string, updates: Partial<Repository>): Repository {
  const normalizedPath = normalizeFolderPath(repoPath);
  ensureRepositoryRow(normalizedPath);

  const current = getRepository(normalizedPath) ?? {
    path: normalizedPath,
    name: path.basename(normalizedPath),
  };

  const nextRepository: Repository = {
    ...current,
    ...updates,
    path: normalizedPath,
    name: updates.name?.trim() || current.name || path.basename(normalizedPath),
  };

  const db = getLocalDb();
  db.prepare(`
    INSERT OR REPLACE INTO repositories (
      path, name, display_name, last_opened_at, credential_id,
      expanded_folders_json, visibility_map_json, local_group_expanded,
      remotes_group_expanded, worktrees_group_expanded
    ) VALUES (
      @path, @name, NULL, NULL, NULL,
      @expandedFoldersJson, @visibilityMapJson, @localGroupExpanded,
      @remotesGroupExpanded, @worktreesGroupExpanded
    )
  `).run({
    path: normalizedPath,
    name: nextRepository.name,
    expandedFoldersJson: nextRepository.expandedFolders ? JSON.stringify(nextRepository.expandedFolders) : null,
    visibilityMapJson: nextRepository.visibilityMap ? JSON.stringify(nextRepository.visibilityMap) : null,
    localGroupExpanded: nextRepository.localGroupExpanded === undefined ? null : Number(nextRepository.localGroupExpanded),
    remotesGroupExpanded: nextRepository.remotesGroupExpanded === undefined ? null : Number(nextRepository.remotesGroupExpanded),
    worktreesGroupExpanded: nextRepository.worktreesGroupExpanded === undefined ? null : Number(nextRepository.worktreesGroupExpanded),
  });

  return getRepository(normalizedPath) ?? nextRepository;
}

export function removeRepository(repoPath: string): void {
  const db = getLocalDb();
  db.prepare(`DELETE FROM repositories WHERE path = ?`).run(normalizeFolderPath(repoPath));
}

export function getSettings(): AppSettings {
  const defaults: AppSettings = {
    defaultRootFolder: null,
    sidebarCollapsed: false,
  };

  const db = getLocalDb();
  const row = db.prepare(`
    SELECT default_root_folder, sidebar_collapsed, history_panel_height
    FROM app_settings
    WHERE singleton_id = 1
  `).get() as AppSettingsRow | undefined;

  if (!row) {
    return defaults;
  }

  return {
    ...defaults,
    defaultRootFolder: row.default_root_folder,
    sidebarCollapsed: row.sidebar_collapsed === null ? defaults.sidebarCollapsed : Boolean(row.sidebar_collapsed),
    historyPanelHeight: row.history_panel_height ?? undefined,
  };
}

export function updateSettings(updates: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  const updated = { ...current, ...updates };
  const db = getLocalDb();

  db.prepare(`
    INSERT OR REPLACE INTO app_settings (
      singleton_id, default_root_folder, sidebar_collapsed, history_panel_height
    ) VALUES (1, @defaultRootFolder, @sidebarCollapsed, @historyPanelHeight)
  `).run({
    defaultRootFolder: updated.defaultRootFolder,
    sidebarCollapsed: updated.sidebarCollapsed === undefined ? null : Number(updated.sidebarCollapsed),
    historyPanelHeight: updated.historyPanelHeight ?? null,
  });

  return updated;
}

export function getDefaultRootFolder(): string {
  const settings = getSettings();

  if (settings.defaultRootFolder) {
    try {
      const resolvedDefaultRoot = path.resolve(settings.defaultRootFolder);
      return resolvedDefaultRoot;
    } catch {
      // Fall back to home directory if path is malformed.
    }
  }

  return os.homedir();
}
