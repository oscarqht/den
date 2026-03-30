'use server';

import { getLocalDb } from '../../lib/local-db.ts';
import { findProjectByFolderPath, getProjectById, getProjects } from '../../lib/store.ts';
import { getProjectPrimaryFolderPath } from '../../lib/project-folders.ts';
import {
  normalizeNullableProviderReasoningEffort,
  normalizeProviderReasoningEffort,
} from '../../lib/agent/reasoning.ts';
import {
  DEFAULT_HOME_PROJECT_SORT,
  normalizeHomeProjectSort,
  type HomeProjectSort,
} from '../../lib/home-project-sort.ts';
import type { AgentProvider, ReasoningEffort } from '../../lib/types.ts';

export interface ProjectSettings {
  agentProvider?: AgentProvider;
  agentModel?: string;
  agentReasoningEffort?: ReasoningEffort;
  startupScript?: string;
  devServerScript?: string;
  serviceStartCommand?: string;
  serviceStopCommand?: string;
  alias?: string | null;
  // Deprecated compatibility fields.
  lastBranch?: string;
  credentialId?: string | null;
  credentialPreference?: 'auto' | 'github' | 'gitlab';
}

export interface Config {
  recentProjects: string[];
  // Backward compatibility for callers that have not migrated yet.
  recentRepos: string[];
  homeProjectSort: HomeProjectSort;
  defaultRoot: string;
  selectedIde: string;
  agentWidth: number;
  defaultAgentProvider?: AgentProvider;
  defaultAgentModel?: string;
  defaultAgentReasoningEffort?: ReasoningEffort;
  projectSettings: Record<string, ProjectSettings>;
  // Backward compatibility for callers that have not migrated yet.
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

type ConfigRow = {
  home_project_sort: string | null;
  default_root: string;
  selected_ide: string;
  agent_width: number;
  default_agent_provider: string | null;
  default_agent_model: string | null;
  default_agent_reasoning_effort: string | null;
};

type ProjectSettingsRow = {
  project_id: string;
  agent_provider: string | null;
  agent_model: string | null;
  agent_reasoning_effort: string | null;
  startup_script: string | null;
  dev_server_script: string | null;
  service_start_command: string | null;
  service_stop_command: string | null;
  alias: string | null;
};

function toProjectSettings(row: ProjectSettingsRow): ProjectSettings {
  const settings: ProjectSettings = {};
  if (row.agent_provider !== null) settings.agentProvider = row.agent_provider as AgentProvider;
  if (row.agent_model !== null) settings.agentModel = row.agent_model;
  const normalizedReasoning = normalizeProviderReasoningEffort(
    row.agent_provider,
    row.agent_reasoning_effort,
  );
  if (normalizedReasoning) settings.agentReasoningEffort = normalizedReasoning;
  if (row.startup_script !== null) settings.startupScript = row.startup_script;
  if (row.dev_server_script !== null) settings.devServerScript = row.dev_server_script;
  if (row.service_start_command !== null) settings.serviceStartCommand = row.service_start_command;
  if (row.service_stop_command !== null) settings.serviceStopCommand = row.service_stop_command;
  if (row.alias !== null) settings.alias = row.alias;
  return settings;
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

function resolveProjectId(projectIdOrPath: string): string | null {
  const trimmedValue = projectIdOrPath.trim();
  if (!trimmedValue) return null;

  const projectById = getProjectById(trimmedValue);
  if (projectById) {
    return projectById.id;
  }

  return findProjectByFolderPath(trimmedValue)?.id ?? null;
}

function getProjectCompatibilityKeys(projectId: string): string[] {
  const project = getProjectById(projectId);
  if (!project) return [projectId];

  return Array.from(new Set([
    project.id,
    ...project.folderPaths,
    getProjectPrimaryFolderPath(project) ?? '',
  ].filter(Boolean)));
}

function writeConfig(config: Config): void {
  const db = getLocalDb();
  const tx = db.transaction((nextConfig: Config) => {
    const normalizedConfig = normalizeConfig(nextConfig);
    db.prepare(`
      INSERT OR REPLACE INTO app_config (
        singleton_id, default_root, selected_ide, agent_width,
        default_agent_provider, default_agent_model, default_agent_reasoning_effort,
        home_project_sort
      ) VALUES (
        1, @defaultRoot, @selectedIde, @agentWidth,
        @defaultAgentProvider, @defaultAgentModel, @defaultAgentReasoningEffort,
        @homeProjectSort
      )
    `).run({
      defaultRoot: normalizedConfig.defaultRoot,
      selectedIde: normalizedConfig.selectedIde,
      agentWidth: normalizedConfig.agentWidth,
      defaultAgentProvider: normalizedConfig.defaultAgentProvider ?? null,
      defaultAgentModel: normalizedConfig.defaultAgentModel ?? null,
      defaultAgentReasoningEffort: normalizeNullableProviderReasoningEffort(
        normalizedConfig.defaultAgentProvider,
        normalizedConfig.defaultAgentReasoningEffort,
      ),
      homeProjectSort: normalizeHomeProjectSort(normalizedConfig.homeProjectSort),
    });

    db.prepare('DELETE FROM app_config_recent_project_entities').run();
    const insertRecentProject = db.prepare(`
      INSERT INTO app_config_recent_project_entities (position, project_id) VALUES (?, ?)
    `);
    const recentProjectIds = Array.from(new Set(
      normalizedConfig.recentProjects
        .map((projectEntry) => resolveProjectId(projectEntry))
        .filter((projectId): projectId is string => Boolean(projectId)),
    ));
    recentProjectIds.forEach((projectId, index) => {
      insertRecentProject.run(index, projectId);
    });

    db.prepare('DELETE FROM app_config_pinned_folder_shortcuts').run();
    const insertPinnedShortcut = db.prepare(`
      INSERT INTO app_config_pinned_folder_shortcuts (position, folder_path) VALUES (?, ?)
    `);
    normalizedConfig.pinnedFolderShortcuts.forEach((folderPath, index) => {
      insertPinnedShortcut.run(index, folderPath);
    });

    db.prepare('DELETE FROM app_config_project_entity_settings').run();
    const insertProjectSettings = db.prepare(`
      INSERT INTO app_config_project_entity_settings (
        project_id, agent_provider, agent_model, agent_reasoning_effort,
        startup_script, dev_server_script, service_start_command, service_stop_command, alias
      ) VALUES (
        @projectId, @agentProvider, @agentModel, @agentReasoningEffort,
        @startupScript, @devServerScript, @serviceStartCommand, @serviceStopCommand, @alias
      )
    `);
    const normalizedProjectSettingsEntries = new Map<string, ProjectSettings>();
    for (const [projectIdOrPath, projectSettings] of Object.entries(normalizedConfig.projectSettings)) {
      const projectId = resolveProjectId(projectIdOrPath);
      if (!projectId) continue;
      normalizedProjectSettingsEntries.set(projectId, projectSettings);
    }

    for (const [projectId, projectSettings] of normalizedProjectSettingsEntries.entries()) {
      const normalizedProjectSettings = normalizeProjectSettings(projectSettings);
      insertProjectSettings.run({
        projectId,
        agentProvider: normalizedProjectSettings.agentProvider ?? null,
        agentModel: normalizedProjectSettings.agentModel ?? null,
        agentReasoningEffort: normalizeNullableProviderReasoningEffort(
          normalizedProjectSettings.agentProvider,
          normalizedProjectSettings.agentReasoningEffort,
        ),
        startupScript: normalizedProjectSettings.startupScript ?? null,
        devServerScript: normalizedProjectSettings.devServerScript ?? null,
        serviceStartCommand: normalizedProjectSettings.serviceStartCommand ?? null,
        serviceStopCommand: normalizedProjectSettings.serviceStopCommand ?? null,
        alias: normalizedProjectSettings.alias ?? null,
      });
    }
  });

  tx(config);
}

export async function getConfig(): Promise<Config> {
  const db = getLocalDb();
  const configRow = db.prepare(`
    SELECT
      default_root, selected_ide, agent_width,
      default_agent_provider, default_agent_model, default_agent_reasoning_effort,
      home_project_sort
    FROM app_config
    WHERE singleton_id = 1
  `).get() as ConfigRow | undefined;

  const recentProjects = db.prepare(`
    SELECT project_id
    FROM app_config_recent_project_entities
    ORDER BY position ASC
  `).all() as Array<{ project_id: string }>;

  const pinnedFolderShortcuts = db.prepare(`
    SELECT folder_path
    FROM app_config_pinned_folder_shortcuts
    ORDER BY position ASC
  `).all() as Array<{ folder_path: string }>;

  const projectSettingsRows = db.prepare(`
    SELECT
      project_id, agent_provider, agent_model, agent_reasoning_effort,
      startup_script, dev_server_script, service_start_command, service_stop_command, alias
    FROM app_config_project_entity_settings
  `).all() as ProjectSettingsRow[];

  const projectSettings = Object.fromEntries(
    projectSettingsRows.flatMap((row) => {
      const projectId = row.project_id.trim();
      if (!projectId) return [];

      const projectSettings = toProjectSettings(row);
      return getProjectCompatibilityKeys(projectId).map((key) => [key, projectSettings] as const);
    }),
  );

  const recentProjectIds = recentProjects
    .map((entry) => entry.project_id)
    .filter((projectId) => projectId.trim().length > 0);
  const recentProjectPaths = recentProjectIds
    .map((projectId) => getProjectPrimaryFolderPath(getProjectById(projectId) ?? { folderPaths: [] }) || projectId)
    .filter((projectPath) => projectPath.trim().length > 0);

  return {
    ...DEFAULT_CONFIG,
    homeProjectSort: normalizeHomeProjectSort(configRow?.home_project_sort),
    defaultRoot: configRow?.default_root ?? DEFAULT_CONFIG.defaultRoot,
    selectedIde: configRow?.selected_ide ?? DEFAULT_CONFIG.selectedIde,
    agentWidth: configRow?.agent_width ?? DEFAULT_CONFIG.agentWidth,
    defaultAgentProvider: configRow?.default_agent_provider
      ? configRow.default_agent_provider as AgentProvider
      : undefined,
    defaultAgentModel: configRow?.default_agent_model ?? undefined,
    defaultAgentReasoningEffort: normalizeProviderReasoningEffort(
      configRow?.default_agent_provider,
      configRow?.default_agent_reasoning_effort,
    ),
    recentProjects: recentProjectIds,
    recentRepos: recentProjectPaths,
    pinnedFolderShortcuts: pinnedFolderShortcuts.map((entry) => entry.folder_path),
    projectSettings,
    repoSettings: projectSettings,
  };
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
  const currentConfig = await getConfig();
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
  const resolvedProjectId = resolveProjectId(projectId);
  const project = resolvedProjectId ? getProjectById(resolvedProjectId) : null;
  if (!project) return null;

  const config = await getConfig();
  const alias = config.projectSettings[resolvedProjectId!]?.alias?.trim()
    || config.projectSettings[getProjectPrimaryFolderPath(project) || '']?.alias?.trim();
  return alias || project.name;
}

export async function updateProjectSettings(projectId: string, updates: Partial<ProjectSettings>): Promise<Config> {
  const resolvedProjectId = resolveProjectId(projectId);
  if (!resolvedProjectId) {
    throw new Error('Project not found.');
  }
  const currentConfig = await getConfig();
  const currentProjectSettings = currentConfig.projectSettings[resolvedProjectId] || currentConfig.projectSettings[projectId] || {};
  const nextProjectSettings = mergeProjectSettings(currentProjectSettings, updates);
  const compatibilityKeys = getProjectCompatibilityKeys(resolvedProjectId);
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
  const db = getLocalDb();
  const row = db.prepare(`
    SELECT credential_id
    FROM git_repo_credentials
    WHERE repo_path = ?
  `).get(repoPath) as { credential_id: string | null } | undefined;

  return row?.credential_id ?? null;
}

export async function setGitRepoCredential(repoPath: string, credentialId: string | null): Promise<void> {
  const db = getLocalDb();
  const normalizedCredentialId = credentialId?.trim() || null;

  if (!normalizedCredentialId) {
    db.prepare('DELETE FROM git_repo_credentials WHERE repo_path = ?').run(repoPath);
    return;
  }

  db.prepare(`
    INSERT OR REPLACE INTO git_repo_credentials (repo_path, credential_id)
    VALUES (?, ?)
  `).run(repoPath, normalizedCredentialId);
}
