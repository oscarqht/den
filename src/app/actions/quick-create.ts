'use server';

import fsSync from 'node:fs';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

import { getConfig, updateConfig, type Config } from './config.ts';
import { buildAgentStartupPrompt } from '../../lib/agent-startup-prompt.ts';
import { normalizeProviderReasoningEffort } from '../../lib/agent/reasoning.ts';
import { readLocalState, updateLocalState } from '../../lib/local-db.ts';
import {
  deriveQuickCreateTitle,
  KNOWN_QUICK_CREATE_REASONING_EFFORTS,
  parseQuickCreateRoutingSelection,
  sortQuickCreateDrafts,
  type QuickCreateDraft,
} from '../../lib/quick-create.ts';
import { completeQuickCreateJob, getActiveQuickCreateJobCount, registerQuickCreateJob } from '../../lib/quick-create-jobs.ts';
import { getBaseName } from '../../lib/path.ts';
import { getProjectPrimaryFolderPath } from '../../lib/project-folders.ts';
import type {
  AppStatus,
  AgentProvider,
  Project,
  QuickCreateJobUpdatePayload,
  ReasoningEffort,
  SessionGitRepoContext,
  SessionWorkspaceFolder,
  SessionWorkspacePreference,
  SessionWorkspaceMode,
} from '../../lib/types.ts';

type QuickCreateDraftRow = {
  id: string;
  title: string;
  message: string;
  attachment_paths_json: string;
  last_error: string;
  created_at: string;
  updated_at: string;
};

export type QuickCreateTaskInput = {
  message: string;
  attachmentPaths?: string[];
  sourceTabId?: string | null;
  draftId?: string | null;
};

export type QuickCreateProjectCandidate = {
  projectId: string;
  path: string;
  displayName: string;
  recentIndex: number | null;
};

type QuickCreateRoutingSettings = {
  provider: AgentProvider;
  model: string;
  reasoningEffort: ReasoningEffort;
};

type SessionCreateGitContextInput = {
  repoPath: string;
  baseBranch?: string;
};

type QuickCreateRoutingResult = {
  projectId: string;
  projectPath: string;
  reasoningEffort: ReasoningEffort;
  reason: string;
};

type QuickCreateExecutionSuccess = {
  status: 'succeeded';
  sessionId: string;
  projectId: string;
  projectPath: string;
  draftId?: string;
};

type QuickCreateExecutionFailure = {
  status: 'failed';
  draftId?: string;
  error: string;
};

type QuickCreateExecutionResult = QuickCreateExecutionSuccess | QuickCreateExecutionFailure;

type QuickCreateDependencies = {
  getConfig: typeof getConfig;
  updateConfig: typeof updateConfig;
  getProjects: () => Project[];
  getDefaultAgentProvider: () => Promise<AgentProvider>;
  loadAgentStatus: (provider: AgentProvider) => Promise<AppStatus>;
  discoverProjectGitReposWithBranches: (projectPath: string) => Promise<{
    repos: Array<{
      repoPath: string;
      relativePath: string;
    }>;
    branchesByRepo: Record<string, Array<{
      name: string;
      current?: boolean;
    }>>;
  }>;
  createSession: (
    projectPath: string,
    gitContexts: SessionCreateGitContextInput[],
    metadata: {
      agent: string;
      agentProvider?: AgentProvider;
      model: string;
      reasoningEffort?: ReasoningEffort;
      title?: string;
      workspacePreference?: SessionWorkspacePreference;
    },
  ) => Promise<{
    success: boolean;
    sessionName?: string;
    workspaceFolders?: SessionWorkspaceFolder[];
    workspaceMode?: SessionWorkspaceMode;
    gitRepos?: SessionGitRepoContext[];
    error?: string;
  }>;
  deleteSession: (sessionName: string) => Promise<{ success: boolean; error?: string }>;
  saveSessionLaunchContext: (
    sessionName: string,
    context: {
      title: string;
      initialMessage: string;
      rawInitialMessage: string;
      attachmentPaths: string[];
      attachmentNames: string[];
      projectRepoPaths: string[];
      projectRepoRelativePaths: string[];
      agentProvider: AgentProvider;
      model: string;
      reasoningEffort: ReasoningEffort;
      sessionMode: 'plan';
    },
  ) => Promise<{ success: boolean; error?: string }>;
  startSessionTurn: (input: {
    sessionId: string;
    message: string;
    displayMessage: string;
    markInitialized: boolean;
  }) => Promise<{ success: boolean; error?: string }>;
  registerAgentSession: (input: {
    sessionId: string;
    provider: AgentProvider;
    workspacePath: string;
    model: string;
    reasoningEffort: ReasoningEffort;
  }) => unknown;
  startAgentSessionTurn: (input: {
    sessionId: string;
    provider: AgentProvider;
    workspacePath: string;
    model: string;
    reasoningEffort: ReasoningEffort;
    message: string;
  }) => Promise<unknown>;
  waitForAgentSessionRun: (sessionId: string) => Promise<unknown>;
  hydrateAgentSessionHistory: (
    sessionId: string,
    options?: { force?: boolean },
  ) => Promise<{ history: Array<{ kind: string; text?: string }> }>;
  unregisterAgentSession: (sessionId: string) => unknown;
};

const QUICK_CREATE_ROUTING_SESSION_PREFIX = 'quick-create-routing';

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

function rowToQuickCreateDraft(row: QuickCreateDraftRow): QuickCreateDraft {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    attachmentPaths: parseStringArray(row.attachment_paths_json),
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeAttachmentPaths(attachmentPaths: string[]): string[] {
  return Array.from(
    new Set(attachmentPaths.map((entry) => entry.trim()).filter(Boolean)),
  );
}

function validateQuickCreateInput(input: QuickCreateTaskInput): {
  message: string;
  attachmentPaths: string[];
  sourceTabId: string | null;
  draftId: string | null;
} {
  const message = input.message.trim();
  if (!message) {
    throw new Error('Task description is required.');
  }

  return {
    message,
    attachmentPaths: normalizeAttachmentPaths(input.attachmentPaths ?? []),
    sourceTabId: input.sourceTabId?.trim() || null,
    draftId: input.draftId?.trim() || null,
  };
}

function computeDisplayName(project: Project, config: Config): string {
  const alias = config.projectSettings[project.id]?.alias?.trim();
  return alias || project.name || getBaseName(getProjectPrimaryFolderPath(project) || project.id);
}

function isExistingDirectory(projectPath: string): boolean {
  try {
    return fsSync.statSync(projectPath).isDirectory();
  } catch {
    return false;
  }
}

function resolveQuickCreateProjectCandidates(
  projects: Project[],
  config: Config,
): QuickCreateProjectCandidate[] {
  const recentIndexes = new Map(
    (config.recentProjects ?? []).flatMap((projectEntry, index) => {
      const keys = [projectEntry];
      return keys.map((key) => [key, index] as const);
    }),
  );

  const candidates = projects
    .filter((project) => {
      const primaryFolderPath = getProjectPrimaryFolderPath(project);
      return Boolean(primaryFolderPath?.trim()) && isExistingDirectory(primaryFolderPath!);
    })
    .map((project) => ({
      projectId: project.id,
      path: getProjectPrimaryFolderPath(project)!,
      displayName: computeDisplayName(project, config),
      recentIndex: recentIndexes.get(project.id) ?? recentIndexes.get(getProjectPrimaryFolderPath(project)!) ?? null,
    }));

  return candidates.sort((left, right) => {
    if (left.recentIndex === null && right.recentIndex !== null) return 1;
    if (left.recentIndex !== null && right.recentIndex === null) return -1;
    if (left.recentIndex !== null && right.recentIndex !== null && left.recentIndex !== right.recentIndex) {
      return left.recentIndex - right.recentIndex;
    }
    return left.displayName.localeCompare(right.displayName);
  });
}

function formatRoutingCandidates(candidates: QuickCreateProjectCandidate[]) {
  return candidates.map((candidate, index) => ({
    index: index + 1,
    projectId: candidate.projectId,
    projectPath: candidate.path,
    displayName: candidate.displayName,
    recent: candidate.recentIndex !== null,
    recentRank: candidate.recentIndex !== null ? candidate.recentIndex + 1 : null,
  }));
}

function buildQuickCreateRoutingPrompt(input: {
  message: string;
  attachmentPaths: string[];
  candidates: QuickCreateProjectCandidate[];
}): string {
  const candidateList = JSON.stringify(formatRoutingCandidates(input.candidates), null, 2);
  const attachmentsSection = input.attachmentPaths.length > 0
    ? [
      'Attachments:',
      ...input.attachmentPaths.map((attachmentPath) => `- ${attachmentPath}`),
      '',
    ].join('\n')
    : '';

  return [
    'You are routing a new Den task to the best project.',
    'Choose exactly one project from the provided candidate list.',
    'Recent projects are only a soft hint. Choose the project that best matches the task.',
    `Return JSON only with this shape: {"projectId":"...","projectPath":"...","reasoningEffort":"...","reason":"..."}.`,
    `reasoningEffort must be one of: ${KNOWN_QUICK_CREATE_REASONING_EFFORTS.join(', ')}.`,
    'Do not wrap the JSON in markdown fences. Do not include any extra text.',
    '',
    'Candidate projects:',
    candidateList,
    '',
    'Task description:',
    input.message,
    '',
    attachmentsSection,
  ].join('\n');
}

function getLatestAssistantText(history: Array<{ kind: string; text?: string }>): string {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry?.kind !== 'assistant') continue;
    const text = entry.text?.trim();
    if (text) return text;
  }

  return '';
}

function normalizeRoutingReasoningEffort(
  provider: AgentProvider,
  value: ReasoningEffort,
): ReasoningEffort {
  return normalizeProviderReasoningEffort(provider, value) ?? value;
}

async function resolveRoutingSettings(
  config: Config,
  deps: QuickCreateDependencies,
): Promise<QuickCreateRoutingSettings> {
  const provider = config.defaultAgentProvider ?? await deps.getDefaultAgentProvider();
  const status = await deps.loadAgentStatus(provider);

  if (!status.installed) {
    throw new Error(`Install ${provider} before using quick create.`);
  }

  if (!status.loggedIn) {
    throw new Error(`Log in to ${provider} before using quick create.`);
  }

  const model = config.defaultAgentModel?.trim()
    || status.defaultModel?.trim()
    || status.models[0]?.id?.trim()
    || '';
  if (!model) {
    throw new Error(`No default model is available for ${provider}.`);
  }

  return {
    provider,
    model,
    reasoningEffort: normalizeRoutingReasoningEffort(provider, 'minimal'),
  };
}

async function runRoutingAgent(input: {
  message: string;
  attachmentPaths: string[];
  candidates: QuickCreateProjectCandidate[];
  workspacePath: string;
  settings: QuickCreateRoutingSettings;
  deps: QuickCreateDependencies;
}): Promise<QuickCreateRoutingResult> {
  const routingSessionId = `${QUICK_CREATE_ROUTING_SESSION_PREFIX}-${randomUUID()}`;
  const prompt = buildQuickCreateRoutingPrompt({
    message: input.message,
    attachmentPaths: input.attachmentPaths,
    candidates: input.candidates,
  });

  input.deps.registerAgentSession({
    sessionId: routingSessionId,
    provider: input.settings.provider,
    workspacePath: input.workspacePath,
    model: input.settings.model,
    reasoningEffort: input.settings.reasoningEffort,
  });

  try {
    await input.deps.startAgentSessionTurn({
      sessionId: routingSessionId,
      provider: input.settings.provider,
      workspacePath: input.workspacePath,
      model: input.settings.model,
      reasoningEffort: input.settings.reasoningEffort,
      message: prompt,
    });

    await input.deps.waitForAgentSessionRun(routingSessionId);
    const hydratedView = await input.deps.hydrateAgentSessionHistory(routingSessionId, { force: true });
    const assistantText = getLatestAssistantText(hydratedView.history);
    const validProjectIds = new Set(input.candidates.map((candidate) => candidate.projectId));
    const parsed = parseQuickCreateRoutingSelection(assistantText, validProjectIds);

    return {
      projectId: parsed.projectId,
      projectPath: parsed.projectPath,
      reasoningEffort: normalizeRoutingReasoningEffort(input.settings.provider, parsed.reasoningEffort),
      reason: parsed.reason,
    };
  } finally {
    try {
      input.deps.unregisterAgentSession(routingSessionId);
    } catch (error) {
      console.warn(`Failed to unregister routing session ${routingSessionId}:`, error);
    }
  }
}

function buildAttachmentMetadata(attachmentPaths: string[]) {
  const normalizedPaths = normalizeAttachmentPaths(attachmentPaths);
  const attachmentPathByName = new Map<string, string>();
  for (const attachmentPath of normalizedPaths) {
    const baseName = getBaseName(attachmentPath).trim();
    if (!baseName || attachmentPathByName.has(baseName)) continue;
    attachmentPathByName.set(baseName, attachmentPath);
  }

  return {
    attachmentPaths: normalizedPaths,
    attachmentNames: Array.from(attachmentPathByName.keys()),
  };
}

async function upsertQuickCreateDraft(input: {
  draftId?: string | null;
  message: string;
  attachmentPaths: string[];
  error: string;
}): Promise<QuickCreateDraft> {
  const now = new Date().toISOString();
  const draftId = input.draftId?.trim() || randomUUID();
  const title = deriveQuickCreateTitle(input.message);
  const attachmentPaths = normalizeAttachmentPaths(input.attachmentPaths);

  updateLocalState((state) => {
    const existing = state.quickCreateDrafts[draftId];
    state.quickCreateDrafts[draftId] = {
      id: draftId,
      title,
      message: input.message,
      attachmentPathsJson: JSON.stringify(attachmentPaths),
      lastError: input.error,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  });

  const stored = readLocalState().quickCreateDrafts[draftId];
  const row = stored ? {
    id: stored.id,
    title: stored.title,
    message: stored.message,
    attachment_paths_json: stored.attachmentPathsJson,
    last_error: stored.lastError,
    created_at: stored.createdAt,
    updated_at: stored.updatedAt,
  } : undefined;

  if (!row) {
    throw new Error('Failed to persist quick create draft.');
  }

  return rowToQuickCreateDraft(row);
}

async function removeQuickCreateDraftIfPresent(draftId: string | null | undefined): Promise<void> {
  const normalizedDraftId = draftId?.trim();
  if (!normalizedDraftId) return;
  updateLocalState((state) => {
    delete state.quickCreateDrafts[normalizedDraftId];
  });
}

async function moveProjectToRecent(projectId: string, deps: QuickCreateDependencies): Promise<void> {
  const config = await deps.getConfig();
  const nextRecentProjects = [
    projectId,
    ...config.recentProjects.filter((existingProjectId) => existingProjectId !== projectId),
  ];
  await deps.updateConfig({ recentProjects: nextRecentProjects });
}

async function resolveSessionGitContexts(projectPath: string, deps: QuickCreateDependencies): Promise<{
  gitContexts: SessionCreateGitContextInput[];
  projectRepoPaths: string[];
  projectRepoRelativePaths: string[];
}> {
  const discovery = await deps.discoverProjectGitReposWithBranches(projectPath);
  const gitContexts = discovery.repos.map((repo) => {
    const branches = discovery.branchesByRepo[repo.repoPath] ?? [];
    const baseBranch = branches.find((branch) => branch.current)?.name || branches[0]?.name || '';
    return {
      repoPath: repo.repoPath,
      baseBranch: baseBranch || undefined,
    };
  }).filter((context) => Boolean(context.baseBranch));

  return {
    gitContexts,
    projectRepoPaths: discovery.repos.map((repo) => repo.repoPath),
    projectRepoRelativePaths: discovery.repos.map((repo) => repo.relativePath),
  };
}

async function getQuickCreateDependencies(): Promise<QuickCreateDependencies> {
  const [
    storeModule,
    providersModule,
    projectModule,
    sessionModule,
    runtimeModule,
    sessionManagerModule,
  ] = await Promise.all([
    import('../../lib/store.ts'),
    import('../../lib/agent/providers/index.ts'),
    import('./project.ts'),
    import('./session.ts'),
    import('../../lib/agent/runtime.ts'),
    import('../../lib/agent/session-manager.ts'),
  ]);

  return {
    getConfig,
    updateConfig,
    getProjects: storeModule.getProjects,
    getDefaultAgentProvider: async () => providersModule.getDefaultAgentProvider(),
    loadAgentStatus: async (provider) => await providersModule.getAgentAdapter(provider).getStatus(),
    discoverProjectGitReposWithBranches: projectModule.discoverProjectGitReposWithBranches,
    createSession: sessionModule.createSession,
    deleteSession: sessionModule.deleteSession,
    saveSessionLaunchContext: sessionModule.saveSessionLaunchContext,
    startSessionTurn: sessionManagerModule.startSessionTurn,
    registerAgentSession: runtimeModule.registerAgentSession,
    startAgentSessionTurn: runtimeModule.startAgentSessionTurn,
    waitForAgentSessionRun: runtimeModule.waitForAgentSessionRun,
    hydrateAgentSessionHistory: runtimeModule.hydrateAgentSessionHistory,
    unregisterAgentSession: runtimeModule.unregisterAgentSession,
  };
}

export async function executeQuickCreateTaskJob(
  input: QuickCreateTaskInput,
  deps?: QuickCreateDependencies,
): Promise<QuickCreateExecutionResult> {
  let createdSessionName: string | null = null;
  const resolvedDeps = deps ?? await getQuickCreateDependencies();

  try {
    const normalizedInput = validateQuickCreateInput(input);
    const config = await resolvedDeps.getConfig();
    const candidates = resolveQuickCreateProjectCandidates(resolvedDeps.getProjects(), config);
    if (candidates.length === 0) {
      throw new Error('No registered projects are available for quick create.');
    }

    const routingSettings = await resolveRoutingSettings(config, resolvedDeps);
    const routingResult = await runRoutingAgent({
      message: normalizedInput.message,
      attachmentPaths: normalizedInput.attachmentPaths,
      candidates,
      workspacePath: config.defaultRoot?.trim() || os.homedir(),
      settings: routingSettings,
      deps: resolvedDeps,
    });

    const sessionGitContext = await resolveSessionGitContexts(routingResult.projectId, resolvedDeps);
    const attachmentMetadata = buildAttachmentMetadata(normalizedInput.attachmentPaths);
    const title = deriveQuickCreateTitle(normalizedInput.message);

    await moveProjectToRecent(routingResult.projectId, resolvedDeps);

    const sessionResult = await resolvedDeps.createSession(
      routingResult.projectId,
      sessionGitContext.gitContexts,
      {
        agent: routingSettings.provider,
        agentProvider: routingSettings.provider,
        model: routingSettings.model,
        reasoningEffort: routingResult.reasoningEffort,
        title,
        workspacePreference: 'workspace',
      },
    );

    if (!sessionResult.success || !sessionResult.sessionName) {
      throw new Error(sessionResult.error || 'Failed to create quick create session.');
    }

    createdSessionName = sessionResult.sessionName;

    const launchContextResult = await resolvedDeps.saveSessionLaunchContext(sessionResult.sessionName, {
      title,
      initialMessage: normalizedInput.message,
      rawInitialMessage: normalizedInput.message,
      attachmentPaths: attachmentMetadata.attachmentPaths,
      attachmentNames: attachmentMetadata.attachmentNames,
      projectRepoPaths: sessionGitContext.projectRepoPaths,
      projectRepoRelativePaths: sessionGitContext.projectRepoRelativePaths,
      agentProvider: routingSettings.provider,
      model: routingSettings.model,
      reasoningEffort: routingResult.reasoningEffort,
      sessionMode: 'plan',
    });

    if (!launchContextResult.success) {
      throw new Error(launchContextResult.error || 'Failed to save quick create launch context.');
    }

    const startupPrompt = buildAgentStartupPrompt({
      taskDescription: normalizedInput.message,
      attachmentPaths: attachmentMetadata.attachmentPaths,
      sessionMode: 'plan',
      workspaceMode: sessionResult.workspaceMode || 'folder',
      workspaceFolders: sessionResult.workspaceFolders,
      gitRepos: sessionResult.gitRepos,
      discoveredRepoRelativePaths: sessionGitContext.projectRepoRelativePaths,
    });

    if (!startupPrompt) {
      throw new Error('Quick create task description is missing.');
    }

    const turnResult = await resolvedDeps.startSessionTurn({
      sessionId: sessionResult.sessionName,
      message: startupPrompt,
      displayMessage: startupPrompt,
      markInitialized: true,
    });

    if (!turnResult.success) {
      throw new Error(turnResult.error || 'Failed to queue quick create agent turn.');
    }

    await removeQuickCreateDraftIfPresent(normalizedInput.draftId);

    return {
      status: 'succeeded',
      sessionId: sessionResult.sessionName,
      projectId: routingResult.projectId,
      projectPath: routingResult.projectPath,
      draftId: normalizedInput.draftId || undefined,
    };
  } catch (error) {
    if (createdSessionName) {
      try {
        await resolvedDeps.deleteSession(createdSessionName);
      } catch (cleanupError) {
        console.warn(`Failed to cleanup quick create session ${createdSessionName}:`, cleanupError);
      }
    }

    const errorMessage = error instanceof Error ? error.message : 'Quick create failed.';
    try {
      const draft = await upsertQuickCreateDraft({
        draftId: input.draftId,
        message: input.message,
        attachmentPaths: input.attachmentPaths ?? [],
        error: errorMessage,
      });

      return {
        status: 'failed',
        draftId: draft.id,
        error: errorMessage,
      };
    } catch (draftError) {
      const draftMessage = draftError instanceof Error ? draftError.message : 'Failed to save quick create draft.';
      return {
        status: 'failed',
        error: `${errorMessage} ${draftMessage}`.trim(),
      };
    }
  }
}

export async function getHomeQuickCreateState(): Promise<{
  activeCount: number;
  drafts: QuickCreateDraft[];
}> {
  return {
    activeCount: getActiveQuickCreateJobCount(),
    drafts: await listQuickCreateDrafts(),
  };
}

export async function listQuickCreateDrafts(): Promise<QuickCreateDraft[]> {
  const rows = Object.values(readLocalState().quickCreateDrafts)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((draft) => ({
      id: draft.id,
      title: draft.title,
      message: draft.message,
      attachment_paths_json: draft.attachmentPathsJson,
      last_error: draft.lastError,
      created_at: draft.createdAt,
      updated_at: draft.updatedAt,
    } satisfies QuickCreateDraftRow));

  return sortQuickCreateDrafts(rows.map(rowToQuickCreateDraft));
}

export async function deleteQuickCreateDraft(draftId: string): Promise<{ success: boolean; error?: string }> {
  const normalizedDraftId = draftId.trim();
  if (!normalizedDraftId) {
    return { success: false, error: 'Draft id is required.' };
  }

  try {
    updateLocalState((state) => {
      delete state.quickCreateDrafts[normalizedDraftId];
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete quick create draft.',
    };
  }
}

async function publishQuickCreateUpdate(
  payload: Omit<QuickCreateJobUpdatePayload, 'type' | 'timestamp'>,
): Promise<void> {
  const notificationModule = await import('../../lib/sessionNotificationServer.ts');
  await notificationModule.publishQuickCreateJobUpdate(payload);
}

export async function startQuickCreateTask(input: QuickCreateTaskInput): Promise<{
  success: boolean;
  jobId?: string;
  error?: string;
}> {
  let normalizedInput: ReturnType<typeof validateQuickCreateInput>;
  try {
    normalizedInput = validateQuickCreateInput(input);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Task description is required.',
    };
  }

  const jobId = randomUUID();
  const activeCount = registerQuickCreateJob({
    jobId,
    sourceTabId: normalizedInput.sourceTabId,
    draftId: normalizedInput.draftId,
  });

  try {
    await publishQuickCreateUpdate({
      jobId,
      status: 'started',
      activeCount,
      sourceTabId: normalizedInput.sourceTabId,
      draftId: normalizedInput.draftId || undefined,
    });
  } catch (error) {
    console.warn(`Failed to publish quick create start for ${jobId}:`, error);
  }

  const { runInBackground } = await import('../../lib/background-task.ts');

  runInBackground(async () => {
    const result = await executeQuickCreateTaskJob(normalizedInput);
    const nextActiveCount = completeQuickCreateJob(jobId);
    try {
      await publishQuickCreateUpdate({
        jobId,
        status: result.status,
        activeCount: nextActiveCount,
        sourceTabId: normalizedInput.sourceTabId,
        sessionId: result.status === 'succeeded' ? result.sessionId : undefined,
        projectId: result.status === 'succeeded' ? result.projectId : undefined,
        projectPath: result.status === 'succeeded' ? result.projectPath : undefined,
        draftId: result.draftId,
        error: result.status === 'failed' ? result.error : undefined,
      });
    } catch (error) {
      console.warn(`Failed to publish quick create completion for ${jobId}:`, error);
    }
  }, (error) => {
    const nextActiveCount = completeQuickCreateJob(jobId);
    console.error(`Quick create background job ${jobId} failed:`, error);
    void publishQuickCreateUpdate({
      jobId,
      status: 'failed',
      activeCount: nextActiveCount,
      sourceTabId: normalizedInput.sourceTabId,
      draftId: normalizedInput.draftId || undefined,
      error: error instanceof Error ? error.message : 'Quick create failed.',
    }).catch((publishError) => {
      console.warn(`Failed to publish quick create fatal failure for ${jobId}:`, publishError);
    });
  });

  return {
    success: true,
    jobId,
  };
}
