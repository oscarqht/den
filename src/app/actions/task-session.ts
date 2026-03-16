'use server';

import { buildAgentStartupPrompt } from '../../lib/agent-startup-prompt.ts';
import { normalizeProviderReasoningEffort } from '../../lib/agent/reasoning.ts';
import { startSessionTurn } from '../../lib/agent/session-manager.ts';
import {
  buildAttachmentContext,
  buildProjectRepoLaunchContext,
  buildProjectRepoLaunchContextFromGitRepos,
  deriveSessionTitleFromTaskDescription,
  normalizeAttachmentPaths,
} from '../../lib/task-session.ts';

import type {
  AgentProvider,
  ProjectRemoteResource,
  ReasoningEffort,
  SessionWorkspacePreference,
} from '../../lib/types.ts';

import {
  createSession,
  saveSessionLaunchContext,
  type SessionCreateGitContextInput,
} from './session.ts';

export type LaunchTaskSessionInput = {
  projectPath: string;
  taskDescription?: string;
  rawTaskDescription?: string;
  attachmentPaths?: string[];
  agentProvider: AgentProvider;
  model: string;
  reasoningEffort?: ReasoningEffort;
  sessionMode?: 'fast' | 'plan';
  workspacePreference?: SessionWorkspacePreference;
  title?: string;
  startupScript?: string;
  devServerScript?: string;
  preparedWorkspaceId?: string;
  gitContexts?: SessionCreateGitContextInput[];
  projectRepoPaths?: string[];
  projectRepoRelativePaths?: string[];
  remoteResources?: ProjectRemoteResource[];
};

export type LaunchTaskSessionResult = {
  success: boolean;
  sessionName?: string;
  title?: string;
  error?: string;
};

export async function createAndLaunchTaskSession(
  input: LaunchTaskSessionInput,
): Promise<LaunchTaskSessionResult> {
  const projectPath = input.projectPath.trim();
  const taskDescription = input.taskDescription?.trim() || '';
  const rawTaskDescription = input.rawTaskDescription?.trim() || taskDescription;
  const title = input.title || deriveSessionTitleFromTaskDescription(rawTaskDescription);
  const attachmentContext = buildAttachmentContext(input.attachmentPaths || []);

  const createdSession = await createSession(projectPath, input.gitContexts || [], {
    agent: input.agentProvider,
    agentProvider: input.agentProvider,
    model: input.model.trim(),
    reasoningEffort: normalizeProviderReasoningEffort(
      input.agentProvider,
      input.reasoningEffort,
    ),
    title,
    startupScript: input.startupScript || undefined,
    devServerScript: input.devServerScript || undefined,
    preparedWorkspaceId: input.preparedWorkspaceId,
    workspacePreference: input.workspacePreference || 'workspace',
  });

  if (!createdSession.success || !createdSession.sessionName) {
    return {
      success: false,
      error: createdSession.error || 'Failed to create task session.',
    };
  }

  const projectRepoLaunchContext = input.projectRepoPaths && input.projectRepoRelativePaths
    ? (() => {
      const normalizedProjectRepoPaths = normalizeAttachmentPaths(input.projectRepoPaths || []);
      const normalizedProjectRepoRelativePaths = normalizedProjectRepoPaths.map((repoPath, index) => (
        input.projectRepoRelativePaths?.[index]?.trim()
        || buildProjectRepoLaunchContext(projectPath, [repoPath]).projectRepoRelativePaths[0]
      ));

      return {
        projectRepoPaths: normalizedProjectRepoPaths,
        projectRepoRelativePaths: normalizedProjectRepoRelativePaths,
      };
    })()
    : input.projectRepoPaths
      ? buildProjectRepoLaunchContext(projectPath, input.projectRepoPaths)
      : buildProjectRepoLaunchContextFromGitRepos(projectPath, createdSession.gitRepos || []);

  const launchContextResult = await saveSessionLaunchContext(createdSession.sessionName, {
    title,
    initialMessage: taskDescription || undefined,
    rawInitialMessage: rawTaskDescription || undefined,
    startupScript: input.startupScript || undefined,
    attachmentPaths: attachmentContext.attachmentPaths,
    attachmentNames: attachmentContext.attachmentNames,
    projectRepoPaths: projectRepoLaunchContext.projectRepoPaths,
    projectRepoRelativePaths: projectRepoLaunchContext.projectRepoRelativePaths,
    remoteResources: input.remoteResources,
    agentProvider: input.agentProvider,
    model: input.model.trim(),
    reasoningEffort: normalizeProviderReasoningEffort(
      input.agentProvider,
      input.reasoningEffort,
    ),
    sessionMode: input.sessionMode || 'fast',
  });

  if (!launchContextResult.success) {
    return {
      success: false,
      error: launchContextResult.error || 'Failed to save task session context.',
    };
  }

  const initialAgentPrompt = buildAgentStartupPrompt({
    taskDescription: taskDescription || undefined,
    attachmentPaths: attachmentContext.attachmentPaths,
    sessionMode: input.sessionMode || 'fast',
    workspaceMode: createdSession.workspaceMode || 'folder',
    gitRepos: createdSession.gitRepos,
    discoveredRepoRelativePaths: projectRepoLaunchContext.projectRepoRelativePaths,
    remoteResources: input.remoteResources,
  });

  if (initialAgentPrompt) {
    const initialTurnResult = await startSessionTurn({
      sessionId: createdSession.sessionName,
      message: initialAgentPrompt,
      displayMessage: initialAgentPrompt,
      markInitialized: true,
    });

    if (!initialTurnResult.success) {
      return {
        success: false,
        error: initialTurnResult.error || 'Failed to queue the initial task turn.',
      };
    }
  }

  return {
    success: true,
    sessionName: createdSession.sessionName,
    title,
  };
}
