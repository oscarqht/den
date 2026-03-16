'use server';

import os from 'node:os';

import { getConfig, updateConfig, type Config } from './config.ts';
import {
  buildProjectRecommendationPrompt,
  buildRuntimeRecommendationPrompt,
  evaluateProjectRecommendation,
  parseProjectRecommendation,
  parseRuntimeRecommendation,
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
    remoteResources?: import('../../lib/types.ts').ProjectRemoteResource[];
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
  if (!selectedProjectPath && projects.length > 1) {
    const defaultProvider = config.defaultAgentProvider || deps.getDefaultAgentProvider();
    const defaultStatus = await deps.getAgentStatus(defaultProvider);
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
  const providerStatus = await deps.getAgentStatus(provider);
  const providerReadinessError = ensureProviderReady(providerStatus);
  if (providerReadinessError) {
    return {
      status: 'error',
      error: providerReadinessError,
    };
  }

  const runtimeRecommendationResponse = await deps.runAdHocAgentText({
    provider,
    workspacePath: selectedProject.projectPath,
    model: projectSettings.agentModel?.trim()
      || providerStatus.defaultModel
      || providerStatus.models[0]?.id
      || null,
    reasoningEffort: normalizeProviderReasoningEffort(
      provider,
      projectSettings.agentReasoningEffort ?? config.defaultAgentReasoningEffort,
    ),
    message: buildRuntimeRecommendationPrompt({
      description,
      attachmentPaths,
      project: selectedProject,
      provider,
      modelOptions: providerStatus.models,
      savedModelHint: projectSettings.agentModel,
      savedReasoningHint: normalizeProviderReasoningEffort(
        provider,
        projectSettings.agentReasoningEffort ?? config.defaultAgentReasoningEffort,
      ),
    }),
  });
  const parsedRuntimeRecommendation = parseRuntimeRecommendation(
    runtimeRecommendationResponse.assistantText,
  );
  const resolvedRuntime = resolveRuntimeRecommendation({
    provider,
    modelOptions: providerStatus.models,
    defaultModel: providerStatus.defaultModel,
    savedModelHint: projectSettings.agentModel,
    savedReasoningHint: normalizeProviderReasoningEffort(
      provider,
      projectSettings.agentReasoningEffort ?? config.defaultAgentReasoningEffort,
    ),
    recommendation: parsedRuntimeRecommendation,
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
    remoteResources: projectSettings.remoteResources,
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
