'use server';

import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { getConfig, updateConfig, type Config } from './config.ts';
import { buildAgentStartupPrompt } from '../../lib/agent-startup-prompt.ts';
import { getRelevantMemoryFiles } from '../../lib/memory.ts';
import { normalizeProviderReasoningEffort } from '../../lib/agent/reasoning.ts';
import { readLocalState, updateLocalState } from '../../lib/local-db.ts';
import { addProject, findProjectByFolderPath } from '../../lib/store.ts';
import {
  buildQuickCreateSessionPrompt,
  countExplicitProjectMentions,
  deriveQuickCreateTitle,
  extractExplicitProjectMentions,
  KNOWN_QUICK_CREATE_REASONING_EFFORTS,
  parseQuickCreateRoutingSelection,
  sortQuickCreateDrafts,
  type QuickCreateDraft,
  type QuickCreateExplicitProjectMentions,
  type QuickCreateProjectMentionCandidate,
  type QuickCreateRoutingTarget,
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
  targets: QuickCreateRoutingTarget[];
  reasoningEffort: ReasoningEffort;
  reason: string;
};

type MaterializedQuickCreateTarget = {
  projectId: string;
  projectPath: string;
  projectName: string;
};

type QuickCreateExecutionSuccess = {
  status: 'succeeded';
  sessionId: string;
  sessionIds: string[];
  projectId: string;
  projectIds: string[];
  projectPath: string;
  projectPaths: string[];
  projectNames: string[];
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
  createProjectFromDefaultRoot: (
    projectName: string,
  ) => Promise<{ projectId: string; projectPath: string; projectName: string }>;
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
  const primaryFolderPath = getProjectPrimaryFolderPath(project);
  const alias = config.projectSettings[project.id]?.alias?.trim()
    || (primaryFolderPath ? config.projectSettings[primaryFolderPath]?.alias?.trim() : '');
  return alias || project.name || getBaseName(getProjectPrimaryFolderPath(project) || project.id);
}

function computeProjectMentionLabels(project: Project, config: Config): string[] {
  const primaryFolderPath = getProjectPrimaryFolderPath(project);
  const alias = config.projectSettings[project.id]?.alias?.trim()
    || (primaryFolderPath ? config.projectSettings[primaryFolderPath]?.alias?.trim() : '');
  return Array.from(new Set([
    computeDisplayName(project, config),
    project.name.trim(),
    alias || '',
    primaryFolderPath ? getBaseName(primaryFolderPath) : '',
  ].filter(Boolean)));
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

function buildProjectMentionCandidates(
  projects: Project[],
  config: Config,
): QuickCreateProjectMentionCandidate[] {
  return resolveQuickCreateProjectCandidates(projects, config).map((candidate) => {
    const project = projects.find((entry) => entry.id === candidate.projectId);
    return {
      projectId: candidate.projectId,
      projectPath: candidate.path,
      labels: project ? computeProjectMentionLabels(project, config) : [candidate.displayName],
    };
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
  existingMentionLabels: string[];
  unresolvedMentionLabels: string[];
  allowNewProjects: boolean;
}): string {
  const candidateList = JSON.stringify(formatRoutingCandidates(input.candidates), null, 2);
  const attachmentsSection = input.attachmentPaths.length > 0
    ? [
      'Attachments:',
      ...input.attachmentPaths.map((attachmentPath) => `- ${attachmentPath}`),
      '',
    ].join('\n')
    : '';
  const explicitMentionsSection = (input.existingMentionLabels.length > 0 || input.unresolvedMentionLabels.length > 0)
    ? [
      'Explicit project mentions from the task:',
      ...(input.existingMentionLabels.length > 0
        ? input.existingMentionLabels.map((label) => `- existing: ${label}`)
        : ['- existing: none']),
      ...(input.unresolvedMentionLabels.length > 0
        ? input.unresolvedMentionLabels.map((label) => `- unresolved: ${label}`)
        : ['- unresolved: none']),
      '',
    ].join('\n')
    : '';

  return [
    'You are routing a new Den task to one or more projects.',
    'Choose every project that should receive this task. Recent projects are only a soft hint.',
    input.allowNewProjects
      ? 'When no candidate fits, or the task clearly requires a new project, you may create a new project target.'
      : 'Do not create new projects because the workspace default root is unavailable.',
    'If explicit project mentions are provided, you must include all of them in the result.',
    'Existing explicit mentions should map to candidate projects when possible.',
    'Unresolved explicit mentions should become new project targets when new projects are allowed.',
    `Return JSON only with this shape: {"targets":[{"type":"existing","projectId":"...","projectPath":"...","reason":"..."}|{"type":"new","projectName":"...","reason":"..."}],"reasoningEffort":"...","reason":"..."}.`,
    `reasoningEffort must be one of: ${KNOWN_QUICK_CREATE_REASONING_EFFORTS.join(', ')}.`,
    'Do not wrap the JSON in markdown fences. Do not include any extra text.',
    'Return at least one target.',
    '',
    'Candidate projects:',
    candidateList,
    '',
    explicitMentionsSection,
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

function validateQuickCreateProjectName(projectName: string): string {
  const normalizedProjectName = projectName.trim();
  if (!normalizedProjectName) {
    throw new Error('New project name is required.');
  }
  if (normalizedProjectName === '.' || normalizedProjectName === '..') {
    throw new Error('New project name is invalid.');
  }
  if (normalizedProjectName.includes('/') || normalizedProjectName.includes('\\')) {
    throw new Error('New project name cannot include path separators.');
  }
  return normalizedProjectName;
}

async function createProjectFromDefaultRoot(
  projectName: string,
  config: Config,
): Promise<{ projectId: string; projectPath: string; projectName: string }> {
  const normalizedProjectName = validateQuickCreateProjectName(projectName);
  const defaultRoot = config.defaultRoot.trim();
  if (!defaultRoot) {
    throw new Error('Default root is not configured for creating new projects.');
  }

  const defaultRootStats = await fs.stat(/* turbopackIgnore: true */ defaultRoot).catch(() => null);
  if (!defaultRootStats?.isDirectory()) {
    throw new Error('Default root does not exist or is not a directory.');
  }

  const projectPath = path.join(/* turbopackIgnore: true */ defaultRoot, normalizedProjectName);
  const existingProject = findProjectByFolderPath(projectPath);
  if (existingProject) {
    return {
      projectId: existingProject.id,
      projectPath,
      projectName: computeDisplayName(existingProject, config),
    };
  }

  const existingPathStats = await fs.stat(/* turbopackIgnore: true */ projectPath).catch(() => null);
  if (existingPathStats && !existingPathStats.isDirectory()) {
    throw new Error(`Project path is not a directory: ${projectPath}`);
  }

  if (!existingPathStats) {
    await fs.mkdir(/* turbopackIgnore: true */ projectPath, { recursive: false });
  }

  const project = addProject({
    name: normalizedProjectName,
    folderPaths: [projectPath],
  });

  return {
    projectId: project.id,
    projectPath,
    projectName: normalizedProjectName,
  };
}

function resolveExplicitQuickCreateRouting(input: {
  explicitMentions: QuickCreateExplicitProjectMentions;
  provider: AgentProvider;
  defaultReasoningEffort?: ReasoningEffort;
}): QuickCreateRoutingResult | null {
  const explicitMentions = input.explicitMentions;
  if (explicitMentions.existingTargets.length === 0 && explicitMentions.newProjectNames.length === 0) {
    return null;
  }

  return {
    targets: [
      ...explicitMentions.existingTargets.map((target) => ({
        type: 'existing' as const,
        projectId: target.projectId,
        projectPath: target.projectPath,
        reason: `Explicitly mentioned via @${target.matchedLabel}.`,
      })),
      ...explicitMentions.newProjectNames.map((projectName) => ({
        type: 'new' as const,
        projectName,
        reason: `Explicitly mentioned via @${projectName}.`,
      })),
    ],
    reasoningEffort: normalizeRoutingReasoningEffort(
      input.provider,
      input.defaultReasoningEffort ?? 'medium',
    ),
    reason: 'Used explicit project mentions from the task description.',
  };
}

async function materializeQuickCreateTargets(input: {
  routingResult: QuickCreateRoutingResult;
  candidates: QuickCreateProjectCandidate[];
  deps: QuickCreateDependencies;
}): Promise<MaterializedQuickCreateTarget[]> {
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.projectId, candidate] as const));
  const seenProjectIds = new Set<string>();
  const materializedTargets: MaterializedQuickCreateTarget[] = [];

  for (const target of input.routingResult.targets) {
    const materializedTarget = target.type === 'existing'
      ? {
          projectId: target.projectId,
          projectPath: target.projectPath,
          projectName: candidateById.get(target.projectId)?.displayName || getBaseName(target.projectPath) || target.projectId,
        }
      : await input.deps.createProjectFromDefaultRoot(target.projectName);

    if (seenProjectIds.has(materializedTarget.projectId)) {
      continue;
    }

    seenProjectIds.add(materializedTarget.projectId);
    materializedTargets.push(materializedTarget);
  }

  if (materializedTargets.length === 0) {
    throw new Error('Quick create did not resolve any project targets.');
  }

  return materializedTargets;
}

async function runRoutingAgent(input: {
  message: string;
  attachmentPaths: string[];
  candidates: QuickCreateProjectCandidate[];
  existingMentionLabels: string[];
  unresolvedMentionLabels: string[];
  allowNewProjects: boolean;
  workspacePath: string;
  settings: QuickCreateRoutingSettings;
  deps: QuickCreateDependencies;
}): Promise<QuickCreateRoutingResult> {
  const routingSessionId = `${QUICK_CREATE_ROUTING_SESSION_PREFIX}-${randomUUID()}`;
  const prompt = buildQuickCreateRoutingPrompt({
    message: input.message,
    attachmentPaths: input.attachmentPaths,
    candidates: input.candidates,
    existingMentionLabels: input.existingMentionLabels,
    unresolvedMentionLabels: input.unresolvedMentionLabels,
    allowNewProjects: input.allowNewProjects,
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
    const validProjects = new Map(
      input.candidates.map((candidate) => [candidate.projectId, candidate.path] as const),
    );
    const parsed = parseQuickCreateRoutingSelection(assistantText, validProjects);

    return {
      targets: parsed.targets,
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
    createProjectFromDefaultRoot: async (projectName: string) => (
      await createProjectFromDefaultRoot(projectName, await getConfig())
    ),
  };
}

export async function executeQuickCreateTaskJob(
  input: QuickCreateTaskInput,
  deps?: QuickCreateDependencies,
): Promise<QuickCreateExecutionResult> {
  const createdSessionNames: string[] = [];
  const resolvedDeps = deps ?? await getQuickCreateDependencies();

  try {
    const normalizedInput = validateQuickCreateInput(input);
    const config = await resolvedDeps.getConfig();
    const projects = resolvedDeps.getProjects();
    const candidates = resolveQuickCreateProjectCandidates(projects, config);
    const mentionCandidates = buildProjectMentionCandidates(projects, config);
    const explicitMentions = extractExplicitProjectMentions(normalizedInput.message, mentionCandidates);
    const explicitMentionCount = countExplicitProjectMentions(explicitMentions);

    const routingSettings = await resolveRoutingSettings(config, resolvedDeps);
    const attachmentMetadata = buildAttachmentMetadata(normalizedInput.attachmentPaths);
    const title = deriveQuickCreateTitle(normalizedInput.message);

    const explicitRoutingResult = resolveExplicitQuickCreateRouting({
      explicitMentions,
      provider: routingSettings.provider,
      defaultReasoningEffort: config.defaultAgentReasoningEffort,
    });
    const allowNewProjects = Boolean(config.defaultRoot.trim());
    if (!explicitRoutingResult && candidates.length === 0 && !allowNewProjects) {
      throw new Error('No registered projects are available and default root is not configured for creating new projects.');
    }

    const routingResult = explicitRoutingResult ?? await runRoutingAgent({
      message: normalizedInput.message,
      attachmentPaths: normalizedInput.attachmentPaths,
      candidates,
      existingMentionLabels: explicitMentions.existingTargets.map((target) => target.matchedLabel),
      unresolvedMentionLabels: explicitMentions.newProjectNames,
      allowNewProjects,
      workspacePath: config.defaultRoot?.trim() || os.homedir(),
      settings: routingSettings,
      deps: resolvedDeps,
    });

    const materializedTargets = await materializeQuickCreateTargets({
      routingResult,
      candidates,
      deps: resolvedDeps,
    });
    const targetCount = materializedTargets.length;
    const sessionIds: string[] = [];

    for (const target of materializedTargets) {
      const sessionPrompt = buildQuickCreateSessionPrompt({
        originalMessage: normalizedInput.message,
        targetProjectName: target.projectName,
        explicitMentionCount,
        targetCount,
      });
      const sessionGitContext = await resolveSessionGitContexts(target.projectPath, resolvedDeps);
      const sessionResult = await resolvedDeps.createSession(
        target.projectPath,
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

      createdSessionNames.push(sessionResult.sessionName);

      const launchContextResult = await resolvedDeps.saveSessionLaunchContext(sessionResult.sessionName, {
        title,
        initialMessage: sessionPrompt,
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

      const memoryFiles = await getRelevantMemoryFiles({
        projectId: target.projectId,
        projectPath: target.projectPath,
      });

      const startupPrompt = buildAgentStartupPrompt({
        taskDescription: sessionPrompt,
        attachmentPaths: attachmentMetadata.attachmentPaths,
        memoryFiles,
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

      sessionIds.push(sessionResult.sessionName);
    }

    for (const target of materializedTargets) {
      await moveProjectToRecent(target.projectId, resolvedDeps);
    }

    await removeQuickCreateDraftIfPresent(normalizedInput.draftId);

    return {
      status: 'succeeded',
      sessionId: sessionIds[0]!,
      sessionIds,
      projectId: materializedTargets[0]!.projectId,
      projectIds: materializedTargets.map((target) => target.projectId),
      projectPath: materializedTargets[0]!.projectPath,
      projectPaths: materializedTargets.map((target) => target.projectPath),
      projectNames: materializedTargets.map((target) => target.projectName),
      draftId: normalizedInput.draftId || undefined,
    };
  } catch (error) {
    for (const createdSessionName of createdSessionNames.reverse()) {
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
        sessionIds: result.status === 'succeeded' ? result.sessionIds : undefined,
        projectId: result.status === 'succeeded' ? result.projectId : undefined,
        projectIds: result.status === 'succeeded' ? result.projectIds : undefined,
        projectPath: result.status === 'succeeded' ? result.projectPath : undefined,
        projectPaths: result.status === 'succeeded' ? result.projectPaths : undefined,
        projectNames: result.status === 'succeeded' ? result.projectNames : undefined,
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
