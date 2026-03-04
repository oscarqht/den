import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Repository, AppSettings } from './types';
import { getLocalDb } from './local-db';

type RepositoryRow = {
  path: string;
  name: string;
  display_name: string | null;
  last_opened_at: string | null;
  credential_id: string | null;
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

function normalizeDisplayName(displayName?: string | null): string | null | undefined {
  if (displayName === undefined) return undefined;
  if (displayName === null) return null;
  const normalized = displayName.trim();
  return normalized.length > 0 ? normalized : null;
}

function rowToRepository(row: RepositoryRow): Repository {
  const repo: Repository = {
    path: row.path,
    name: row.name,
  };

  if (row.display_name !== null) repo.displayName = row.display_name;
  if (row.last_opened_at !== null) repo.lastOpenedAt = row.last_opened_at;
  if (row.credential_id !== null) repo.credentialId = row.credential_id;

  const expandedFolders = parseJsonValue<Repository['expandedFolders']>(row.expanded_folders_json);
  if (expandedFolders) repo.expandedFolders = expandedFolders;
  const visibilityMap = parseJsonValue<Repository['visibilityMap']>(row.visibility_map_json);
  if (visibilityMap) repo.visibilityMap = visibilityMap;

  if (row.local_group_expanded !== null) repo.localGroupExpanded = Boolean(row.local_group_expanded);
  if (row.remotes_group_expanded !== null) repo.remotesGroupExpanded = Boolean(row.remotes_group_expanded);
  if (row.worktrees_group_expanded !== null) repo.worktreesGroupExpanded = Boolean(row.worktrees_group_expanded);
  return repo;
}

function writeRepository(repo: Repository): void {
  const db = getLocalDb();
  db.prepare(`
    INSERT OR REPLACE INTO repositories (
      path, name, display_name, last_opened_at, credential_id,
      expanded_folders_json, visibility_map_json, local_group_expanded,
      remotes_group_expanded, worktrees_group_expanded
    ) VALUES (
      @path, @name, @displayName, @lastOpenedAt, @credentialId,
      @expandedFoldersJson, @visibilityMapJson, @localGroupExpanded,
      @remotesGroupExpanded, @worktreesGroupExpanded
    )
  `).run({
    path: repo.path,
    name: repo.name,
    displayName: repo.displayName ?? null,
    lastOpenedAt: repo.lastOpenedAt ?? null,
    credentialId: repo.credentialId ?? null,
    expandedFoldersJson: repo.expandedFolders ? JSON.stringify(repo.expandedFolders) : null,
    visibilityMapJson: repo.visibilityMap ? JSON.stringify(repo.visibilityMap) : null,
    localGroupExpanded: repo.localGroupExpanded === undefined ? null : Number(repo.localGroupExpanded),
    remotesGroupExpanded: repo.remotesGroupExpanded === undefined ? null : Number(repo.remotesGroupExpanded),
    worktreesGroupExpanded: repo.worktreesGroupExpanded === undefined ? null : Number(repo.worktreesGroupExpanded),
  });
}

export function getRepositories(): Repository[] {
  const db = getLocalDb();
  const rows = db.prepare(`
    SELECT
      path, name, display_name, last_opened_at, credential_id,
      expanded_folders_json, visibility_map_json, local_group_expanded,
      remotes_group_expanded, worktrees_group_expanded
    FROM repositories
    ORDER BY rowid ASC
  `).all() as RepositoryRow[];

  return rows.map(rowToRepository);
}

export function addRepository(repoPath: string, name?: string, displayName?: string | null): Repository {
  const db = getLocalDb();
  const existing = db.prepare(`
    SELECT path FROM repositories WHERE path = ?
  `).get(repoPath) as { path: string } | undefined;

  if (existing) {
    throw new Error('Repository already exists');
  }

  const normalizedDisplayName = normalizeDisplayName(displayName);
  const newRepo: Repository = {
    path: repoPath,
    name: name || path.basename(repoPath),
    ...(normalizedDisplayName ? { displayName: normalizedDisplayName } : {}),
  };

  writeRepository(newRepo);
  return newRepo;
}

export function updateRepository(repoPath: string, updates: Partial<Repository>): Repository {
  const db = getLocalDb();
  const row = db.prepare(`
    SELECT
      path, name, display_name, last_opened_at, credential_id,
      expanded_folders_json, visibility_map_json, local_group_expanded,
      remotes_group_expanded, worktrees_group_expanded
    FROM repositories
    WHERE path = ?
  `).get(repoPath) as RepositoryRow | undefined;

  if (!row) {
    throw new Error('Repository not found');
  }

  const current = rowToRepository(row);
  const normalizedUpdates: Partial<Repository> = { ...updates };
  if ('displayName' in normalizedUpdates) {
    normalizedUpdates.displayName = normalizeDisplayName(normalizedUpdates.displayName);
  }

  const updatedRepo = { ...current, ...normalizedUpdates };
  writeRepository(updatedRepo);
  return updatedRepo;
}

export function removeRepository(repoPath: string, options?: { deleteLocalFolder?: boolean }): void {
  const { deleteLocalFolder = false } = options || {};

  if (deleteLocalFolder) {
    const resolvedRepoPath = path.resolve(repoPath);
    const rootPath = path.parse(resolvedRepoPath).root;
    if (resolvedRepoPath === rootPath) {
      throw new Error('Refusing to delete a filesystem root path');
    }
    fs.rmSync(resolvedRepoPath, { recursive: true, force: true });
  }

  const db = getLocalDb();
  db.prepare(`
    DELETE FROM repositories WHERE path = ?
  `).run(repoPath);
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
      if (fs.existsSync(settings.defaultRootFolder) && fs.statSync(settings.defaultRootFolder).isDirectory()) {
        return settings.defaultRootFolder;
      }
    } catch {
      // Fall back to home directory if path is inaccessible.
    }
  }

  return os.homedir();
}
