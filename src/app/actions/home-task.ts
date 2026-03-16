'use server';

import os from 'node:os';

import { getConfig, updateConfig, type Config } from './config.ts';
import {
  buildProjectRecommendationPrompt,
  evaluateProjectRecommendation,
  parseProjectRecommendation,
  resolveRuntimeRecommendation,
  type HomeTaskProjectOption,
  type HomeTaskSuggestedProject,
} from '../../lib/home-task.ts';
import { getBaseName } from '../../lib/path.ts';
import { normalizeAttachmentPaths } from '../../lib/task-session.ts';
import { normalizeProviderReasoningEffort } from '../../lib/agent/reasoning.ts';

import type {
  AgentProvider,
  AppStatus,
  Project,
} from '../../lib/types.ts';

export type CreateHomeTaskInput = {
  description: string;
  attachmentPaths: string[];
  selectedProjectPath?: string;
};

export type CreateHomeTaskResult =
  | {
    status: 'created';
    sessionName: string;
    projectPath: string;
    title?: string;
  }
  | {
    status: 'needs_project_choice';
    suggestedProjects: HomeTaskSuggestedProject[];
  }
  | {
    status: 'error';
    error: string;
  };

type HomeTaskDependencies = {
  getConfig: () => Promise<Config>;
  updateConfig: (updates: Partial<Config>) => Promise<Config>;
  getProjects: () => Project[];
  getDefaultAgentProvider: () => AgentProvider;
  getAgentStatus: (provider: AgentProvider) => Promise<AppStatus>;
  runAdHocAgentText: (input: {
    provider: AgentProvider;
    workspacePath: string;
    message: string;
    model?: string | null;
    reasoningEffort?: import('../../lib/types.ts').ReasoningEffort | null;
    signal?: AbortSignal;
  }) => Promise<{
    threadId: string | null;
    assistantText: string;
  }>;
  createAndLaunchTaskSession: (input: {
    projectPath: string;
    taskDescription?: string;
    rawTaskDescription?: string;
    attachmentPaths?: string[];
    agentProvider: AgentProvider;
    model: string;
    reasoningEffort?: import('../../lib/types.ts').ReasoningEffort;
    sessionMode?: 'fast' | 'plan';
    workspacePreference?: import('../../lib/types.ts').SessionWorkspacePreference;
    title?: string;
    startupScript?: string;
    devServerScript?: string;
    preparedWorkspaceId?: string;
    gitContexts?: import('./session.ts').SessionCreateGitContextInput[];
    projectRepoPaths?: string[];
    projectRepoRelativePaths?: string[];
  }) => Promise<{
    success: boolean;
    sessionName?: string;
    title?: string;
    error?: string;
  }>;
  getRecommendationWorkspacePath: () => string;
};

function buildProjectOptions(config: Config, projects: Project[]): HomeTaskProjectOption[] {
  const recentRankByPath = new Map(
    (config.recentProjects || []).map((projectPath, index) => [projectPath, index + 1] as const),
  );

  return projects
    .map((project) => {
      const alias = config.projectSettings[project.path]?.alias?.trim();
      const displayLabel = alias
        || project.displayName?.trim()
        || project.name?.trim()
        || getBaseName(project.path)
        || project.path;

      return {
        projectPath: project.path,
        displayLabel,
        recentRank: recentRankByPath.get(project.path) ?? null,
      } satisfies HomeTaskProjectOption;
    })
    .sort((left, right) => {
      if (left.recentRank !== null && right.recentRank !== null) {
        if (left.recentRank !== right.recentRank) {
          return left.recentRank - right.recentRank;
        }
      } else if (left.recentRank !== null) {
        return -1;
      } else if (right.recentRank !== null) {
        return 1;
      }

      return left.displayLabel.localeCompare(right.displayLabel);
    });
}

function buildUpdatedRecentProjects(recentProjects: string[], projectPath: string): string[] {
  return [projectPath, ...recentProjects.filter((entry) => entry !== projectPath)];
}

function resolveDefaultRuntime(config: Config, status: AppStatus): {
  provider: AgentProvider;
  model: string;
} | null {
  const model = config.defaultAgentModel?.trim()
    || status.defaultModel
    || status.models[0]?.id
    || '';

  if (!model) {
    return null;
  }

  return {
    provider: status.provider,
    model,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePathForMatching(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function isPathInsideProject(pathValue: string, projectPath: string): boolean {
  const normalizedPath = normalizePathForMatching(pathValue);
  const normalizedProjectPath = normalizePathForMatching(projectPath);

  if (!normalizedPath || !normalizedProjectPath) {
    return false;
  }

  return normalizedPath === normalizedProjectPath
    || normalizedPath.startsWith(`${normalizedProjectPath}/`);
}

function hasStandaloneMatch(haystack: string, phrase: string): boolean {
  const normalizedPhrase = phrase.trim().toLowerCase();
  if (normalizedPhrase.length < 3) {
    return false;
  }

  if (/[^a-z0-9]/i.test(normalizedPhrase)) {
    return haystack.includes(normalizedPhrase);
  }

  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedPhrase)}([^a-z0-9]|$)`, 'i');
  return pattern.test(haystack);
}

function getProjectDetectionLabels(project: HomeTaskProjectOption): string[] {
  const labels = new Set<string>();
  const displayLabel = project.displayLabel.trim().toLowerCase();
  if (displayLabel.length >= 3) {
    labels.add(displayLabel);
  }

  const baseName = getBaseName(project.projectPath).trim().toLowerCase();
  if (baseName.length >= 3) {
    labels.add(baseName);
  }

  return Array.from(labels);
}

function resolveProjectByDeterministicSignals(input: {
  description: string;
  attachmentPaths: string[];
  projects: HomeTaskProjectOption[];
}): string | null {
  const projectsMatchedByAttachment = input.projects.filter((project) => (
    input.attachmentPaths.some((attachmentPath) => (
      isPathInsideProject(attachmentPath, project.projectPath)
    ))
  ));

  if (projectsMatchedByAttachment.length === 1) {
    return projectsMatchedByAttachment[0].projectPath;
  }

  const normalizedDescription = input.description.trim().toLowerCase();
  if (!normalizedDescription) {
    return null;
  }

  const projectPathsByLabel = new Map<string, Set<string>>();
  for (const project of input.projects) {
    for (const label of getProjectDetectionLabels(project)) {
      if (!projectPathsByLabel.has(label)) {
        projectPathsByLabel.set(label, new Set());
      }
      projectPathsByLabel.get(label)?.add(project.projectPath);
    }
  }

  const matchedProjectPaths = new Set<string>();
  for (const [label, projectPaths] of projectPathsByLabel.entries()) {
    if (projectPaths.size !== 1) {
      continue;
    }

    if (!hasStandaloneMatch(normalizedDescription, label)) {
      continue;
    }

    const [projectPath] = Array.from(projectPaths);
    if (projectPath) {
      matchedProjectPaths.add(projectPath);
    }
  }

  if (matchedProjectPaths.size !== 1) {
    return null;
  }

  const [matchedProjectPath] = Array.from(matchedProjectPaths);
  return matchedProjectPath ?? null;
}

function ensureProviderReady(status: AppStatus): string | null {
  if (!status.installed) {
    return `Install ${status.provider} before creating a home task.`;
  }
  if (!status.loggedIn) {
    return `Log in to ${status.provider} before creating a home task.`;
  }
  return null;
}

export async function createHomeTaskInternal(
  input: CreateHomeTaskInput,
  deps: HomeTaskDependencies,
): Promise<CreateHomeTaskResult> {
  const description = input.description.trim();
  if (!description) {
    return {
      status: 'error',
      error: 'Task description is required.',
    };
  }

  const attachmentPaths = normalizeAttachmentPaths(input.attachmentPaths || []);
  const config = await deps.getConfig();
  const projects = buildProjectOptions(config, deps.getProjects());

  if (projects.length === 0) {
    return {
      status: 'error',
      error: 'No registered projects are available.',
    };
  }

  let selectedProjectPath = input.selectedProjectPath?.trim() || '';
  let defaultStatus: AppStatus | null = null;
  if (!selectedProjectPath && projects.length > 1) {
    selectedProjectPath = resolveProjectByDeterministicSignals({
      description,
      attachmentPaths,
      projects,
    }) || '';
  }

  if (!selectedProjectPath && projects.length > 1) {
    const defaultProvider = config.defaultAgentProvider || deps.getDefaultAgentProvider();
    defaultStatus = await deps.getAgentStatus(defaultProvider);
    const providerReadinessError = ensureProviderReady(defaultStatus);
    if (providerReadinessError) {
      return {
        status: 'error',
        error: providerReadinessError,
      };
    }

    const defaultRuntime = resolveDefaultRuntime(config, defaultStatus);
    if (!defaultRuntime) {
      return {
        status: 'error',
        error: 'No default model is available for the background task analysis.',
      };
    }

    const projectRecommendationResponse = await deps.runAdHocAgentText({
      provider: defaultRuntime.provider,
      workspacePath: deps.getRecommendationWorkspacePath(),
      model: defaultRuntime.model,
      reasoningEffort: normalizeProviderReasoningEffort(
        defaultRuntime.provider,
        config.defaultAgentReasoningEffort,
      ),
      message: buildProjectRecommendationPrompt({
        description,
        attachmentPaths,
        projects,
      }),
    });
    const parsedProjectRecommendation = parseProjectRecommendation(
      projectRecommendationResponse.assistantText,
    );

    if (!parsedProjectRecommendation) {
      return {
        status: 'error',
        error: 'Task analysis did not return a valid project recommendation.',
      };
    }

    const evaluatedRecommendation = evaluateProjectRecommendation({
      recommendation: parsedProjectRecommendation,
      projects,
    });

    if (evaluatedRecommendation.needsUserChoice || !evaluatedRecommendation.selectedProjectPath) {
      return {
        status: 'needs_project_choice',
        suggestedProjects: evaluatedRecommendation.suggestedProjects,
      };
    }

    selectedProjectPath = evaluatedRecommendation.selectedProjectPath;
  }

  const selectedProject = projects.find((project) => project.projectPath === selectedProjectPath)
    || (projects.length === 1 && !selectedProjectPath ? projects[0] : null);
  if (!selectedProject) {
    return {
      status: 'error',
      error: 'Select a project before creating the task.',
    };
  }

  const projectSettings = config.projectSettings[selectedProject.projectPath] || {};
  const provider = projectSettings.agentProvider
    || config.defaultAgentProvider
    || deps.getDefaultAgentProvider();
  const providerStatus = defaultStatus && defaultStatus.provider === provider
    ? defaultStatus
    : await deps.getAgentStatus(provider);
  const providerReadinessError = ensureProviderReady(providerStatus);
  if (providerReadinessError) {
    return {
      status: 'error',
      error: providerReadinessError,
    };
  }

  const savedReasoningHint = normalizeProviderReasoningEffort(
    provider,
    projectSettings.agentReasoningEffort ?? config.defaultAgentReasoningEffort,
  );
  const resolvedRuntime = resolveRuntimeRecommendation({
    provider,
    modelOptions: providerStatus.models,
    defaultModel: providerStatus.defaultModel,
    savedModelHint: projectSettings.agentModel,
    savedReasoningHint,
    recommendation: null,
  });

  if (!resolvedRuntime.model) {
    return {
      status: 'error',
      error: `No usable ${provider} model is available for the selected project.`,
    };
  }

  const nextRecentProjects = buildUpdatedRecentProjects(
    config.recentProjects || [],
    selectedProject.projectPath,
  );
  if (nextRecentProjects.some((projectPath, index) => projectPath !== config.recentProjects[index])) {
    await deps.updateConfig({ recentProjects: nextRecentProjects });
  }

  const sessionResult = await deps.createAndLaunchTaskSession({
    projectPath: selectedProject.projectPath,
    taskDescription: description,
    rawTaskDescription: description,
    attachmentPaths,
    agentProvider: provider,
    model: resolvedRuntime.model,
    reasoningEffort: resolvedRuntime.reasoningEffort,
    sessionMode: 'plan',
    workspacePreference: 'workspace',
  });

  if (!sessionResult.success || !sessionResult.sessionName) {
    return {
      status: 'error',
      error: sessionResult.error || 'Failed to create the task session.',
    };
  }

  return {
    status: 'created',
    sessionName: sessionResult.sessionName,
    projectPath: selectedProject.projectPath,
    title: sessionResult.title,
  };
}

export async function createHomeTask(input: CreateHomeTaskInput): Promise<CreateHomeTaskResult> {
  try {
    const [
      { getProjects },
      { getDefaultAgentProvider, getAgentAdapter },
      adHocRunnerModule,
      taskSessionModule,
    ] = await Promise.all([
      import('../../lib/store.ts'),
      import('../../lib/agent/providers/index.ts'),
      import('../../lib/ad-hoc-agent-runner.ts'),
      import('./task-session.ts'),
    ]);

    return await createHomeTaskInternal(input, {
      getConfig,
      updateConfig,
      getProjects,
      getDefaultAgentProvider,
      getAgentStatus: async (provider) => await getAgentAdapter(provider).getStatus(),
      runAdHocAgentText: adHocRunnerModule.runAdHocAgentText,
      createAndLaunchTaskSession: taskSessionModule.createAndLaunchTaskSession,
      getRecommendationWorkspacePath: () => os.homedir(),
    });
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'Failed to create the home task.',
    };
  }
}
