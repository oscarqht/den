'use server';

import {
  readLocalState,
  updateLocalState,
  type LocalProjectSettingsRecord,
} from '../../lib/local-db.ts';
import { getProjectsFromState } from '../../lib/store.ts';
import { getProjectPrimaryFolderPath, normalizeProjectFolderPath } from '../../lib/project-folders.ts';
import {
  normalizeNullableProviderReasoningEffort,
  normalizeProviderReasoningEffort,
} from '../../lib/agent/reasoning.ts';
import { getConfigFromLocalState } from '../../lib/config-state.ts';
import {
  DEFAULT_HOME_PROJECT_SORT,
  normalizeHomeProjectSort,
  type HomeProjectSort,
} from '../../lib/home-project-sort.ts';
import type { AgentProvider, Project, ReasoningEffort } from '../../lib/types.ts';

export interface ProjectSettings {
  agentProvider?: AgentProvider;
  agentModel?: string;
  agentReasoningEffort?: ReasoningEffort;
  startupScript?: string;
  devServerScript?: string;
  serviceStartCommand?: string;
  serviceStopCommand?: string;
  alias?: string | null;
  lastBranch?: string;
  credentialId?: string | null;
  credentialPreference?: 'auto' | 'github' | 'gitlab';
}

export interface Config {
  recentProjects: string[];
  recentRepos: string[];
  homeProjectSort: HomeProjectSort;
  defaultRoot: string;
  selectedIde: string;
  agentWidth: number;
  defaultAgentProvider?: AgentProvider;
  defaultAgentModel?: string;
  defaultAgentReasoningEffort?: ReasoningEffort;
  projectSettings: Record<string, ProjectSettings>;
  repoSettings: Record<string, ProjectSettings>;
  pinnedFolderShortcuts: string[];
}

const DEFAULT_CONFIG: Config = {
  recentProjects: [],
  recentRepos: [],
  homeProjectSort: DEFAULT_HOME_PROJECT_SORT,
  defaultRoot: '',
  selectedIde: 'vscode',
  agentWidth: 66.666,
  projectSettings: {},
  repoSettings: {},
  pinnedFolderShortcuts: [],
};

function toLocalProjectSettings(settings: ProjectSettings): LocalProjectSettingsRecord {
  return {
    agentProvider: settings.agentProvider ?? null,
    agentModel: settings.agentModel ?? null,
    agentReasoningEffort: normalizeNullableProviderReasoningEffort(
      settings.agentProvider,
      settings.agentReasoningEffort,
    ),
    startupScript: settings.startupScript ?? null,
    devServerScript: settings.devServerScript ?? null,
    serviceStartCommand: settings.serviceStartCommand ?? null,
    serviceStopCommand: settings.serviceStopCommand ?? null,
    alias: settings.alias ?? null,
  };
}

function normalizeProjectSettings(settings: ProjectSettings): ProjectSettings {
  const normalizedProvider = settings.agentProvider;
  return {
    ...settings,
    agentReasoningEffort: normalizeProviderReasoningEffort(
      normalizedProvider,
      settings.agentReasoningEffort,
    ),
  };
}

function mergeProjectSettings(
  currentSettings: ProjectSettings,
  updates: Partial<ProjectSettings>,
): ProjectSettings {
  const mergedSettings: ProjectSettings = { ...currentSettings };
  const mutableMergedSettings = mergedSettings as Record<
    keyof ProjectSettings,
    ProjectSettings[keyof ProjectSettings] | undefined
  >;

  for (const [key, value] of Object.entries(updates) as Array<[
    keyof ProjectSettings,
    ProjectSettings[keyof ProjectSettings],
  ]>) {
    if (value === undefined) {
      delete mergedSettings[key];
      continue;
    }
    mutableMergedSettings[key] = value;
  }

  return normalizeProjectSettings(mergedSettings);
}

function normalizeConfig(config: Config): Config {
  const normalizedDefaultAgentProvider = config.defaultAgentProvider;
  return {
    ...config,
    homeProjectSort: normalizeHomeProjectSort(config.homeProjectSort),
    defaultAgentReasoningEffort: normalizeProviderReasoningEffort(
      normalizedDefaultAgentProvider,
      config.defaultAgentReasoningEffort,
    ),
  };
}

function getProjectByIdFromProjects(projects: Project[], projectId: string): Project | null {
  const trimmedProjectId = projectId.trim();
  if (!trimmedProjectId) return null;
  return projects.find((project) => project.id === trimmedProjectId) ?? null;
}

function findProjectByFolderPathInProjects(projects: Project[], folderPath: string): Project | null {
  const normalizedFolderPath = normalizeProjectFolderPath(folderPath);
  return projects.find((project) => project.folderPaths.includes(normalizedFolderPath)) ?? null;
}

function resolveProjectIdFromProjects(projects: Project[], projectIdOrPath: string): string | null {
  const trimmedValue = projectIdOrPath.trim();
  if (!trimmedValue) return null;

  const projectById = getProjectByIdFromProjects(projects, trimmedValue);
  if (projectById) {
    return projectById.id;
  }

  return findProjectByFolderPathInProjects(projects, trimmedValue)?.id ?? null;
}

function getProjectCompatibilityKeysFromProjects(projectsById: Map<string, Project>, projectId: string): string[] {
  const project = projectsById.get(projectId);
  if (!project) return [projectId];

  return Array.from(new Set([
    project.id,
    ...project.folderPaths,
    getProjectPrimaryFolderPath(project) ?? '',
  ].filter(Boolean)));
}

function writeConfig(config: Config): void {
  const normalizedConfig = normalizeConfig(config);

  updateLocalState((state) => {
    const projects = getProjectsFromState(state);
    const projectsById = new Map(projects.map((project) => [project.id, project]));
    const recentProjectIds = Array.from(new Set(
      normalizedConfig.recentProjects
        .map((projectEntry) => resolveProjectIdFromProjects(projects, projectEntry))
        .filter((projectId): projectId is string => Boolean(projectId)),
    ));

    const normalizedProjectSettingsEntries = new Map<string, ProjectSettings>();
    for (const [projectIdOrPath, projectSettings] of Object.entries(normalizedConfig.projectSettings)) {
      const projectId = resolveProjectIdFromProjects(projects, projectIdOrPath);
      if (!projectId) continue;
      normalizedProjectSettingsEntries.set(projectId, projectSettings);
    }

    state.appConfig = {
      recentProjects: recentProjectIds,
      homeProjectSort: normalizeHomeProjectSort(normalizedConfig.homeProjectSort),
      defaultRoot: normalizedConfig.defaultRoot,
      selectedIde: normalizedConfig.selectedIde,
      agentWidth: normalizedConfig.agentWidth,
      defaultAgentProvider: normalizedConfig.defaultAgentProvider ?? null,
      defaultAgentModel: normalizedConfig.defaultAgentModel ?? null,
      defaultAgentReasoningEffort: normalizeNullableProviderReasoningEffort(
        normalizedConfig.defaultAgentProvider,
        normalizedConfig.defaultAgentReasoningEffort,
      ),
      pinnedFolderShortcuts: [...normalizedConfig.pinnedFolderShortcuts],
      projectSettings: Object.fromEntries(
        Array.from(normalizedProjectSettingsEntries.entries()).map(([projectId, projectSettings]) => (
          [projectId, toLocalProjectSettings(normalizeProjectSettings(projectSettings))]
        )),
      ),
    };
  });
}

export async function getConfig(): Promise<Config> {
  return getConfigFromLocalState(readLocalState());
}

export async function saveConfig(config: Config): Promise<void> {
  try {
    writeConfig(config);
  } catch (error) {
    console.error('Failed to save config:', error);
    throw new Error('Failed to save configuration.');
  }
}

export async function updateConfig(updates: Partial<Config>): Promise<Config> {
  const currentConfig = getConfigFromLocalState(readLocalState());
  const normalizedUpdates = { ...updates };
  if (normalizedUpdates.recentRepos && !normalizedUpdates.recentProjects) {
    normalizedUpdates.recentProjects = normalizedUpdates.recentRepos;
  }
  if (normalizedUpdates.repoSettings && !normalizedUpdates.projectSettings) {
    normalizedUpdates.projectSettings = normalizedUpdates.repoSettings;
  }

  const newConfig = normalizeConfig({ ...currentConfig, ...normalizedUpdates });
  newConfig.repoSettings = newConfig.projectSettings;
  await saveConfig(newConfig);
  return getConfig();
}

export async function getProjectAlias(projectId: string): Promise<string | null> {
  const state = readLocalState();
  const projects = getProjectsFromState(state);
  const resolvedProjectId = resolveProjectIdFromProjects(projects, projectId);
  const project = resolvedProjectId ? getProjectByIdFromProjects(projects, resolvedProjectId) : null;
  if (!project) return null;

  const config = getConfigFromLocalState(state);
  const alias = config.projectSettings[resolvedProjectId!]?.alias?.trim()
    || config.projectSettings[getProjectPrimaryFolderPath(project) || '']?.alias?.trim();
  return alias || project.name;
}

export async function updateProjectSettings(projectId: string, updates: Partial<ProjectSettings>): Promise<Config> {
  const state = readLocalState();
  const projects = getProjectsFromState(state);
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const resolvedProjectId = resolveProjectIdFromProjects(projects, projectId);
  if (!resolvedProjectId) {
    throw new Error('Project not found.');
  }
  const currentConfig = getConfigFromLocalState(state);
  const currentProjectSettings = currentConfig.projectSettings[resolvedProjectId] || currentConfig.projectSettings[projectId] || {};
  const nextProjectSettings = mergeProjectSettings(currentProjectSettings, updates);
  const compatibilityKeys = getProjectCompatibilityKeysFromProjects(projectsById, resolvedProjectId);
  const nextProjectSettingsMap = {
    ...currentConfig.projectSettings,
  };
  for (const compatibilityKey of compatibilityKeys) {
    nextProjectSettingsMap[compatibilityKey] = nextProjectSettings;
  }

  const newConfig: Config = {
    ...currentConfig,
    projectSettings: nextProjectSettingsMap,
  };

  await saveConfig(newConfig);
  return getConfig();
}

export async function getGitRepoCredential(repoPath: string): Promise<string | null> {
  const credential = readLocalState().gitRepoCredentials[repoPath];
  return credential ?? null;
}

export async function setGitRepoCredential(repoPath: string, credentialId: string | null): Promise<void> {
  const normalizedCredentialId = credentialId?.trim() || null;
  updateLocalState((state) => {
    if (!normalizedCredentialId) {
      delete state.gitRepoCredentials[repoPath];
      return;
    }

    state.gitRepoCredentials[repoPath] = normalizedCredentialId;
  });
}
