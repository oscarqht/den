import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppSettings, Project, Repository } from './types.ts';
import {
  readLocalState,
  updateLocalState,
  type LocalProjectRecord,
  type LocalRepositoryRecord,
} from './local-db.ts';
import { pickPreferredProject } from './project-preference.ts';

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

function normalizeIconEmoji(iconEmoji?: string | null): string | null | undefined {
  if (iconEmoji === undefined) return undefined;
  if (iconEmoji === null) return null;
  const normalized = iconEmoji.trim();
  return normalized.length > 0 ? normalized : null;
}

function toProject(record: LocalProjectRecord): Project {
  const project: Project = {
    id: record.id,
    name: record.name,
    folderPaths: [...record.folderPaths],
  };

  if (record.iconPath !== undefined) {
    project.iconPath = record.iconPath ?? null;
  }
  if (record.iconEmoji !== undefined) {
    project.iconEmoji = record.iconEmoji ?? null;
  }
  if (record.lastOpenedAt !== undefined && record.lastOpenedAt !== null) {
    project.lastOpenedAt = record.lastOpenedAt;
  }
  return project;
}

function toRepository(record: LocalRepositoryRecord): Repository {
  const repository: Repository = {
    path: record.path,
    name: record.displayName?.trim() || record.name || path.basename(record.path),
  };

  if (record.expandedFolders) repository.expandedFolders = [...record.expandedFolders];
  if (record.visibilityMap) repository.visibilityMap = { ...record.visibilityMap };
  if (record.localGroupExpanded !== undefined && record.localGroupExpanded !== null) {
    repository.localGroupExpanded = record.localGroupExpanded;
  }
  if (record.remotesGroupExpanded !== undefined && record.remotesGroupExpanded !== null) {
    repository.remotesGroupExpanded = record.remotesGroupExpanded;
  }
  if (record.worktreesGroupExpanded !== undefined && record.worktreesGroupExpanded !== null) {
    repository.worktreesGroupExpanded = record.worktreesGroupExpanded;
  }
  return repository;
}

function ensureRepositoryRecord(repoPath: string): void {
  const normalizedPath = normalizeFolderPath(repoPath);
  updateLocalState((state) => {
    if (state.repositories[normalizedPath]) {
      return;
    }

    state.repositories[normalizedPath] = {
      path: normalizedPath,
      name: path.basename(normalizedPath),
    };
  });
}

export function getProjects(): Project[] {
  const state = readLocalState();
  return Object.values(state.projects)
    .sort((left, right) => (left.lastOpenedAt ?? '').localeCompare(right.lastOpenedAt ?? '') || left.id.localeCompare(right.id))
    .map(toProject);
}

export function getProjectById(projectId: string): Project | null {
  const normalizedProjectId = projectId.trim();
  if (!normalizedProjectId) return null;
  const record = readLocalState().projects[normalizedProjectId];
  return record ? toProject(record) : null;
}

export function findProjectByFolderPath(folderPath: string): Project | null {
  const normalizedFolderPath = normalizeFolderPath(folderPath);
  return pickPreferredProject(getProjects().filter((project) => project.folderPaths.includes(normalizedFolderPath)));
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

function writeProject(project: Project): void {
  const normalizedProject: Project = {
    id: project.id.trim(),
    name: normalizeProjectName(project.name),
    folderPaths: normalizeFolderPaths(project.folderPaths),
    iconPath: normalizeIconPath(project.iconPath),
    iconEmoji: normalizeIconEmoji(project.iconEmoji),
    lastOpenedAt: project.lastOpenedAt?.trim() || undefined,
  };

  if (!normalizedProject.id) {
    throw new Error('Project id is required');
  }

  updateLocalState((state) => {
    state.projects[normalizedProject.id] = {
      id: normalizedProject.id,
      name: normalizedProject.name,
      folderPaths: [...normalizedProject.folderPaths],
      iconPath: normalizedProject.iconPath ?? undefined,
      iconEmoji: normalizedProject.iconEmoji ?? undefined,
      lastOpenedAt: normalizedProject.lastOpenedAt ?? undefined,
    };
  });
}

export function addProject(input: {
  name: string;
  folderPaths?: string[];
  iconPath?: string | null;
  iconEmoji?: string | null;
  lastOpenedAt?: string;
}): Project {
  const project: Project = {
    id: randomUUID(),
    name: normalizeProjectName(input.name),
    folderPaths: normalizeFolderPaths(input.folderPaths),
    ...(input.iconPath !== undefined ? { iconPath: normalizeIconPath(input.iconPath) ?? null } : {}),
    ...(input.iconEmoji !== undefined ? { iconEmoji: normalizeIconEmoji(input.iconEmoji) ?? null } : {}),
    ...(input.lastOpenedAt?.trim() ? { lastOpenedAt: input.lastOpenedAt.trim() } : {}),
  };

  writeProject(project);
  return project;
}

export function updateProject(
  projectId: string,
  updates: Partial<Pick<Project, 'name' | 'folderPaths' | 'iconPath' | 'iconEmoji' | 'lastOpenedAt'>>,
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
    ...(updates.iconEmoji !== undefined ? { iconEmoji: normalizeIconEmoji(updates.iconEmoji) ?? null } : {}),
    ...(updates.lastOpenedAt !== undefined ? { lastOpenedAt: updates.lastOpenedAt?.trim() || undefined } : {}),
  };

  writeProject(updatedProject);
  return updatedProject;
}

export function removeProject(projectId: string): void {
  const normalizedProjectId = projectId.trim();
  if (!normalizedProjectId) {
    throw new Error('Project id is required');
  }

  updateLocalState((state) => {
    delete state.projects[normalizedProjectId];
  });
}

export function getRepository(repoPath: string): Repository | null {
  const normalizedPath = normalizeFolderPath(repoPath);
  const record = readLocalState().repositories[normalizedPath];
  return record ? toRepository(record) : null;
}

export function getRepositories(): Repository[] {
  const state = readLocalState();
  return Object.values(state.repositories)
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(toRepository);
}

export function updateRepository(repoPath: string, updates: Partial<Repository>): Repository {
  const normalizedPath = normalizeFolderPath(repoPath);
  ensureRepositoryRecord(normalizedPath);

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

  updateLocalState((state) => {
    state.repositories[normalizedPath] = {
      path: normalizedPath,
      name: nextRepository.name,
      displayName: null,
      expandedFolders: nextRepository.expandedFolders ? [...nextRepository.expandedFolders] : undefined,
      visibilityMap: nextRepository.visibilityMap ? { ...nextRepository.visibilityMap } : undefined,
      localGroupExpanded: nextRepository.localGroupExpanded ?? undefined,
      remotesGroupExpanded: nextRepository.remotesGroupExpanded ?? undefined,
      worktreesGroupExpanded: nextRepository.worktreesGroupExpanded ?? undefined,
    };
  });

  return getRepository(normalizedPath) ?? nextRepository;
}

export function removeRepository(repoPath: string): void {
  const normalizedPath = normalizeFolderPath(repoPath);
  updateLocalState((state) => {
    delete state.repositories[normalizedPath];
  });
}

export function getSettings(): AppSettings {
  const defaults: AppSettings = {
    defaultRootFolder: null,
    sidebarCollapsed: false,
  };

  const settings = readLocalState().appSettings;
  return {
    ...defaults,
    defaultRootFolder: settings.defaultRootFolder ?? defaults.defaultRootFolder,
    sidebarCollapsed: settings.sidebarCollapsed ?? defaults.sidebarCollapsed,
    historyPanelHeight: settings.historyPanelHeight ?? undefined,
  };
}

export function updateSettings(updates: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  const updated = { ...current, ...updates };

  updateLocalState((state) => {
    state.appSettings = {
      defaultRootFolder: updated.defaultRootFolder,
      sidebarCollapsed: updated.sidebarCollapsed,
      historyPanelHeight: updated.historyPanelHeight ?? null,
    };
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
