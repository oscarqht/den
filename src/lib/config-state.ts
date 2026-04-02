import type { Config, ProjectSettings } from '../app/actions/config.ts';
import type { AgentProvider, Project } from './types.ts';
import type { LocalProjectSettingsRecord, LocalState } from './local-db.ts';
import { getProjectsFromState } from './store.ts';
import { getProjectPrimaryFolderPath } from './project-folders.ts';
import { normalizeProviderReasoningEffort } from './agent/reasoning.ts';
import { normalizeHomeProjectSort } from './home-project-sort.ts';

function toProjectSettings(record: LocalProjectSettingsRecord): ProjectSettings {
  const settings: ProjectSettings = {};
  if (record.agentProvider != null) settings.agentProvider = record.agentProvider as AgentProvider;
  if (record.agentModel != null) settings.agentModel = record.agentModel;
  const normalizedReasoning = normalizeProviderReasoningEffort(
    record.agentProvider,
    record.agentReasoningEffort,
  );
  if (normalizedReasoning) settings.agentReasoningEffort = normalizedReasoning;
  if (record.startupScript != null) settings.startupScript = record.startupScript;
  if (record.devServerScript != null) settings.devServerScript = record.devServerScript;
  if (record.serviceStartCommand != null) settings.serviceStartCommand = record.serviceStartCommand;
  if (record.serviceStopCommand != null) settings.serviceStopCommand = record.serviceStopCommand;
  if (record.alias != null) settings.alias = record.alias;
  return settings;
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

export function getConfigFromLocalState(state: LocalState): Config {
  const appConfig = state.appConfig;
  const projects = getProjectsFromState(state);
  const projectsById = new Map(projects.map((project) => [project.id, project]));

  const projectSettings = Object.fromEntries(
    Object.entries(appConfig.projectSettings).flatMap(([projectId, record]) => {
      const trimmedProjectId = projectId.trim();
      if (!trimmedProjectId) return [];
      const settings = toProjectSettings(record);
      return getProjectCompatibilityKeysFromProjects(projectsById, trimmedProjectId)
        .map((key) => [key, settings] as const);
    }),
  );

  const recentProjectPaths = appConfig.recentProjects
    .map((projectId) => getProjectPrimaryFolderPath(projectsById.get(projectId) ?? { folderPaths: [] }) || projectId)
    .filter((projectPath) => projectPath.trim().length > 0);

  return {
    recentProjects: [...appConfig.recentProjects],
    recentRepos: recentProjectPaths,
    homeProjectSort: normalizeHomeProjectSort(appConfig.homeProjectSort),
    defaultRoot: appConfig.defaultRoot ?? '',
    selectedIde: appConfig.selectedIde ?? 'vscode',
    agentWidth: appConfig.agentWidth ?? 66.666,
    defaultAgentProvider: appConfig.defaultAgentProvider
      ? appConfig.defaultAgentProvider as AgentProvider
      : undefined,
    defaultAgentModel: appConfig.defaultAgentModel ?? undefined,
    defaultAgentReasoningEffort: normalizeProviderReasoningEffort(
      appConfig.defaultAgentProvider,
      appConfig.defaultAgentReasoningEffort,
    ),
    projectSettings,
    repoSettings: projectSettings,
    pinnedFolderShortcuts: [...appConfig.pinnedFolderShortcuts],
  };
}
