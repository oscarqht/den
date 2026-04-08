'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderGit2, Plus, X, ChevronRight, ChevronDown, Bot, Trash2, ExternalLink, CloudDownload, Monitor, Sun, Moon, Zap, FileText, HardDrive, Layers } from 'lucide-react';
import FileBrowser from './FileBrowser';
import {
  GitBranch,
  getHomeDirectory,
  listInstalledAgentSkills,
  listRepoFiles,
  resolveRepoCardIcon,
  startTtydProcess,
} from '@/app/actions/git';
import {
  cloneRemoteProject,
  discoverProjectGitRepos,
  discoverProjectGitReposWithBranches,
  getProjectActivity,
  resolveProjectByName,
} from '@/app/actions/project';
import {
  createSession,
  deleteSession,
  getSessionPrefillContext,
  listSessions,
  prepareSessionWorkspace,
  releasePreparedSessionWorkspace,
  saveSessionLaunchContext,
  startPreparedSessionWorkspaceStartupCommand,
  type SessionCreateGitContextInput,
  SessionMetadata,
} from '@/app/actions/session';
import { deleteDraft, listDrafts, saveDraft, DraftMetadata } from '@/app/actions/draft';
import { getConfig, updateConfig, updateProjectSettings, Config } from '@/app/actions/config';
import { listCredentials } from '@/app/actions/credentials';
import type { Credential } from '@/lib/credentials';
import { useRouter } from 'next/navigation';
import {
  DEFAULT_HOME_PROJECT_SORT,
  normalizeHomeProjectSort,
  sortHomeProjects,
  type HomeProjectSort,
} from '@/lib/home-project-sort';
import { groupHomeProjectSessionsByProject } from '@/lib/home-project-sessions';
import {
  toHomeProjectGitRepos,
  type HomeProjectGitRepo,
} from '@/lib/home-project-git';
import { getBaseName } from '@/lib/path';
import {
  resolveCanonicalProjectReference,
  resolveClientActivityProjectKey,
  resolveClientProjectReference,
} from '@/lib/project-client';
import { buildRepoMentionSuggestions } from '@/lib/repo-mention-suggestions';
import { buildSkillMentionSuggestions } from '@/lib/skill-mention-suggestions';
import {
  deriveSessionStatus,
  formatSessionStatus,
  getSessionStatusBadgeTone,
  getSessionStatusDotTone,
} from '@/lib/session-status';
import { doesSessionPrefillMatchProject } from '@/lib/session-prefill';
import { notifySessionsUpdated, subscribeToSessionsUpdated } from '@/lib/session-updates';
import { consumePendingSessionNavigationRetry, recordPendingSessionNavigation } from '@/lib/session-navigation';
import { uploadAttachments } from '@/lib/upload-attachments';
import {
  type ActiveMention,
  findActiveMention,
  replaceActiveMention,
} from '@/lib/task-description-mentions';
import { hasStartupTaskDescription } from '@/lib/agent-startup-prompt';
import { normalizeProviderReasoningEffort } from '@/lib/agent/reasoning';
import { getEffectiveProjectAgentRuntimeSettings } from '@/lib/project-agent-runtime';
import {
  resolveShouldUseDarkTheme,
  THEME_MODE_STORAGE_KEY,
  THEME_REFRESH_EVENT,
} from '@/lib/ttyd-theme';
import { SESSION_MOBILE_VIEWPORT_QUERY } from '@/lib/responsive';
import { shouldUseDeviceFilePicker } from '@/lib/url';
import { useAppDialog } from '@/hooks/use-app-dialog';
import { useAgentStatus } from '@/hooks/use-agent-status';
import {
  APP_PAGE_PANEL_CLASS,
  APP_PAGE_TOOLBAR_CLASS,
} from '@/components/app-shell/AppPageSurface';
import { useDialogKeyboardShortcuts } from '@/hooks/useDialogKeyboardShortcuts';
import { useProjects } from '@/hooks/use-git';
import {
  getQueryCacheState,
  queryKeys,
} from '@/lib/query-cache';
import SessionFileBrowser from './SessionFileBrowser';
import { HomeDashboard } from './git-repo-selector/HomeDashboard';
import { RepoSettingsDialog } from './git-repo-selector/RepoSettingsDialog';
import { CloneRemoteDialog } from './git-repo-selector/CloneRemoteDialog';
import { type RepoCredentialSelection } from './git-repo-selector/types';
import { cn } from '@/lib/utils';
import { type ProjectIconValue } from '@/lib/project-icons';
import type {
  AgentProvider,
  AppStatus,
  ModelOption,
  Project,
  ProviderCatalogEntry,
  ReasoningEffort,
  SessionWorkspacePreference,
} from '@/lib/types';

type SessionMode = 'fast' | 'plan';
type ThemeMode = 'auto' | 'light' | 'dark';
const DEFAULT_PROJECT_STARTUP_COMMAND = '';
const DEFAULT_PROJECT_DEV_SERVER_COMMAND = '';
const DEFAULT_PROJECT_SERVICE_START_COMMAND = '';
const DEFAULT_PROJECT_SERVICE_STOP_COMMAND = '';
const THEME_MODE_SEQUENCE: ThemeMode[] = ['auto', 'light', 'dark'];
const HOME_REPO_DISCOVERY_IDLE_TIMEOUT_MS = 4000;
const HOME_REPO_DISCOVERY_MAX_AUTOSTART = 3;

const SESSION_MODE_STORAGE_KEY = 'viba:new-session-mode';
const SESSION_TITLE_MAX_LENGTH = 120;
const COMPACT_TASK_HEADER_THRESHOLD_PX = 1024;
const STACKED_TASK_HEADER_THRESHOLD_PX = 960;
const HOME_PROJECT_SORT_STORAGE_KEY = 'palx-home-project-sort';
const LIVE_PROJECT_GIT_REPOS_STALE_TIME_MS = 0;
const SUPPORTED_AGENT_PROVIDERS = ['codex', 'gemini', 'cursor'] as const;
const AGENT_PROVIDER_FALLBACK_LABELS: Record<string, string> = {
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  cursor: 'Cursor Agent CLI',
};
function readIsDocumentForegrounded(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState === 'visible' && document.hasFocus();
}

type PredefinedPrompt = {
  id: string;
  group: string;
  label: string;
  content: string;
};

type WorkspacePreparationState = {
  preparationId: string;
  contextFingerprint: string;
  projectPath: string;
  expiresAt: string;
};

type AgentModelCatalogCacheEntry = {
  models: ModelOption[];
  defaultModel: string | null;
  updatedAt: string;
};

type GitRepoSelectorProps = {
  mode?: 'home' | 'new';
  projectPath?: string | null;
  repoPath?: string | null;
  fromRepoName?: string | null;
  prefillFromSession?: string | null;
  predefinedPrompts?: PredefinedPrompt[];
  showLogout?: boolean;
  logoutEnabled?: boolean;
};

function deriveSessionTitleFromTaskDescription(taskDescription: string): string | undefined {
  const firstNonEmptyLine = taskDescription
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstNonEmptyLine) return undefined;
  return firstNonEmptyLine.slice(0, SESSION_TITLE_MAX_LENGTH);
}

function normalizePathForComparison(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').replace(/\/+$/, '');
}

function looksLikeAbsolutePath(pathValue: string | null | undefined): boolean {
  if (!pathValue) return false;
  return /^(?:[a-zA-Z]:[\\/]|\/)/.test(pathValue);
}

function toProjectRelativeRepoPath(projectPath: string, repoPath: string): string {
  const normalizedProjectPath = normalizePathForComparison(projectPath);
  const normalizedRepoPath = normalizePathForComparison(repoPath);

  if (!normalizedProjectPath || !normalizedRepoPath) return repoPath;
  if (normalizedRepoPath === normalizedProjectPath) return '.';

  const projectPrefix = `${normalizedProjectPath}/`;
  if (normalizedRepoPath.startsWith(projectPrefix)) {
    return normalizedRepoPath.slice(projectPrefix.length);
  }

  return repoPath;
}

function arePathListsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function readStoredHomeProjectSort(): HomeProjectSort | null {
  if (typeof window === 'undefined') return null;
  try {
    const storedSort = window.localStorage.getItem(HOME_PROJECT_SORT_STORAGE_KEY);
    if (!storedSort) return null;
    return normalizeHomeProjectSort(storedSort);
  } catch {
    return null;
  }
}

function writeStoredHomeProjectSort(nextSort: HomeProjectSort): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HOME_PROJECT_SORT_STORAGE_KEY, nextSort);
  } catch {
    // Ignore localStorage access errors.
  }
}

function buildWorkspacePreparationInputKey(
  projectPath: string,
  gitContexts: SessionCreateGitContextInput[],
  workspacePreference: SessionWorkspacePreference,
): string {
  return JSON.stringify({
    projectPath: normalizePathForComparison(projectPath),
    workspacePreference,
    gitContexts: gitContexts
      .map((context) => ({
        repoPath: normalizePathForComparison(context.repoPath),
        baseBranch: (context.baseBranch || '').trim(),
      }))
      .sort((left, right) => left.repoPath.localeCompare(right.repoPath)),
  });
}

function getClipboardImageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];

  const files: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) {
      files.push(file);
    }
  }
  return files;
}

type AgentStatusResponse = {
  providers: ProviderCatalogEntry[];
  defaultProvider: AgentProvider;
  status: AppStatus | null;
  error?: string;
};

type AgentLoginResponse =
  | {
      kind: 'browser';
      authUrl: string;
      loginId?: string | null;
      message?: string | null;
    }
  | {
      kind: 'pending';
      loginId?: string | null;
      message: string;
    };

function normalizeAgentProvider(value: string | null | undefined): AgentProvider {
  return value === 'codex' || value === 'gemini' || value === 'cursor' ? value : 'codex';
}

function agentProviderLabel(provider: string, providers: ProviderCatalogEntry[] = []): string {
  return providers.find((entry) => entry.id === provider)?.label
    || AGENT_PROVIDER_FALLBACK_LABELS[provider]
    || provider;
}

function normalizeReasoningSelection(value: string): ReasoningEffort | undefined {
  const normalized = value.trim();
  return normalized ? normalized as ReasoningEffort : undefined;
}

function normalizeProviderReasoningSelection(
  provider: AgentProvider,
  value: string,
): ReasoningEffort | undefined {
  return normalizeProviderReasoningEffort(provider, normalizeReasoningSelection(value));
}

function normalizeModelOption(input: unknown): ModelOption | null {
  if (!input || typeof input !== 'object') return null;

  const candidate = input as {
    id?: unknown;
    label?: unknown;
    description?: unknown;
    reasoningEfforts?: unknown;
  };
  if (typeof candidate.id !== 'string') return null;

  const id = candidate.id.trim();
  if (!id) return null;

  const label = typeof candidate.label === 'string' && candidate.label.trim()
    ? candidate.label.trim()
    : id;
  const description = typeof candidate.description === 'string'
    ? candidate.description
    : null;
  const reasoningEfforts = Array.isArray(candidate.reasoningEfforts)
    ? candidate.reasoningEfforts.filter((value): value is ReasoningEffort => (
      typeof value === 'string' && value.trim().length > 0
    ))
    : undefined;

  return {
    id,
    label,
    description,
    reasoningEfforts,
  };
}

function areMentionsEqual(left: ActiveMention | null, right: ActiveMention | null): boolean {
  if (!left || !right) return left === right;
  return left.trigger === right.trigger
    && left.start === right.start
    && left.end === right.end
    && left.query === right.query;
}

export default function GitRepoSelector({
  mode = 'home',
  projectPath = null,
  repoPath: legacyRepoPath = null,
  fromRepoName = null,
  prefillFromSession = null,
  predefinedPrompts = [],
  showLogout = false,
  logoutEnabled = true,
}: GitRepoSelectorProps) {
  const queryClient = useQueryClient();
  const repoPath = projectPath ?? legacyRepoPath;
  const { data: projects = [] } = useProjects();
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [isSelectingRoot, setIsSelectingRoot] = useState(false);
  const [isRepoSettingsDialogOpen, setIsRepoSettingsDialogOpen] = useState(false);
  const [isCloneRemoteDialogOpen, setIsCloneRemoteDialogOpen] = useState(false);
  const { confirm: confirmDialog, dialog: appDialog } = useAppDialog();
  const [remoteRepoUrl, setRemoteRepoUrl] = useState('');
  const [cloneCredentialSelection, setCloneCredentialSelection] = useState<RepoCredentialSelection>('auto');
  const [cloneRemoteError, setCloneRemoteError] = useState<string | null>(null);
  const [isCloningRemote, setIsCloningRemote] = useState(false);
  const [isLoadingCloneCredentialOptions, setIsLoadingCloneCredentialOptions] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>('auto');
  const [isDarkThemeActive, setIsDarkThemeActive] = useState(false);
  const [isPageForegrounded, setIsPageForegrounded] = useState<boolean>(() => readIsDocumentForegrounded());

  const [config, setConfig] = useState<Config | null>(null);

  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [homeDirectoryPath, setHomeDirectoryPath] = useState<string | null>(null);
  const [repoForSettings, setRepoForSettings] = useState<string | null>(null);
  const [repoAlias, setRepoAlias] = useState<string>('');
  const [repoStartupCommand, setRepoStartupCommand] = useState<string>(DEFAULT_PROJECT_STARTUP_COMMAND);
  const [repoDevServerCommand, setRepoDevServerCommand] = useState<string>(DEFAULT_PROJECT_DEV_SERVER_COMMAND);
  const [repoServiceStartCommand, setRepoServiceStartCommand] = useState<string>(DEFAULT_PROJECT_SERVICE_START_COMMAND);
  const [repoServiceStopCommand, setRepoServiceStopCommand] = useState<string>(DEFAULT_PROJECT_SERVICE_STOP_COMMAND);
  const [projectIconForSettings, setProjectIconForSettings] = useState<ProjectIconValue>({ iconPath: null, iconEmoji: null });
  const [credentialOptions, setCredentialOptions] = useState<Credential[]>([]);

  const router = useRouter();

  const resolveProjectEntry = useCallback((projectReference: string) => (
    resolveClientProjectReference(projects, projectReference)
  ), [projects]);

  const [currentBranchName, setCurrentBranchName] = useState<string>('');
  const [projectGitRepos, setProjectGitRepos] = useState<string[]>([]);
  const [branchesByRepo, setBranchesByRepo] = useState<Record<string, GitBranch[]>>({});
  const [baseBranchByRepo, setBaseBranchByRepo] = useState<Record<string, string>>({});
  const [isLoadingProjectGitRepos, setIsLoadingProjectGitRepos] = useState(false);
  const [isProjectGitReposTruncated, setIsProjectGitReposTruncated] = useState(false);
  const [isLoadingProjectActivity, setIsLoadingProjectActivity] = useState(false);
  const [existingSessions, setExistingSessions] = useState<SessionMetadata[]>([]);
  const [allSessions, setAllSessions] = useState<SessionMetadata[]>([]);
  const [existingDrafts, setExistingDrafts] = useState<DraftMetadata[]>([]);
  const [allDrafts, setAllDrafts] = useState<DraftMetadata[]>([]);

  const [startupScript, setStartupScript] = useState<string>('');
  const [devServerScript, setDevServerScript] = useState<string>('');
  const [showSessionAdvanced, setShowSessionAdvanced] = useState(false);
  const [initialMessage, setInitialMessage] = useState<string>('');
  const [sessionMode, setSessionMode] = useState<SessionMode>('fast');
  const [sessionWorkspacePreference, setSessionWorkspacePreference] = useState<SessionWorkspacePreference>('workspace');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [isPastingTaskAttachments, setIsPastingTaskAttachments] = useState(false);
  const [isUploadingTaskAttachments, setIsUploadingTaskAttachments] = useState(false);
  const [isAttachmentBrowserOpen, setIsAttachmentBrowserOpen] = useState(false);
  const [lastAttachmentBrowserPath, setLastAttachmentBrowserPath] = useState<string>('');
  const [prefilledAttachmentPaths, setPrefilledAttachmentPaths] = useState<string[]>([]);
  const [hasAppliedPrefill, setHasAppliedPrefill] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  const [loading, setLoading] = useState(false);
  const [deletingSessionName, setDeletingSessionName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isResolvingRepoFromName, setIsResolvingRepoFromName] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [agentProviders, setAgentProviders] = useState<ProviderCatalogEntry[]>([]);
  const [selectedAgentProvider, setSelectedAgentProvider] = useState<AgentProvider>('codex');
  const [selectedAgentModel, setSelectedAgentModel] = useState('');
  const [cachedAgentModelCatalogs, setCachedAgentModelCatalogs] = useState<Record<string, AgentModelCatalogCacheEntry>>({});
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<ReasoningEffort | ''>('');
  const [agentStatus, setAgentStatus] = useState<AppStatus | null>(null);
  const [isLoadingAgentStatus, setIsLoadingAgentStatus] = useState(false);
  const [isInstallingAgentProvider, setIsInstallingAgentProvider] = useState(false);
  const [installingAgentProvider, setInstallingAgentProvider] = useState<AgentProvider | null>(null);
  const [installLogs, setInstallLogs] = useState<string[]>([]);
  const [agentSetupMessage, setAgentSetupMessage] = useState<string | null>(null);
  const [isWaitingForLogin, setIsWaitingForLogin] = useState(false);
  const [waitingForLoginProvider, setWaitingForLoginProvider] = useState<AgentProvider | null>(null);
  const [isCompactTaskHeader, setIsCompactTaskHeader] = useState(false);
  const [isStackedTaskHeader, setIsStackedTaskHeader] = useState(false);
  const [homeSearchQuery, setHomeSearchQuery] = useState('');
  const [homeProjectSort, setHomeProjectSort] = useState<HomeProjectSort>(() => (
    readStoredHomeProjectSort() ?? DEFAULT_HOME_PROJECT_SORT
  ));
  const [repoSettingsError, setRepoSettingsError] = useState<string | null>(null);
  const [isUploadingProjectIcon, setIsUploadingProjectIcon] = useState(false);
  const [isSavingRepoSettings, setIsSavingRepoSettings] = useState(false);
  const [repoCardIconByRepo, setRepoCardIconByRepo] = useState<Record<string, ProjectIconValue>>({});
  const [brokenRepoCardIcons, setBrokenRepoCardIcons] = useState<Record<string, boolean>>({});
  const [projectGitReposByPath, setProjectGitReposByPath] = useState<Record<string, HomeProjectGitRepo[]>>({});
  const [discoveringHomeProjectGitRepos, setDiscoveringHomeProjectGitRepos] = useState<Record<string, boolean>>({});
  const [homeProjectGitSelector, setHomeProjectGitSelector] = useState<{
    projectPath: string;
    repos: HomeProjectGitRepo[];
  } | null>(null);
  const repoCardIconResolutionsInFlightRef = useRef<Set<string>>(new Set());
  const selectedProjectLoadRequestRef = useRef(0);
  const pendingProjectRouteSyncRef = useRef<string | null>(null);

  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const sessionNavigationCommittedRef = useRef(false);
  const agentRuntimeSettingsRequestRef = useRef(0);
  const hydratedAgentRuntimeRepoRef = useRef<string | null>(null);
  const [preparedWorkspace, setPreparedWorkspace] = useState<WorkspacePreparationState | null>(null);
  const [isPreparingWorkspace, setIsPreparingWorkspace] = useState(false);
  const activePreparedWorkspaceRef = useRef<WorkspacePreparationState | null>(null);
  const workspacePreparationInputKeyRef = useRef<string | null>(null);
  const workspacePreparationRequestRef = useRef(0);
  const preparedWorkspaceStartupSyncRequestRef = useRef(0);
  const ttydWarmupStartedRef = useRef(false);
  const latestStartupScriptRef = useRef('');
  const latestSelectedAgentProviderRef = useRef<AgentProvider>('codex');
  const latestSelectedRepoRef = useRef<string | null>(null);
  const latestTaskDescriptionRef = useRef('');
  const latestCursorPositionRef = useRef(0);
  const taskDescriptionPanelRef = useRef<HTMLDivElement | null>(null);
  const mobileAttachmentInputRef = useRef<HTMLInputElement | null>(null);

  const selectedProjectActivityQuery = useQuery({
    queryKey: selectedRepo ? queryKeys.projectActivity(selectedRepo) : ['project', 'activity', 'idle'],
    queryFn: async () => getProjectActivity(selectedRepo!),
    enabled: mode === 'new' && !!selectedRepo,
    meta: { persist: true },
    placeholderData: (previousData) => previousData,
    staleTime: 15_000,
  });
  const selectedProjectGitReposQuery = useQuery({
    queryKey: selectedRepo ? queryKeys.projectGitRepos(selectedRepo) : ['project', 'git-repos', 'idle'],
    queryFn: async () => discoverProjectGitReposWithBranches(selectedRepo!),
    enabled: mode === 'new' && !!selectedRepo,
    staleTime: LIVE_PROJECT_GIT_REPOS_STALE_TIME_MS,
    refetchOnMount: 'always',
  });
  const selectedAgentStatusQuery = useAgentStatus(selectedAgentProvider, {
    enabled: mode !== 'new' || Boolean(selectedRepo),
    staleTime: 60_000,
  });
  const selectedProjectActivityCacheState = getQueryCacheState(selectedProjectActivityQuery);
  const selectedProjectGitReposCacheState = getQueryCacheState(selectedProjectGitReposQuery);
  const selectedAgentStatusCacheState = getQueryCacheState(selectedAgentStatusQuery);

  const collapsedSessionSetupLabel = 'Show Session Setup';

  const notifySessionsChanged = useCallback(() => {
    notifySessionsUpdated();
  }, []);

  const isActiveSelectedProjectLoad = useCallback((requestId: number) => {
    return selectedProjectLoadRequestRef.current === requestId;
  }, []);

  const resetSelectedProjectState = useCallback((projectPath: string) => {
    const cachedActivity = queryClient.getQueryData<Awaited<ReturnType<typeof getProjectActivity>>>(
      queryKeys.projectActivity(projectPath),
    );

    hydratedAgentRuntimeRepoRef.current = null;
    setSelectedRepo(projectPath);
    setSelectedProjectId(null);
    setRepoFilesCache([]);
    setProjectGitRepos([]);
    setBranchesByRepo({});
    setBaseBranchByRepo({});
    setCurrentBranchName('');
    setIsProjectGitReposTruncated(false);
    setIsLoadingProjectGitRepos(true);
    setIsLoadingProjectActivity(!cachedActivity);
    setExistingSessions(cachedActivity?.sessions ?? []);
    setExistingDrafts(cachedActivity?.drafts ?? []);
    setStartupScript('');
    setDevServerScript('');
  }, [queryClient]);

  const beginSelectedProjectLoad = useCallback((projectPath: string) => {
    const requestId = selectedProjectLoadRequestRef.current + 1;
    selectedProjectLoadRequestRef.current = requestId;
    resetSelectedProjectState(projectPath);
    return requestId;
  }, [resetSelectedProjectState]);

  const navigateToSession = useCallback((sessionName: string) => {
    const targetPath = `/session/${encodeURIComponent(sessionName)}`;
    sessionNavigationCommittedRef.current = true;
    recordPendingSessionNavigation(sessionName);
    // Use a hard navigation here. App Router transitions out of /new can be interrupted
    // by pending server actions and iframe teardown, which can briefly land on /session
    // and then snap back to /new. A full replace avoids that rollback path.
    window.location.replace(targetPath);
  }, []);

  const setPreparedWorkspaceState = useCallback((next: WorkspacePreparationState | null) => {
    activePreparedWorkspaceRef.current = next;
    setPreparedWorkspace(next);
  }, []);

  const releasePreparedWorkspaceById = useCallback(async (preparationId: string) => {
    const normalizedPreparationId = preparationId.trim();
    if (!normalizedPreparationId) return;

    try {
      await releasePreparedSessionWorkspace(normalizedPreparationId);
    } catch (releaseError) {
      console.error(`Failed to release prepared workspace ${normalizedPreparationId}:`, releaseError);
    }
  }, []);

  const releaseActivePreparedWorkspace = useCallback(async () => {
    const currentPreparation = activePreparedWorkspaceRef.current;
    if (!currentPreparation) return;

    setPreparedWorkspaceState(null);
    workspacePreparationInputKeyRef.current = null;
    await releasePreparedWorkspaceById(currentPreparation.preparationId);
  }, [releasePreparedWorkspaceById, setPreparedWorkspaceState]);

  const refreshSessionData = useCallback(async (
    repo: string | null = selectedRepo,
    options?: { includeGlobal?: boolean },
    selectedProjectRequestId?: number,
  ) => {
    const includeGlobal = options?.includeGlobal ?? mode === 'home';
    const isProjectScopedLoad = !includeGlobal && Boolean(repo);

    try {
      if (!includeGlobal && repo) {
        const activity = await queryClient.fetchQuery({
          queryKey: queryKeys.projectActivity(repo),
          queryFn: () => getProjectActivity(repo),
          meta: { persist: true },
          staleTime: 15_000,
        });
        if (
          selectedProjectRequestId !== undefined
          && !isActiveSelectedProjectLoad(selectedProjectRequestId)
        ) {
          return;
        }
        setExistingSessions(activity.sessions);
        setExistingDrafts(activity.drafts);
        return;
      }

      const [allSess, repoSess, allD, repoD] = await Promise.all([
        includeGlobal ? listSessions() : Promise.resolve(null),
        repo ? listSessions(repo) : Promise.resolve([] as SessionMetadata[]),
        includeGlobal ? listDrafts() : Promise.resolve(null),
        repo ? listDrafts(repo) : Promise.resolve([] as DraftMetadata[]),
      ]);

      if (allSess) {
        setAllSessions(allSess);
      }
      if (allD) {
        setAllDrafts(allD);
      }
      if (repo) {
        if (
          selectedProjectRequestId !== undefined
          && !isActiveSelectedProjectLoad(selectedProjectRequestId)
        ) {
          return;
        }
        setExistingSessions(repoSess);
        setExistingDrafts(repoD);
      }
    } catch (e) {
      console.error('Failed to refresh sessions and drafts', e);
    } finally {
      if (
        isProjectScopedLoad
        && (
          selectedProjectRequestId === undefined
          || isActiveSelectedProjectLoad(selectedProjectRequestId)
        )
      ) {
        setIsLoadingProjectActivity(false);
      }
    }
  }, [isActiveSelectedProjectLoad, mode, queryClient, selectedRepo]);

  const dismissRepoSettingsDialog = useCallback(() => {
    if (isSavingRepoSettings) return;
    setIsRepoSettingsDialogOpen(false);
    setRepoForSettings(null);
    setRepoStartupCommand(DEFAULT_PROJECT_STARTUP_COMMAND);
    setRepoDevServerCommand(DEFAULT_PROJECT_DEV_SERVER_COMMAND);
    setRepoServiceStartCommand(DEFAULT_PROJECT_SERVICE_START_COMMAND);
    setRepoServiceStopCommand(DEFAULT_PROJECT_SERVICE_STOP_COMMAND);
    setProjectIconForSettings({ iconPath: null, iconEmoji: null });
    setRepoSettingsError(null);
    setIsUploadingProjectIcon(false);
  }, [isSavingRepoSettings]);

  const openCloneRemoteDialog = useCallback(() => {
    setIsCloneRemoteDialogOpen(true);
    setRemoteRepoUrl('');
    setCloneCredentialSelection('auto');
    setCloneRemoteError(null);
    setIsLoadingCloneCredentialOptions(true);

    void (async () => {
      try {
        const result = await listCredentials();
        if (!result.success) {
          setCloneRemoteError(result.error);
          return;
        }

        setCredentialOptions(result.credentials);
      } catch (error) {
        console.error(error);
        setCloneRemoteError('Failed to load credentials.');
      } finally {
        setIsLoadingCloneCredentialOptions(false);
      }
    })();
  }, []);

  const dismissCloneRemoteDialog = useCallback(() => {
    if (isCloningRemote) return;
    setIsCloneRemoteDialogOpen(false);
    setRemoteRepoUrl('');
    setCloneCredentialSelection('auto');
    setCloneRemoteError(null);
    setIsLoadingCloneCredentialOptions(false);
  }, [isCloningRemote]);

  // Load home dashboard data on mount. The /new route loads project-specific data lazily.
  useEffect(() => {
    if (mode !== 'home') {
      setIsLoaded(true);
      return;
    }

    let cancelled = false;

    const loadData = async () => {
      try {
        const [cfg, sessions, drafts] = await Promise.all([
          getConfig(),
          listSessions(),
          listDrafts(),
        ]);
        if (cancelled) return;
        setConfig(cfg);
        setHomeProjectSort(readStoredHomeProjectSort() ?? cfg.homeProjectSort);
        setAllSessions(sessions);
        setAllDrafts(drafts);
      } catch (e) {
        console.error('Failed to load data', e);
      } finally {
        if (!cancelled) {
          setIsLoaded(true);
        }
      }
    };
    void loadData();

    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    try {
      const storedMode = window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
      if (storedMode === 'light' || storedMode === 'dark' || storedMode === 'auto') {
        setThemeMode(storedMode);
        return;
      }
    } catch {
      // Ignore localStorage errors and keep default theme mode.
    }
    setThemeMode('auto');
  }, []);

  useEffect(() => {
    const syncForegroundState = () => {
      setIsPageForegrounded(readIsDocumentForegrounded());
    };

    syncForegroundState();
    document.addEventListener('visibilitychange', syncForegroundState);
    window.addEventListener('focus', syncForegroundState);
    window.addEventListener('blur', syncForegroundState);

    return () => {
      document.removeEventListener('visibilitychange', syncForegroundState);
      window.removeEventListener('focus', syncForegroundState);
      window.removeEventListener('blur', syncForegroundState);
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const applyThemeMode = () => {
      const shouldUseDark = resolveShouldUseDarkTheme(themeMode, mediaQuery.matches);
      document.documentElement.classList.toggle('dark', shouldUseDark);
      document.documentElement.dataset.themeMode = themeMode;
      setIsDarkThemeActive(shouldUseDark);
    };

    applyThemeMode();

    try {
      window.localStorage.setItem(THEME_MODE_STORAGE_KEY, themeMode);
    } catch {
      // Ignore localStorage errors.
    }
    window.dispatchEvent(new Event(THEME_REFRESH_EVENT));

    if (themeMode !== 'auto') {
      return;
    }

    const handleThemeChange = () => {
      applyThemeMode();
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleThemeChange);
      return () => {
        mediaQuery.removeEventListener('change', handleThemeChange);
      };
    }

    mediaQuery.addListener(handleThemeChange);
    return () => {
      mediaQuery.removeListener(handleThemeChange);
    };
  }, [themeMode]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(SESSION_MOBILE_VIEWPORT_QUERY);
    const applyViewportMode = () => {
      setIsMobileViewport(mediaQuery.matches);
    };

    applyViewportMode();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', applyViewportMode);
      return () => {
        mediaQuery.removeEventListener('change', applyViewportMode);
      };
    }

    mediaQuery.addListener(applyViewportMode);
    return () => {
      mediaQuery.removeListener(applyViewportMode);
    };
  }, []);

  useEffect(() => {
    if (mode !== 'new') return;

    try {
      const storedMode = window.localStorage.getItem(SESSION_MODE_STORAGE_KEY);
      if (storedMode === 'fast' || storedMode === 'plan') {
        setSessionMode(storedMode);
      }
    } catch {
      // Ignore localStorage errors.
    }
  }, [mode]);

  useEffect(() => {
    if (mode === 'new' && !selectedRepo) {
      return;
    }

    const refresh = () => {
      const repoForList = mode === 'new' ? selectedRepo : null;
      void refreshSessionData(repoForList, { includeGlobal: mode === 'home' });
    };

    const unsubscribeSessionsUpdated = subscribeToSessionsUpdated(refresh);
    if (mode === 'home') {
      refresh();
    }

    return () => {
      unsubscribeSessionsUpdated();
    };
  }, [mode, refreshSessionData, selectedRepo]);

  useEffect(() => {
    if (!selectedProjectActivityQuery.data) return;
    setExistingSessions(selectedProjectActivityQuery.data.sessions);
    setExistingDrafts(selectedProjectActivityQuery.data.drafts);
    setIsLoadingProjectActivity(false);
  }, [selectedProjectActivityQuery.data]);

  useEffect(() => {
    if (!selectedProjectGitReposQuery.data) return;
    if (!selectedProjectGitReposQuery.isFetchedAfterMount && selectedProjectGitReposQuery.isFetching) {
      return;
    }

    const repoPaths = selectedProjectGitReposQuery.data.repos.map((repo) => repo.repoPath);
    const nextBranchesByRepo: Record<string, GitBranch[]> = {};
    const nextBaseBranchByRepo: Record<string, string> = {};
    for (const repoPath of repoPaths) {
      const repoBranches = selectedProjectGitReposQuery.data.branchesByRepo[repoPath] ?? [];
      nextBranchesByRepo[repoPath] = repoBranches;
      const currentBranch = repoBranches.find((branch) => branch.current)?.name;
      if (currentBranch) {
        nextBaseBranchByRepo[repoPath] = currentBranch;
      } else if (repoBranches[0]?.name) {
        nextBaseBranchByRepo[repoPath] = repoBranches[0].name;
      }
    }

    setProjectGitRepos(repoPaths);
    setBranchesByRepo(nextBranchesByRepo);
    setBaseBranchByRepo(nextBaseBranchByRepo);
    setIsProjectGitReposTruncated(selectedProjectGitReposQuery.data.truncated);
    setCurrentBranchName(repoPaths[0] ? (nextBaseBranchByRepo[repoPaths[0]] || '') : '');
    setIsLoadingProjectGitRepos(false);
  }, [
    selectedProjectGitReposQuery.data,
    selectedProjectGitReposQuery.isFetchedAfterMount,
    selectedProjectGitReposQuery.isFetching,
  ]);

  useEffect(() => {
    const payload = selectedAgentStatusQuery.data;
    if (!payload) return;

    const supportedProviders = payload.providers.filter((entry) => (
      entry.available
      && (entry.id === 'codex' || entry.id === 'gemini' || entry.id === 'cursor')
    ));
    setAgentProviders(supportedProviders);
    setAgentStatus(payload.status);
    if (payload.status) {
      setCachedAgentModelCatalogs((previous) => ({
        ...previous,
        [payload.status!.provider]: {
          models: payload.status!.models,
          defaultModel: payload.status!.defaultModel,
          updatedAt: new Date().toISOString(),
        },
      }));
    }
    if (payload.error) {
      setAgentSetupMessage(payload.error);
    }
    setIsLoadingAgentStatus(false);
  }, [selectedAgentStatusQuery.data]);

  useEffect(() => {
    if (!selectedAgentStatusQuery.error) return;
    setIsLoadingAgentStatus(false);
    setAgentSetupMessage(
      selectedAgentStatusQuery.error instanceof Error
        ? selectedAgentStatusQuery.error.message
        : 'Failed to load agent runtime status.',
    );
  }, [selectedAgentStatusQuery.error]);

  const loadProjectGitRepos = async (projectPath: string, selectedProjectRequestId?: number) => {
    setIsLoadingProjectGitRepos(true);
    try {
      const discovery = await queryClient.fetchQuery({
        queryKey: queryKeys.projectGitRepos(projectPath),
        queryFn: () => discoverProjectGitReposWithBranches(projectPath),
        staleTime: LIVE_PROJECT_GIT_REPOS_STALE_TIME_MS,
      });
      if (
        selectedProjectRequestId !== undefined
        && !isActiveSelectedProjectLoad(selectedProjectRequestId)
      ) {
        return;
      }
      const repoPaths = discovery.repos.map((repo) => repo.repoPath);
      setProjectGitRepos(repoPaths);
      setIsProjectGitReposTruncated(discovery.truncated);

      const nextBranchesByRepo: Record<string, GitBranch[]> = {};
      const nextBaseBranchByRepo: Record<string, string> = {};
      for (const repoPath of repoPaths) {
        const repoBranches = discovery.branchesByRepo[repoPath] ?? [];
        nextBranchesByRepo[repoPath] = repoBranches;
        const currentBranch = repoBranches.find((branch) => branch.current)?.name;
        if (currentBranch) {
          nextBaseBranchByRepo[repoPath] = currentBranch;
        } else if (repoBranches[0]?.name) {
          nextBaseBranchByRepo[repoPath] = repoBranches[0].name;
        }
      }

      setBranchesByRepo(nextBranchesByRepo);
      setBaseBranchByRepo(nextBaseBranchByRepo);

      const primaryRepo = repoPaths[0] || '';
      setCurrentBranchName(primaryRepo ? (nextBaseBranchByRepo[primaryRepo] || '') : '');
    } catch (loadError) {
      if (
        selectedProjectRequestId !== undefined
        && !isActiveSelectedProjectLoad(selectedProjectRequestId)
      ) {
        return;
      }
      console.error('Failed to discover project git repositories:', loadError);
      setProjectGitRepos([]);
      setBranchesByRepo({});
      setBaseBranchByRepo({});
      setCurrentBranchName('');
      setIsProjectGitReposTruncated(false);
    } finally {
      if (
        selectedProjectRequestId === undefined
        || isActiveSelectedProjectLoad(selectedProjectRequestId)
      ) {
        setIsLoadingProjectGitRepos(false);
      }
    }
  };

  const loadSelectedRepoData = async (
    path: string,
    resolvedConfig?: Config,
    selectedProjectRequestId?: number,
    projectSettingsKey?: string,
  ) => {
    // Load saved session scripts
    await loadSavedAgentSettings(
      path,
      resolvedConfig,
      selectedProjectRequestId,
      projectSettingsKey,
    );
    if (
      selectedProjectRequestId !== undefined
      && !isActiveSelectedProjectLoad(selectedProjectRequestId)
    ) {
      return;
    }

    await Promise.all([
      loadProjectGitRepos(path, selectedProjectRequestId),
      refreshSessionData(path, { includeGlobal: false }, selectedProjectRequestId),
    ]);
  };

  const resolvedSelectedProject = useMemo(() => (
    selectedRepo ? resolveProjectEntry(selectedRepo) : null
  ), [resolveProjectEntry, selectedRepo]);

  const selectedRepoBasePath = resolvedSelectedProject?.primaryPath ?? selectedRepo;
  const selectedRepoFilesystemPath = resolvedSelectedProject?.primaryPath
    ?? (resolvedSelectedProject?.project && !resolvedSelectedProject.hasAssociatedFolders
      ? homeDirectoryPath
      : (looksLikeAbsolutePath(selectedRepo) ? selectedRepo : null));
  const isFolderlessSelectedProject = Boolean(
    resolvedSelectedProject?.project && !resolvedSelectedProject.hasAssociatedFolders,
  );

  const getRepoDisplayPath = useCallback((repoPath: string, totalRepos: number): string => {
    if (!selectedRepoBasePath) return repoPath;
    if (totalRepos === 1) {
      return resolvedSelectedProject?.displayName || getBaseName(selectedRepoBasePath) || selectedRepoBasePath;
    }
    return toProjectRelativeRepoPath(selectedRepoBasePath, repoPath);
  }, [resolvedSelectedProject?.displayName, selectedRepoBasePath]);

  const selectedProjectGitContexts = useMemo<SessionCreateGitContextInput[]>(() => {
    return projectGitRepos.map((repoPath) => ({
      repoPath,
      baseBranch: baseBranchByRepo[repoPath]?.trim() || undefined,
    }));
  }, [baseBranchByRepo, projectGitRepos]);

  const workspacePreparationInputKey = useMemo(() => {
    if (!selectedRepo || sessionWorkspacePreference !== 'workspace') return null;
    return buildWorkspacePreparationInputKey(
      selectedRepo,
      selectedProjectGitContexts,
      sessionWorkspacePreference,
    );
  }, [selectedProjectGitContexts, selectedRepo, sessionWorkspacePreference]);

  const selectedProjectSettingsReference = selectedProjectId || selectedRepo;

  const ensureProjectRegistered = useCallback(async (projectPath: string): Promise<Project | null> => {
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath, name: getBaseName(projectPath) }),
      });

      if (response.ok) {
        const payload = await response.json().catch(() => null) as Project | null;
        return payload && typeof payload.id === 'string' ? payload : null;
      }

      const payload = await response.json().catch(() => null) as { error?: unknown } | null;
      const errorMessage = typeof payload?.error === 'string' ? payload.error : '';
      if (/already exists/i.test(errorMessage)) return null;
      if (response.status === 500 && !errorMessage) return null;

      console.warn('Failed to ensure project registration:', errorMessage || response.statusText);
    } catch (error) {
      console.warn('Failed to ensure project registration:', error);
    }
    return null;
  }, []);

  const handleSelectRepo = async (
    path: string,
    options?: { navigateToNewInHome?: boolean },
  ) => {
    const resolvedProject = resolveProjectEntry(path);
    const sessionReference = resolvedProject.project?.id ?? resolvedProject.sessionReference ?? path;
    const maybeProjectId = !resolvedProject.project && !looksLikeAbsolutePath(path);

    setLoading(true);
    setError(null);
    const selectedProjectRequestId = mode === 'new'
      ? beginSelectedProjectLoad(sessionReference)
      : undefined;
    try {
      const registeredProject = resolvedProject.project ?? (
        !maybeProjectId && resolvedProject.primaryPath ? await ensureProjectRegistered(resolvedProject.primaryPath) : null
      );
      if (
        selectedProjectRequestId !== undefined
        && !isActiveSelectedProjectLoad(selectedProjectRequestId)
      ) {
        return false;
      }
      setSelectedProjectId(registeredProject?.id ?? resolvedProject.project?.id ?? (maybeProjectId ? path : null));

      const currentConfig = config || await getConfig();
      if (
        selectedProjectRequestId !== undefined
        && !isActiveSelectedProjectLoad(selectedProjectRequestId)
      ) {
        return false;
      }
      if (!config) {
        setConfig(currentConfig);
      }
      const currentRecentProjects = currentConfig.recentProjects ?? currentConfig.recentRepos;
      let newRecent = [...currentRecentProjects];
      if (!newRecent.includes(sessionReference)) {
        newRecent.unshift(sessionReference);
      } else {
        // Move to top
        newRecent = [sessionReference, ...newRecent.filter((projectReference) => projectReference !== sessionReference)];
      }

      const nextConfig = arePathListsEqual(newRecent, currentRecentProjects)
        ? currentConfig
        : await updateConfig({ recentProjects: newRecent });
      if (
        selectedProjectRequestId !== undefined
        && !isActiveSelectedProjectLoad(selectedProjectRequestId)
      ) {
        return false;
      }
      setConfig(nextConfig);

      setIsBrowsing(false);

      if (mode === 'home' && options?.navigateToNewInHome !== false) {
        const params = new URLSearchParams();
        const projectId = registeredProject?.id ?? resolvedProject.project?.id;
        if (projectId) {
          params.set('projectId', projectId);
        } else {
          params.set('project', sessionReference);
        }
        router.push(`/new?${params.toString()}`);
        return true;
      }

      if (mode === 'home') {
        return true;
      }

      await loadSelectedRepoData(
        sessionReference,
        nextConfig,
        selectedProjectRequestId,
        registeredProject?.id ?? resolvedProject.project?.id ?? undefined,
      );
      if (
        selectedProjectRequestId !== undefined
        && !isActiveSelectedProjectLoad(selectedProjectRequestId)
      ) {
        return false;
      }
      return true;
    } catch (err) {
      console.error(err);
      if (
        selectedProjectRequestId === undefined
        || isActiveSelectedProjectLoad(selectedProjectRequestId)
      ) {
        setError('Failed to open project.');
        setIsLoadingProjectGitRepos(false);
        setIsLoadingProjectActivity(false);
      }
      return false;
    } finally {
      if (
        selectedProjectRequestId === undefined
        || isActiveSelectedProjectLoad(selectedProjectRequestId)
      ) {
        setLoading(false);
      }
    }
  };

  const handleCloneRemoteRepo = async () => {
    if (isCloningRemote) return;

    const trimmedRemoteUrl = remoteRepoUrl.trim();
    if (!trimmedRemoteUrl) {
      setCloneRemoteError('Please enter a remote project URL.');
      return;
    }

    setIsCloningRemote(true);
    setCloneRemoteError(null);
    setError(null);

    try {
      const result = await cloneRemoteProject(
        trimmedRemoteUrl,
        cloneCredentialSelection === 'auto' ? null : cloneCredentialSelection,
        config?.defaultRoot ?? null,
      );

      if (!result.success || !result.projectPath) {
        setCloneRemoteError(result.error || 'Failed to clone project.');
        return;
      }

      const opened = await handleSelectRepo(result.projectPath, { navigateToNewInHome: false });
      if (!opened) {
        setCloneRemoteError('Project was cloned, but failed to open it.');
        return;
      }

      setIsCloneRemoteDialogOpen(false);
      setRemoteRepoUrl('');
      setCloneCredentialSelection('auto');
      setCloneRemoteError(null);
    } catch (error) {
      console.error(error);
      setCloneRemoteError('Failed to clone project.');
    } finally {
      setIsCloningRemote(false);
    }
  };

  const handleCurrentRepoChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (mode !== 'new') return;

    const nextRepo = e.target.value;
    if (!nextRepo || nextRepo === selectedRepo) return;

    void releaseActivePreparedWorkspace();
    pendingProjectRouteSyncRef.current = nextRepo;
    const changed = await handleSelectRepo(nextRepo);
    if (!changed) {
      pendingProjectRouteSyncRef.current = null;
      return;
    }
    if (sessionNavigationCommittedRef.current) {
      pendingProjectRouteSyncRef.current = null;
      return;
    }

    const resolvedNextProject = resolveProjectEntry(nextRepo);
    const params = new URLSearchParams();
    if (resolvedNextProject.project?.id) {
      params.set('projectId', resolvedNextProject.project.id);
    } else {
      params.set('project', nextRepo);
    }
    if (prefillFromSession) {
      params.set('prefillFromSession', prefillFromSession);
    }

    router.replace(`/new?${params.toString()}`);
  };

  const handleReturnHome = useCallback(async () => {
    await releaseActivePreparedWorkspace();
    router.push('/');
  }, [releaseActivePreparedWorkspace, router]);

  useEffect(() => {
    if (mode !== 'new') return;

    const pendingNavigation = consumePendingSessionNavigationRetry();
    if (!pendingNavigation) return;
    if (sessionNavigationCommittedRef.current) return;

    sessionNavigationCommittedRef.current = true;
    const nextPath = `/session/${encodeURIComponent(pendingNavigation.sessionName)}`;
    router.replace(nextPath);
  }, [mode, router]);

  useEffect(() => {
    if (mode !== 'new') return;

    if (!repoPath) {
      pendingProjectRouteSyncRef.current = null;
      setSelectedRepo(null);
      setSelectedProjectId(null);
      setExistingSessions([]);
      setCurrentBranchName('');
      setIsLoadingProjectGitRepos(false);
      setIsLoadingProjectActivity(false);
      void releaseActivePreparedWorkspace();
      return;
    }

    const pendingProjectRouteSync = pendingProjectRouteSyncRef.current;
    if (pendingProjectRouteSync) {
      if (repoPath !== pendingProjectRouteSync) {
        return;
      }
      pendingProjectRouteSyncRef.current = null;
    }

    if (repoPath === selectedRepo) return;
    void handleSelectRepo(repoPath);
    // `handleSelectRepo` is intentionally excluded to avoid retriggering from function identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, releaseActivePreparedWorkspace, repoPath, selectedRepo]);

  useEffect(() => {
    if (mode !== 'new' || !selectedRepo) return;
    setLastAttachmentBrowserPath(selectedRepoFilesystemPath || selectedRepo);
  }, [mode, selectedRepo, selectedRepoFilesystemPath]);

  useEffect(() => {
    latestStartupScriptRef.current = startupScript;
  }, [startupScript]);

  useEffect(() => {
    latestSelectedRepoRef.current = selectedRepo;
  }, [selectedRepo]);

  useEffect(() => {
    if (!isFolderlessSelectedProject || homeDirectoryPath) return;

    let cancelled = false;
    void getHomeDirectory().then((homePath) => {
      if (!cancelled) {
        setHomeDirectoryPath(homePath);
      }
    }).catch((homeError) => {
      console.error('Failed to resolve home directory for folderless project:', homeError);
    });

    return () => {
      cancelled = true;
    };
  }, [homeDirectoryPath, isFolderlessSelectedProject]);

  useEffect(() => {
    if (mode !== 'new' || !isFolderlessSelectedProject || sessionWorkspacePreference === 'local') {
      return;
    }

    setSessionWorkspacePreference('local');
  }, [isFolderlessSelectedProject, mode, sessionWorkspacePreference]);

  useEffect(() => {
    latestSelectedAgentProviderRef.current = selectedAgentProvider;
  }, [selectedAgentProvider]);

  useEffect(() => {
    latestTaskDescriptionRef.current = initialMessage;
  }, [initialMessage]);

  useEffect(() => {
    const panelElement = taskDescriptionPanelRef.current;
    if (!panelElement) return;

    const updateCompactState = () => {
      const panelWidth = panelElement.getBoundingClientRect().width;
      const nextIsCompact = panelWidth < COMPACT_TASK_HEADER_THRESHOLD_PX;
      const nextIsStacked = panelWidth < STACKED_TASK_HEADER_THRESHOLD_PX;
      setIsCompactTaskHeader((previous) => (
        previous === nextIsCompact ? previous : nextIsCompact
      ));
      setIsStackedTaskHeader((previous) => (
        previous === nextIsStacked ? previous : nextIsStacked
      ));
    };

    updateCompactState();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateCompactState);
      return () => {
        window.removeEventListener('resize', updateCompactState);
      };
    }

    const observer = new ResizeObserver(() => {
      updateCompactState();
    });
    observer.observe(panelElement);

    return () => {
      observer.disconnect();
    };
  }, [mode, selectedRepo]);

  useEffect(() => {
    if (mode !== 'new') return;
    if (ttydWarmupStartedRef.current) return;
    ttydWarmupStartedRef.current = true;

    void startTtydProcess().catch((warmupError) => {
      console.warn('Failed to prewarm terminal service from /new:', warmupError);
    });
  }, [mode]);

  useEffect(() => {
    if (
      mode !== 'new'
      || sessionWorkspacePreference !== 'workspace'
      || !selectedRepo
      || isLoadingProjectGitRepos
      || !workspacePreparationInputKey
    ) {
      setIsPreparingWorkspace(false);
      return;
    }

    if (
      workspacePreparationInputKeyRef.current === workspacePreparationInputKey
      && activePreparedWorkspaceRef.current?.projectPath === selectedRepo
    ) {
      return;
    }

    let cancelled = false;
    const requestId = workspacePreparationRequestRef.current + 1;
    workspacePreparationRequestRef.current = requestId;
    setIsPreparingWorkspace(true);

    const runPreparation = async () => {
      const result = await prepareSessionWorkspace(selectedRepo, selectedProjectGitContexts, {
        workspacePreference: sessionWorkspacePreference,
      });
      if (cancelled || workspacePreparationRequestRef.current !== requestId) {
        if (result.success && result.preparation) {
          await releasePreparedWorkspaceById(result.preparation.preparationId);
        }
        return;
      }

      if (!result.success || !result.preparation) {
        console.warn('Failed to prepare session workspace:', result.error || 'unknown error');
        setIsPreparingWorkspace(false);
        return;
      }

      const nextPreparation: WorkspacePreparationState = {
        preparationId: result.preparation.preparationId,
        contextFingerprint: result.preparation.contextFingerprint,
        projectPath: result.preparation.projectPath,
        expiresAt: result.preparation.expiresAt,
      };

      const previousPreparation = activePreparedWorkspaceRef.current;
      setPreparedWorkspaceState(nextPreparation);
      workspacePreparationInputKeyRef.current = workspacePreparationInputKey;
      setIsPreparingWorkspace(false);

      if (
        previousPreparation
        && previousPreparation.preparationId !== nextPreparation.preparationId
      ) {
        await releasePreparedWorkspaceById(previousPreparation.preparationId);
      }
    };

    void runPreparation();

    return () => {
      cancelled = true;
    };
  }, [
    isLoadingProjectGitRepos,
    mode,
    releasePreparedWorkspaceById,
    sessionWorkspacePreference,
    selectedProjectGitContexts,
    selectedRepo,
    setPreparedWorkspaceState,
    workspacePreparationInputKey,
  ]);

  useEffect(() => {
    if (mode !== 'new') return;

    const activePreparation = activePreparedWorkspaceRef.current;
    if (!activePreparation) return;

    if (sessionWorkspacePreference !== 'workspace') {
      void releaseActivePreparedWorkspace();
      return;
    }

    const activePreparationInputKey = workspacePreparationInputKeyRef.current;
    if (!activePreparationInputKey || !workspacePreparationInputKey) return;
    if (
      activePreparation.projectPath === selectedRepo
      && activePreparationInputKey === workspacePreparationInputKey
    ) {
      return;
    }

    void releaseActivePreparedWorkspace();
  }, [
    mode,
    releaseActivePreparedWorkspace,
    sessionWorkspacePreference,
    selectedRepo,
    workspacePreparationInputKey,
  ]);

  useEffect(() => {
    if (mode !== 'new' || sessionWorkspacePreference !== 'workspace' || !preparedWorkspace) return;

    const requestId = preparedWorkspaceStartupSyncRequestRef.current + 1;
    preparedWorkspaceStartupSyncRequestRef.current = requestId;
    const preparationId = preparedWorkspace.preparationId;
    const startupSyncTimeout = window.setTimeout(() => {
      void startPreparedSessionWorkspaceStartupCommand(
        preparationId,
        latestStartupScriptRef.current,
        latestSelectedAgentProviderRef.current,
      ).then((result) => {
        if (preparedWorkspaceStartupSyncRequestRef.current !== requestId) {
          return;
        }

        if (!result.success) {
          console.warn('Failed to start prepared workspace startup command:', result.error || 'unknown error');
        }
      });
    }, 400);

    return () => {
      window.clearTimeout(startupSyncTimeout);
    };
  }, [mode, preparedWorkspace, selectedAgentProvider, sessionWorkspacePreference, startupScript]);

  useEffect(() => {
    if (mode !== 'new') return;

    const handlePageHide = () => {
      const currentPreparation = activePreparedWorkspaceRef.current;
      if (!currentPreparation) return;

      const body = JSON.stringify({ preparationId: currentPreparation.preparationId });
      const url = '/api/session-workspace-preparations/release';

      try {
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
          const payload = new Blob([body], { type: 'application/json' });
          if (navigator.sendBeacon(url, payload)) {
            return;
          }
        }
      } catch {
        // Fall back to fetch keepalive.
      }

      void fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body,
        keepalive: true,
      }).catch(() => {});
    };

    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [mode]);

  useEffect(() => {
    return () => {
      const currentPreparation = activePreparedWorkspaceRef.current;
      if (!currentPreparation) return;
      void releasePreparedWorkspaceById(currentPreparation.preparationId);
    };
  }, [releasePreparedWorkspaceById]);

  useEffect(() => {
    if (mode !== 'new') return;
    if (repoPath) {
      setIsResolvingRepoFromName(false);
      return;
    }

    const trimmedFromRepoName = fromRepoName?.trim() ?? '';
    if (!trimmedFromRepoName) {
      setIsResolvingRepoFromName(false);
      return;
    }

    let isCancelled = false;

    const resolveFromRepoName = async () => {
      setError(null);
      setIsResolvingRepoFromName(true);

      const result = await resolveProjectByName(trimmedFromRepoName);
      if (isCancelled) return;

      if (!result.success) {
        setError(result.error || 'Failed to search repositories.');
        setIsResolvingRepoFromName(false);
        return;
      }

      if (!result.projectPath) {
        setError(`Could not find a matching project for "${trimmedFromRepoName}".`);
        setIsResolvingRepoFromName(false);
        return;
      }

      const params = new URLSearchParams();
      if (result.projectId) {
        params.set('projectId', result.projectId);
      } else {
        params.set('project', result.projectPath);
      }
      if (prefillFromSession) {
        params.set('prefillFromSession', prefillFromSession);
      }
      if (sessionNavigationCommittedRef.current) {
        return;
      }
      router.replace(`/new?${params.toString()}`);
    };

    void resolveFromRepoName();

    return () => {
      isCancelled = true;
    };
  }, [fromRepoName, mode, prefillFromSession, repoPath, router]);

  useEffect(() => {
    setHasAppliedPrefill(false);
    setPrefilledAttachmentPaths([]);
  }, [prefillFromSession]);

  useEffect(() => {
    if (mode !== 'new' || !selectedRepo || !prefillFromSession || hasAppliedPrefill) {
      return;
    }

    let isCancelled = false;

    const loadPrefill = async () => {
      const prefillResult = await getSessionPrefillContext(prefillFromSession);
      if (isCancelled) return;

      if (!prefillResult.success || !prefillResult.context) {
        if (prefillResult.error) {
          setError(prefillResult.error);
        }
        setHasAppliedPrefill(true);
        return;
      }

      const context = prefillResult.context;
      if (!doesSessionPrefillMatchProject(context, selectedRepo)) {
        setHasAppliedPrefill(true);
        return;
      }

      setInitialMessage(context.initialMessage || '');
      setPrefilledAttachmentPaths(context.attachmentPaths || []);
      const resolvedProvider = normalizeAgentProvider(context.agentProvider);
      setSelectedAgentProvider(resolvedProvider);
      setSelectedAgentModel(context.model || '');
      setSelectedReasoningEffort(
        normalizeProviderReasoningEffort(resolvedProvider, context.reasoningEffort) || '',
      );
      setShowSessionAdvanced(true);
      setHasAppliedPrefill(true);
    };

    void loadPrefill();

    return () => {
      isCancelled = true;
    };
  }, [hasAppliedPrefill, mode, prefillFromSession, selectedRepo]);

  const loadSavedAgentSettings = async (
    repoPath: string,
    resolvedConfig?: Config,
    selectedProjectRequestId?: number,
    projectSettingsKey?: string,
  ) => {
    // Refresh config to ensure we have latest settings?
    // We can just rely on current config state if we assume single user or minimal concurrency.
    // Or we can refetch.
    const currentConfig = resolvedConfig || config || await getConfig();
    if (
      selectedProjectRequestId !== undefined
      && !isActiveSelectedProjectLoad(selectedProjectRequestId)
    ) {
      return;
    }
    if (!config && currentConfig) setConfig(currentConfig);

    const settingsLookupKey = projectSettingsKey || selectedProjectId || repoPath;
    const effectiveSettings = getEffectiveProjectAgentRuntimeSettings(
      currentConfig,
      settingsLookupKey,
    );
    const settings = effectiveSettings.projectSettings;
    hydratedAgentRuntimeRepoRef.current = repoPath;
    setSelectedAgentProvider(effectiveSettings.provider);
    setSelectedAgentModel(effectiveSettings.model);
    setSelectedReasoningEffort(effectiveSettings.reasoningEffort);

    const savedStartupScript = settings.startupScript;
    const savedDevServerScript = settings.devServerScript;

    if (savedStartupScript !== undefined && savedStartupScript !== null) {
      setStartupScript(savedStartupScript);
    } else {
      setStartupScript('');
    }

    if (savedDevServerScript !== undefined && savedDevServerScript !== null) {
      setDevServerScript(savedDevServerScript);
    } else {
      setDevServerScript('');
    }
  };

  const handleSetDefaultRoot = async (path: string) => {
    const newConfig = await updateConfig({ defaultRoot: path });
    setConfig(newConfig);
    setIsSelectingRoot(false);
  };

  const handleBranchChange = (repoPath: string, newBranch: string) => {
    if (!repoPath) return;
    setBaseBranchByRepo((previous) => ({ ...previous, [repoPath]: newBranch }));

    const primaryRepo = projectGitRepos[0];
    if (primaryRepo === repoPath) {
      setCurrentBranchName(newBranch);
    }
  };

  const handleAgentProviderChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextProvider = normalizeAgentProvider(event.target.value);
    setSelectedAgentProvider(nextProvider);
    setSelectedAgentModel('');
    setSelectedReasoningEffort('');
    setAgentStatus(null);
    setAgentSetupMessage(null);
    setIsWaitingForLogin(false);
    setWaitingForLoginProvider(null);
  };

  const handleAgentModelChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedAgentModel(event.target.value);
  };

  const handleReasoningEffortChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedReasoningEffort(event.target.value as ReasoningEffort | '');
  };

  const handleSessionModeChange = (nextMode: SessionMode) => {
    setSessionMode(nextMode);

    try {
      window.localStorage.setItem(SESSION_MODE_STORAGE_KEY, nextMode);
    } catch {
      // Ignore localStorage errors.
    }
  };

  const handleSessionWorkspacePreferenceChange = (nextPreference: SessionWorkspacePreference) => {
    setSessionWorkspacePreference(nextPreference);
  };

  const handleStartupScriptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const script = e.target.value;
    setStartupScript(script);
    // Debounce saving? Or just save on blur/change?
    // For simplicity, I'll save on change but it triggers server action every keystroke which is bad.
    // Better to save on blur or debounce.
    // Or just save when starting session?
    // The previous code saved on every change to localStorage.
    // Let's rely on saving when starting session? No, we want to persist even if not started.
    // I'll save on blur for now, or just save here and accept the cost.
    // Given the "async" nature, let's just save. But it might be laggy.
    // Actually, let's just update local state here, and use `onBlur` to save.
  };

  const saveStartupScript = async () => {
    if (selectedProjectSettingsReference) {
      const newConfig = await updateProjectSettings(selectedProjectSettingsReference, { startupScript });
      setConfig(newConfig);
    }
  }

  const handleDevServerScriptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDevServerScript(e.target.value);
  };

  const saveDevServerScriptValue = async (script: string) => {
    if (selectedProjectSettingsReference) {
      const newConfig = await updateProjectSettings(selectedProjectSettingsReference, { devServerScript: script });
      setConfig(newConfig);
    }
  };

  const saveDevServerScript = async () => {
    await saveDevServerScriptValue(devServerScript);
  };

  const appendAttachmentPaths = useCallback((incomingPaths: string[]) => {
    if (incomingPaths.length === 0) return;

    setAttachments((prev) => {
      const normalized = incomingPaths.map((entry) => entry.trim()).filter(Boolean);
      return Array.from(new Set([...prev, ...normalized]));
    });
  }, []);

  const handleTaskDescriptionPaste = useCallback(async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!selectedRepoFilesystemPath) return;

    const imageFiles = getClipboardImageFiles(event.clipboardData);
    if (imageFiles.length === 0) return;

    event.preventDefault();
    setError(null);
    setIsPastingTaskAttachments(true);

    try {
      const formData = new FormData();
      const timestamp = Date.now();
      imageFiles.forEach((file, index) => {
        const defaultExtension = file.type.startsWith('image/')
          ? file.type.slice('image/'.length).replace(/[^a-zA-Z0-9]/g, '') || 'png'
          : 'png';
        const normalizedExtension = defaultExtension === 'jpeg' ? 'jpg' : defaultExtension;
        const trimmedName = file.name.trim();
        const hasExtension = trimmedName.includes('.');
        const fileName = trimmedName
          ? (hasExtension ? trimmedName : `${trimmedName}.${normalizedExtension}`)
          : `pasted-image-${timestamp}-${index + 1}.${normalizedExtension}`;
        formData.append(`image-${index}`, new File([file], fileName, { type: file.type || 'image/png' }));
      });

      const savedPaths = await uploadAttachments(selectedRepoFilesystemPath, formData);
      if (savedPaths.length === 0) {
        throw new Error('Failed to save pasted images.');
      }

      appendAttachmentPaths(savedPaths);
    } catch (pasteError) {
      const message = pasteError instanceof Error ? pasteError.message : 'Failed to paste image attachments.';
      setError(message);
    } finally {
      setIsPastingTaskAttachments(false);
    }
  }, [appendAttachmentPaths, selectedRepoFilesystemPath]);

  const handleMobileAttachmentSelection = useCallback(async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (!selectedRepoFilesystemPath) return;

    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    setError(null);
    setIsUploadingTaskAttachments(true);

    try {
      const formData = new FormData();
      files.forEach((file, index) => {
        const fileName = file.name.trim() || `attachment-${Date.now()}-${index + 1}`;
        formData.append(`attachment-${index}`, file, fileName);
      });

      const savedPaths = await uploadAttachments(selectedRepoFilesystemPath, formData);
      if (savedPaths.length === 0) {
        throw new Error('Failed to upload selected attachments.');
      }

      appendAttachmentPaths(savedPaths);
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'Failed to upload selected attachments.';
      setError(message);
    } finally {
      setIsUploadingTaskAttachments(false);
    }
  }, [appendAttachmentPaths, selectedRepoFilesystemPath]);

  const handleSelectAttachments = useCallback(() => {
    if (!selectedRepoFilesystemPath) return;

    const shouldUseNativePicker = isMobileViewport
      || (typeof window !== 'undefined' && shouldUseDeviceFilePicker(window.location.hostname));

    if (shouldUseNativePicker) {
      mobileAttachmentInputRef.current?.click();
      return;
    }

    setIsAttachmentBrowserOpen(true);
  }, [isMobileViewport, selectedRepoFilesystemPath]);

  // Suggestion state
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionList, setSuggestionList] = useState<string[]>([]);
  const [activeMention, setActiveMention] = useState<ActiveMention | null>(null);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Cache repo entries for @ mention suggestions.
  const [repoFilesCache, setRepoFilesCache] = useState<string[]>([]);
  const [skillSuggestionsByProvider, setSkillSuggestionsByProvider] = useState<Record<string, string[]>>({});

  useEffect(() => {
    latestCursorPositionRef.current = cursorPosition;
  }, [cursorPosition]);

  const selectedAttachmentNames = useMemo(
    () => attachments.map((attachmentPath) => getBaseName(attachmentPath)),
    [attachments],
  );
  const prefilledAttachmentNames = useMemo(
    () => prefilledAttachmentPaths.map((attachmentPath) => getBaseName(attachmentPath)),
    [prefilledAttachmentPaths],
  );
  const predefinedPromptGroups = useMemo(() => {
    const groupedPrompts = new Map<string, PredefinedPrompt[]>();
    for (const prompt of predefinedPrompts) {
      const existingGroup = groupedPrompts.get(prompt.group) ?? [];
      existingGroup.push(prompt);
      groupedPrompts.set(prompt.group, existingGroup);
    }
    return Array.from(groupedPrompts.entries()).map(([group, prompts]) => ({
      group,
      prompts,
    }));
  }, [predefinedPrompts]);
  const predefinedPromptById = useMemo(
    () => new Map(predefinedPrompts.map((prompt) => [prompt.id, prompt])),
    [predefinedPrompts],
  );
  const activePredefinedPrompt = useMemo(
    () => predefinedPrompts.find((prompt) => prompt.content === initialMessage) ?? null,
    [predefinedPrompts, initialMessage],
  );
  const hasPredefinedPrompts = mode === 'new' && predefinedPromptGroups.length > 0;

  const hideSuggestions = useCallback(() => {
    setShowSuggestions(false);
    setSuggestionList([]);
    setSelectedIndex(0);
    setActiveMention(null);
  }, []);

  const handleApplyPredefinedPrompt = useCallback((promptContent: string) => {
    latestTaskDescriptionRef.current = promptContent;
    latestCursorPositionRef.current = promptContent.length;
    setInitialMessage(promptContent);
    setCursorPosition(promptContent.length);
    hideSuggestions();
  }, [hideSuggestions]);
  const handleSelectPredefinedPrompt = useCallback((promptId: string) => {
    if (!promptId) return;
    const prompt = predefinedPromptById.get(promptId);
    if (!prompt) return;
    handleApplyPredefinedPrompt(prompt.content);
  }, [handleApplyPredefinedPrompt, predefinedPromptById]);

  const applySuggestionList = useCallback((mention: ActiveMention, suggestions: string[]) => {
    setActiveMention(mention);
    setSuggestionList(suggestions);
    setSelectedIndex(0);
    setShowSuggestions(suggestions.length > 0);
  }, []);

  const refreshMentionSuggestions = useCallback(async (value: string, position: number) => {
    const mention = findActiveMention(value, position);
    if (!mention) {
      hideSuggestions();
      return;
    }

    setActiveMention(mention);

    if (mention.trigger === '@') {
      const repoPath = selectedRepoFilesystemPath;
      if (!repoPath) {
        applySuggestionList(mention, []);
        return;
      }

      let files = repoFilesCache;
      if (files.length === 0) {
        files = await listRepoFiles(repoPath);
        if (latestSelectedRepoRef.current === repoPath) {
          setRepoFilesCache((previous) => (previous.length > 0 ? previous : files));
        }
      }

      const latestMention = findActiveMention(latestTaskDescriptionRef.current, latestCursorPositionRef.current);
      if (!areMentionsEqual(latestMention, mention) || latestSelectedRepoRef.current !== repoPath) {
        return;
      }

      const suggestions = buildRepoMentionSuggestions({
        query: mention.query,
        repoEntries: files,
        currentAttachments: selectedAttachmentNames,
        carriedAttachments: prefilledAttachmentNames,
      });
      applySuggestionList(mention, suggestions);
      return;
    }

    const provider = selectedAgentProvider;
    let installedSkills = skillSuggestionsByProvider[provider];
    if (!Object.prototype.hasOwnProperty.call(skillSuggestionsByProvider, provider)) {
      installedSkills = await listInstalledAgentSkills(provider);
      setSkillSuggestionsByProvider((previous) => (
        Object.prototype.hasOwnProperty.call(previous, provider)
          ? previous
          : { ...previous, [provider]: installedSkills ?? [] }
      ));
    }

    const latestMention = findActiveMention(latestTaskDescriptionRef.current, latestCursorPositionRef.current);
    if (!areMentionsEqual(latestMention, mention) || latestSelectedAgentProviderRef.current !== provider) {
      return;
    }

    const suggestions = buildSkillMentionSuggestions(mention.query, installedSkills ?? []);
    applySuggestionList(mention, suggestions);
  }, [
    applySuggestionList,
    hideSuggestions,
    prefilledAttachmentNames,
    repoFilesCache,
    selectedAgentProvider,
    selectedAttachmentNames,
    selectedRepoFilesystemPath,
    skillSuggestionsByProvider,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      if (showSuggestions && suggestionList.length > 0) {
        if (e.shiftKey) {
          e.preventDefault();
          const textarea = e.currentTarget;
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const val = initialMessage;
          const newVal = val.slice(0, start) + '\n' + val.slice(end);
          latestTaskDescriptionRef.current = newVal;
          latestCursorPositionRef.current = start + 1;
          setInitialMessage(newVal);
          setCursorPosition(start + 1);
          hideSuggestions();
          return;
        }
        e.preventDefault();
        handleSelectSuggestion(suggestionList[selectedIndex]);
        return;
      }
      if (!e.shiftKey) {
        e.preventDefault();
        handleStartSession();
        return;
      }
      return;
    }

    if (showSuggestions && suggestionList.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : suggestionList.length - 1)); // Wrap around
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev < suggestionList.length - 1 ? prev + 1 : 0)); // Wrap around
      } else if (e.key === 'Tab') {
        e.preventDefault();
        handleSelectSuggestion(suggestionList[selectedIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hideSuggestions();
      }
    }
  };

  const handleMessageChange = async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const pos = e.target.selectionStart;
    latestTaskDescriptionRef.current = val;
    latestCursorPositionRef.current = pos;
    setInitialMessage(val);
    setCursorPosition(pos);
    await refreshMentionSuggestions(val, pos);
  };

  const handleSelectSuggestion = (suggestion: string) => {
    if (!activeMention) return;

    const result = replaceActiveMention(initialMessage, activeMention, suggestion);
    latestTaskDescriptionRef.current = result.value;
    latestCursorPositionRef.current = result.cursorPosition;
    setInitialMessage(result.value);
    setCursorPosition(result.cursorPosition);
    hideSuggestions();
  };

  useEffect(() => {
    if (activeMention?.trigger !== '$') return;
    void refreshMentionSuggestions(latestTaskDescriptionRef.current, latestCursorPositionRef.current);
  }, [activeMention?.trigger, refreshMentionSuggestions, selectedAgentProvider]);

  const removeAttachment = (idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  const removePrefilledAttachment = (idx: number) => {
    setPrefilledAttachmentPaths(prev => prev.filter((_, i) => i !== idx));
  };


  const handleRemoveRecent = async (e: React.MouseEvent, repo: string) => {
    e.stopPropagation();
    if (config) {
      const currentRecentProjects = config.recentProjects ?? config.recentRepos;
      const newRecent = currentRecentProjects.filter((project) => project !== repo);
      const newConfig = await updateConfig({ recentProjects: newRecent });
      setConfig(newConfig);
    }
  };

  const handleOpenRepoSettings = async (e: React.MouseEvent, repo: string) => {
    e.stopPropagation();
    await ensureProjectRegistered(repo);

    const settings = config?.projectSettings?.[repo];
    setRepoForSettings(repo);
    setRepoAlias(settings?.alias?.trim() || '');
    setRepoStartupCommand(settings?.startupScript ?? DEFAULT_PROJECT_STARTUP_COMMAND);
    setRepoDevServerCommand(settings?.devServerScript ?? DEFAULT_PROJECT_DEV_SERVER_COMMAND);
    setRepoServiceStartCommand(settings?.serviceStartCommand ?? DEFAULT_PROJECT_SERVICE_START_COMMAND);
    setRepoServiceStopCommand(settings?.serviceStopCommand ?? DEFAULT_PROJECT_SERVICE_STOP_COMMAND);
    setProjectIconForSettings(repoCardIconByRepo[repo] ?? { iconPath: null, iconEmoji: null });
    setRepoSettingsError(null);
    setIsRepoSettingsDialogOpen(true);
  };

  const handleSaveRepoSettings = async () => {
    if (!repoForSettings) return;
    const startupCommandToSave = repoStartupCommand.trim() || DEFAULT_PROJECT_STARTUP_COMMAND;
    const devServerCommandToSave = repoDevServerCommand.trim() || DEFAULT_PROJECT_DEV_SERVER_COMMAND;
    const serviceStartCommandToSave = repoServiceStartCommand.trim() || DEFAULT_PROJECT_SERVICE_START_COMMAND;
    const serviceStopCommandToSave = repoServiceStopCommand.trim() || DEFAULT_PROJECT_SERVICE_STOP_COMMAND;

    setIsSavingRepoSettings(true);
    setRepoSettingsError(null);
    try {
      const aliasToSave = repoAlias.trim() || null;
      const newConfig = await updateProjectSettings(repoForSettings, {
        startupScript: startupCommandToSave,
        devServerScript: devServerCommandToSave,
        serviceStartCommand: serviceStartCommandToSave,
        serviceStopCommand: serviceStopCommandToSave,
        alias: aliasToSave,
      });
      setConfig(newConfig);

      try {
        await fetch('/api/projects', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: repoForSettings, updates: { displayName: aliasToSave } }),
        });
      } catch {
        // Non-critical if project is temporarily unavailable.
      }

      dismissRepoSettingsDialog();
    } catch (err) {
      console.error(err);
      setRepoSettingsError('Failed to save project settings.');
    } finally {
      setIsSavingRepoSettings(false);
    }
  };

  const handleUploadProjectIcon = async (iconPath: string) => {
    if (!repoForSettings || isUploadingProjectIcon) return;
    setRepoSettingsError(null);
    setIsUploadingProjectIcon(true);

    try {
      const response = await fetch('/api/projects/icon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: repoForSettings,
          iconPath,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to upload project icon.');
      }

      const nextProjectIcon = {
        iconPath: typeof payload?.iconPath === 'string' ? payload.iconPath : null,
        iconEmoji: typeof payload?.iconEmoji === 'string' ? payload.iconEmoji : null,
      };
      setProjectIconForSettings(nextProjectIcon);
      setRepoCardIconByRepo((previous) => ({ ...previous, [repoForSettings]: nextProjectIcon }));
      setBrokenRepoCardIcons((previous) => ({ ...previous, [repoForSettings]: false }));
    } catch (error) {
      console.error(error);
      setRepoSettingsError(error instanceof Error ? error.message : 'Failed to upload project icon.');
    } finally {
      setIsUploadingProjectIcon(false);
    }
  };

  const handleChooseProjectIconEmoji = async (iconEmoji: string) => {
    if (!repoForSettings || isUploadingProjectIcon) return;
    setRepoSettingsError(null);
    setIsUploadingProjectIcon(true);

    try {
      const response = await fetch('/api/projects/icon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: repoForSettings,
          iconEmoji,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to save project emoji icon.');
      }

      const nextProjectIcon = {
        iconPath: typeof payload?.iconPath === 'string' ? payload.iconPath : null,
        iconEmoji: typeof payload?.iconEmoji === 'string' ? payload.iconEmoji : null,
      };
      setProjectIconForSettings(nextProjectIcon);
      setRepoCardIconByRepo((previous) => ({ ...previous, [repoForSettings]: nextProjectIcon }));
      setBrokenRepoCardIcons((previous) => ({ ...previous, [repoForSettings]: false }));
    } catch (error) {
      console.error(error);
      setRepoSettingsError(error instanceof Error ? error.message : 'Failed to save project emoji icon.');
    } finally {
      setIsUploadingProjectIcon(false);
    }
  };

  const handleRemoveProjectIcon = async () => {
    if (!repoForSettings || isUploadingProjectIcon) return;
    setRepoSettingsError(null);
    setIsUploadingProjectIcon(true);

    try {
      const response = await fetch('/api/projects/icon', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: repoForSettings }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to remove project icon.');
      }

      const emptyProjectIcon = { iconPath: null, iconEmoji: null };
      setProjectIconForSettings(emptyProjectIcon);
      setRepoCardIconByRepo((previous) => ({ ...previous, [repoForSettings]: emptyProjectIcon }));
      setBrokenRepoCardIcons((previous) => ({ ...previous, [repoForSettings]: false }));
    } catch (error) {
      console.error(error);
      setRepoSettingsError(error instanceof Error ? error.message : 'Failed to remove project icon.');
    } finally {
      setIsUploadingProjectIcon(false);
    }
  };
  const fetchAgentStatus = useCallback(async (
    provider: AgentProvider,
    options?: { silent?: boolean },
  ): Promise<AgentStatusResponse | null> => {
    if (!options?.silent) {
      setIsLoadingAgentStatus(true);
    }

    try {
      const payload = await queryClient.fetchQuery({
        queryKey: queryKeys.agentStatus(provider),
        queryFn: async () => {
          const response = await fetch(`/api/agent/status?provider=${encodeURIComponent(provider)}`, {
            cache: 'no-store',
          });
          const result = await response.json().catch(() => null) as AgentStatusResponse | null;
          if (!result) {
            throw new Error('Failed to load agent runtime status.');
          }
          return result;
        },
        meta: { persist: true },
        staleTime: 60_000,
      });

      const supportedProviders = payload.providers.filter((entry) => (
        entry.available
        && (entry.id === 'codex' || entry.id === 'gemini' || entry.id === 'cursor')
      ));

      setAgentProviders(supportedProviders);
      if (payload.status) {
        const nextCatalog: AgentModelCatalogCacheEntry = {
          models: payload.status.models,
          defaultModel: payload.status.defaultModel,
          updatedAt: new Date().toISOString(),
        };
        setCachedAgentModelCatalogs((previous) => ({ ...previous, [provider]: nextCatalog }));
      }
      if (provider === selectedAgentProvider) {
        setAgentStatus(payload.status);
        if (payload.error) {
          setAgentSetupMessage(payload.error);
        }
      }

      return payload;
    } catch (statusError) {
      const message = statusError instanceof Error ? statusError.message : 'Failed to load agent runtime status.';
      if (provider === selectedAgentProvider) {
        setAgentSetupMessage(message);
      }
      return null;
    } finally {
      if (!options?.silent) {
        setIsLoadingAgentStatus(false);
      }
    }
  }, [queryClient, selectedAgentProvider]);

  const handleInstallAgentProvider = useCallback(async (provider: AgentProvider) => {
    setIsInstallingAgentProvider(true);
    setInstallingAgentProvider(provider);
    setInstallLogs([]);
    setAgentSetupMessage(null);
    setError(null);

    try {
      const response = await fetch('/api/agent/install', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider }),
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || 'Failed to start provider installation.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;

          const event = JSON.parse(line) as
            | { type: 'install_started'; command: string }
            | { type: 'install_log'; stream: 'stdout' | 'stderr'; text: string }
            | { type: 'install_completed'; status: AppStatus }
            | { type: 'error'; message: string };

          if (event.type === 'install_started') {
            setInstallLogs((previous) => [...previous, `$ ${event.command}`].slice(-200));
            continue;
          }

          if (event.type === 'install_log') {
            const trimmedText = event.text.trimEnd();
            if (trimmedText) {
              setInstallLogs((previous) => [...previous, trimmedText].slice(-200));
            }
            continue;
          }

          if (event.type === 'install_completed') {
            if (provider === selectedAgentProvider) {
              setAgentStatus(event.status);
            }
            const nextCatalog: AgentModelCatalogCacheEntry = {
              models: event.status.models,
              defaultModel: event.status.defaultModel,
              updatedAt: new Date().toISOString(),
            };
            setCachedAgentModelCatalogs((previous) => ({ ...previous, [provider]: nextCatalog }));
            queryClient.setQueryData(queryKeys.agentStatus(provider), (existing: AgentStatusResponse | undefined) => ({
              providers: existing?.providers ?? agentProviders,
              defaultProvider: existing?.defaultProvider ?? 'codex',
              status: event.status,
              error: undefined,
            }));
            setAgentSetupMessage(`${agentProviderLabel(provider, agentProviders)} installed.`);
            continue;
          }

          if (event.type === 'error') {
            throw new Error(event.message);
          }
        }
      }

      await fetchAgentStatus(provider, { silent: true });
    } catch (installError) {
      const message = installError instanceof Error ? installError.message : 'Failed to install provider.';
      setAgentSetupMessage(message);
      setError(message);
    } finally {
      setIsInstallingAgentProvider(false);
      setInstallingAgentProvider(null);
    }
  }, [agentProviders, fetchAgentStatus, queryClient, selectedAgentProvider]);

  const handleAgentLogin = useCallback(async (provider: AgentProvider) => {
    setAgentSetupMessage(null);
    setError(null);

    try {
      const response = await fetch('/api/agent/login/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider }),
      });
      const payload = await response.json().catch(() => null) as (AgentLoginResponse & { error?: string }) | null;
      if (!response.ok || !payload) {
        throw new Error(payload?.error || 'Failed to start provider login.');
      }

      const providerLabel = agentProviderLabel(provider, agentProviders);
      if (payload.kind === 'browser') {
        window.open(payload.authUrl, '_blank', 'noopener,noreferrer');
        setAgentSetupMessage(payload.message || `Finish the ${providerLabel} login in the browser, then return here.`);
      } else {
        setAgentSetupMessage(payload.message || `Finish the ${providerLabel} login flow, then return here.`);
      }

      setIsWaitingForLogin(true);
      setWaitingForLoginProvider(provider);
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : 'Failed to start provider login.';
      setAgentSetupMessage(message);
      setError(message);
    }
  }, [agentProviders]);

  const saveAgentRuntimeSettings = useCallback(async (
    projectPath: string,
    updates: {
      agentProvider: AgentProvider;
      agentModel?: string;
      agentReasoningEffort?: ReasoningEffort;
    },
  ): Promise<Config> => {
    const response = await fetch('/api/projects/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectPath,
        updates,
      }),
    });
    const payload = await response.json().catch(() => null) as { config?: Config; error?: string } | null;

    if (!response.ok || !payload?.config) {
      throw new Error(payload?.error || 'Failed to persist agent runtime settings.');
    }

    return payload.config;
  }, []);

  const ensureSelectedProviderReady = useCallback(async (): Promise<{ ready: boolean; status: AppStatus | null }> => {
    const payload = await fetchAgentStatus(selectedAgentProvider);
    const status = payload?.status ?? null;
    if (!status) {
      setError(agentSetupMessage || 'Failed to load agent runtime status.');
      return { ready: false, status: null };
    }

    if (!status.installed) {
      setError(`Install ${agentProviderLabel(selectedAgentProvider, agentProviders)} before creating a task.`);
      return { ready: false, status };
    }

    if (!status.loggedIn) {
      setError(`Log in to ${agentProviderLabel(selectedAgentProvider, agentProviders)} before creating a task.`);
      return { ready: false, status };
    }

    return { ready: true, status };
  }, [agentProviders, agentSetupMessage, fetchAgentStatus, selectedAgentProvider]);

  const displayedAgentStatus = useMemo(() => {
    if (!agentStatus || agentStatus.provider !== selectedAgentProvider) {
      return null;
    }
    return agentStatus;
  }, [agentStatus, selectedAgentProvider]);

  const agentStatusSummary = useMemo(() => {
    if (isLoadingAgentStatus) {
      return 'Checking runtime status...';
    }

    if (!displayedAgentStatus) {
      return selectedAgentStatusCacheState.hasCachedData
        ? 'Using cached runtime status'
        : 'Runtime status unavailable';
    }

    const summary = [
      displayedAgentStatus.installed ? 'Installed' : 'Not installed',
      displayedAgentStatus.loggedIn ? 'Logged in' : 'Login required',
      displayedAgentStatus.version ? `v${displayedAgentStatus.version}` : null,
    ].filter(Boolean).join(' • ');
    return selectedAgentStatusCacheState.isRefreshing
      ? `${summary} • Refreshing cached status…`
      : summary;
  }, [displayedAgentStatus, isLoadingAgentStatus, selectedAgentStatusCacheState.hasCachedData, selectedAgentStatusCacheState.isRefreshing]);

  const agentAccountSummary = useMemo(() => {
    if (!displayedAgentStatus?.account?.email) return null;
    return [
      displayedAgentStatus.account.email,
      displayedAgentStatus.account.planType || null,
    ].filter(Boolean).join(' • ');
  }, [displayedAgentStatus]);

  const activeAgentModelCatalog = useMemo(() => {
    const cachedCatalog = cachedAgentModelCatalogs[selectedAgentProvider] ?? null;
    return {
      models: displayedAgentStatus?.models.length
        ? displayedAgentStatus.models
        : (cachedCatalog?.models ?? []),
      defaultModel: displayedAgentStatus?.defaultModel ?? cachedCatalog?.defaultModel ?? null,
      isFromCache: !displayedAgentStatus && Boolean(cachedCatalog),
    };
  }, [cachedAgentModelCatalogs, displayedAgentStatus, selectedAgentProvider]);

  useEffect(() => {
    const validModels = activeAgentModelCatalog.models;
    if (activeAgentModelCatalog.isFromCache && selectedAgentModel.trim()) {
      return;
    }

    const nextModel = validModels.find((model) => model.id === selectedAgentModel)?.id
      || activeAgentModelCatalog.defaultModel
      || validModels[0]?.id
      || '';

    if (nextModel !== selectedAgentModel) {
      setSelectedAgentModel(nextModel);
    }
  }, [activeAgentModelCatalog, selectedAgentModel, selectedAgentProvider]);

  const selectedModelOption = useMemo<ModelOption | null>(() => {
    return activeAgentModelCatalog.models.find((model) => model.id === selectedAgentModel) || null;
  }, [activeAgentModelCatalog.models, selectedAgentModel]);

  const selectableModelOptions = useMemo<ModelOption[]>(() => {
    if (activeAgentModelCatalog.models.length > 0) {
      if (selectedAgentModel && !activeAgentModelCatalog.models.some((model) => model.id === selectedAgentModel)) {
        return [
          ...activeAgentModelCatalog.models,
          {
            id: selectedAgentModel,
            label: selectedAgentModel,
            description: null,
          },
        ];
      }
      return activeAgentModelCatalog.models;
    }

    if (selectedAgentModel) {
      return [{
        id: selectedAgentModel,
        label: selectedAgentModel,
        description: null,
      }];
    }

    return [{
      id: '',
      label: 'Default model',
      description: null,
    }];
  }, [activeAgentModelCatalog.models, selectedAgentModel]);

  const reasoningEffortOptions = useMemo(() => {
    if (selectedAgentProvider !== 'codex') return [];
    return selectedModelOption?.reasoningEfforts || [];
  }, [selectedAgentProvider, selectedModelOption]);

  useEffect(() => {
    if (selectedAgentProvider !== 'codex') {
      if (selectedReasoningEffort) {
        setSelectedReasoningEffort('');
      }
      return;
    }

    const nextReasoning = reasoningEffortOptions.find((effort) => effort === selectedReasoningEffort)
      || reasoningEffortOptions[0]
      || '';

    if (nextReasoning !== selectedReasoningEffort) {
      setSelectedReasoningEffort(nextReasoning);
    }
  }, [reasoningEffortOptions, selectedAgentProvider, selectedReasoningEffort]);

  useEffect(() => {
    if (mode !== 'new' || !selectedRepo || !config || !selectedProjectSettingsReference) return;
    if (hydratedAgentRuntimeRepoRef.current !== selectedRepo) return;

    const explicitProjectSettings = config.projectSettings[selectedProjectSettingsReference] || {};
    const currentSettings = getEffectiveProjectAgentRuntimeSettings(config, selectedProjectSettingsReference);
    const nextReasoning = selectedAgentProvider === 'codex'
      ? normalizeProviderReasoningSelection(selectedAgentProvider, selectedReasoningEffort)
      : undefined;
    const hasExplicitFallbackReasoning = Boolean(
      explicitProjectSettings.agentReasoningEffort
      || normalizeProviderReasoningEffort(
        config.defaultAgentProvider,
        config.defaultAgentReasoningEffort,
      ),
    );
    const comparisonReasoning = !hasExplicitFallbackReasoning
      && currentSettings.provider === selectedAgentProvider
      && currentSettings.model === selectedAgentModel
      && selectedAgentProvider === 'codex'
      && (nextReasoning || '') === (reasoningEffortOptions[0] || '')
        ? ''
        : (nextReasoning || '');

    if (
      currentSettings.provider === selectedAgentProvider
      && currentSettings.model === selectedAgentModel
      && currentSettings.reasoningEffort === comparisonReasoning
    ) {
      return;
    }

    const requestId = agentRuntimeSettingsRequestRef.current + 1;
    agentRuntimeSettingsRequestRef.current = requestId;

    void saveAgentRuntimeSettings(selectedProjectSettingsReference, {
      agentProvider: selectedAgentProvider,
      agentModel: selectedAgentModel || undefined,
      agentReasoningEffort: nextReasoning,
    }).then((nextConfig) => {
      if (agentRuntimeSettingsRequestRef.current === requestId) {
        setConfig(nextConfig);
      }
    }).catch((settingsError) => {
      console.error('Failed to persist agent runtime settings:', settingsError);
    });
  }, [config, mode, reasoningEffortOptions, saveAgentRuntimeSettings, selectedAgentModel, selectedAgentProvider, selectedProjectSettingsReference, selectedReasoningEffort, selectedRepo]);

  useEffect(() => {
    if (!isWaitingForLogin || !waitingForLoginProvider || !isPageForegrounded) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    const pollStatus = async () => {
      const payload = await fetchAgentStatus(waitingForLoginProvider, { silent: true });
      if (cancelled) return;

      if (payload?.status?.loggedIn) {
        setIsWaitingForLogin(false);
        setWaitingForLoginProvider(null);
        setAgentSetupMessage(`${agentProviderLabel(waitingForLoginProvider, agentProviders)} is ready.`);
        return;
      }

      timer = window.setTimeout(() => {
        void pollStatus();
      }, 2000);
    };

    timer = window.setTimeout(() => {
      void pollStatus();
    }, 2000);

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [agentProviders, fetchAgentStatus, isPageForegrounded, isWaitingForLogin, waitingForLoginProvider]);

  const startSession = async () => {
    if (!selectedRepo) return;
    const projectSettingsReference = selectedProjectSettingsReference ?? selectedRepo;
    setLoading(true);
    setError(null);

    try {
      const readiness = await ensureSelectedProviderReady();
      if (!readiness.ready || !readiness.status) {
        setLoading(false);
        return;
      }

      const resolvedDevServerScript = devServerScript.trim();
      const resolvedProvider = normalizeAgentProvider(selectedAgentProvider);
      const resolvedModel = selectedAgentModel.trim()
        || readiness.status.defaultModel
        || readiness.status.models[0]?.id
        || '';
      const resolvedReasoningEffort = resolvedProvider === 'codex'
        ? normalizeProviderReasoningSelection(resolvedProvider, selectedReasoningEffort)
        : undefined;

      // Also save startup script if changed
      await saveStartupScript();
      await saveDevServerScriptValue(resolvedDevServerScript);
      const nextConfig = await updateProjectSettings(projectSettingsReference, {
        agentProvider: resolvedProvider,
        agentModel: resolvedModel || undefined,
        agentReasoningEffort: resolvedReasoningEffort,
      });
      setConfig(nextConfig);

      // 2. Create session workspace (single/multi/folder mode decided by server runtime discovery).
      const derivedTitle = deriveSessionTitleFromTaskDescription(initialMessage);
      const gitContexts = selectedProjectGitContexts;
      const preparedWorkspaceId = (
        sessionWorkspacePreference === 'workspace'
        && activePreparedWorkspaceRef.current?.projectPath === selectedRepo
          ? activePreparedWorkspaceRef.current.preparationId
          : undefined
      );

      const wtResult = await createSession(selectedRepo, gitContexts, {
        agent: resolvedProvider,
        agentProvider: resolvedProvider,
        model: resolvedModel,
        reasoningEffort: resolvedReasoningEffort,
        title: derivedTitle,
        startupScript: startupScript || undefined,
        devServerScript: resolvedDevServerScript || undefined,
        preparedWorkspaceId,
        workspacePreference: sessionWorkspacePreference,
      });

      if (wtResult.success && wtResult.sessionName && wtResult.workspacePath) {
        if (preparedWorkspaceId) {
          setPreparedWorkspaceState(null);
          workspacePreparationInputKeyRef.current = null;
          void releasePreparedWorkspaceById(preparedWorkspaceId);
        }

        const allAttachmentPaths = Array.from(
          new Set(
            [...attachments, ...prefilledAttachmentPaths]
              .map((entry) => entry.trim())
              .filter(Boolean)
          )
        );
        const attachmentPathByName = new Map<string, string>();
        for (const attachmentPath of allAttachmentPaths) {
          const baseName = getBaseName(attachmentPath).trim();
          if (!baseName) continue;
          if (!attachmentPathByName.has(baseName)) {
            attachmentPathByName.set(baseName, attachmentPath);
          }
        }
        const allAttachmentNames = Array.from(attachmentPathByName.keys());

        // Process initial message mentions
        const trimmedInitialMessage = initialMessage.trim();
        const hasTaskDescription = hasStartupTaskDescription(trimmedInitialMessage);
        let processedMessage = trimmedInitialMessage;

        if (hasTaskDescription) {
          // Helper to match replacement
          processedMessage = processedMessage.replace(/@(\S+)/g, (match, name) => {
            const attachmentPath = attachmentPathByName.get(name);
            if (attachmentPath) {
              return attachmentPath;
            }
            // Assume repo file - keep relative path as we run in worktree root
            return name;
          });
        }

        const launchInitialMessage = hasTaskDescription ? processedMessage : '';

        // 3. Persist launch context for the new session
        const launchContextResult = await saveSessionLaunchContext(wtResult.sessionName, {
          title: derivedTitle,
          initialMessage: launchInitialMessage || undefined,
          rawInitialMessage: hasTaskDescription ? trimmedInitialMessage : undefined,
          startupScript: startupScript || undefined,
          attachmentPaths: allAttachmentPaths,
          attachmentNames: allAttachmentNames,
          projectRepoPaths: projectGitRepos,
          projectRepoRelativePaths: projectGitRepos.map((repoPath) => (
            toProjectRelativeRepoPath(selectedRepo, repoPath)
          )),
          agentProvider: resolvedProvider,
          model: resolvedModel,
          reasoningEffort: resolvedReasoningEffort,
          sessionMode,
        });

        if (!launchContextResult.success) {
          setError(launchContextResult.error || 'Failed to save session context');
          setLoading(false);
          return;
        }

        // 4. Navigate to session page by path only
        notifySessionsChanged();
        navigateToSession(wtResult.sessionName);
        return;

        // No need to refresh sessions as we are navigating away
      } else {
        setError(wtResult.error || "Failed to create session workspace");
        setLoading(false);
      }

    } catch (e) {
      console.error(e);
      setError("Failed to start session");
      setLoading(false);
    }
  };

  const handleStartSession = () => {
    void startSession();
  };

  const handleSaveDraft = async () => {
    if (!selectedRepo) return;
    setIsSavingDraft(true);
    setError(null);
    try {
      const draftId = Date.now().toString();
      const messageTitle = initialMessage.split('\n')[0].trim() || 'Untitled Draft';
      const resolvedProvider = normalizeAgentProvider(selectedAgentProvider);
      const resolvedModel = selectedAgentModel.trim()
        || displayedAgentStatus?.defaultModel
        || activeAgentModelCatalog.defaultModel
        || displayedAgentStatus?.models[0]?.id
        || activeAgentModelCatalog.models[0]?.id
        || '';
      const draftGitContexts = projectGitRepos.map((repoPath) => {
        const fallbackBranch = branchesByRepo[repoPath]?.find((branch) => branch.current)?.name
          || branchesByRepo[repoPath]?.[0]?.name
          || '';
        const baseBranch = baseBranchByRepo[repoPath]?.trim() || fallbackBranch;
        return {
          sourceRepoPath: repoPath,
          relativeRepoPath: '',
          worktreePath: '',
          branchName: baseBranch,
          baseBranch: baseBranch || undefined,
        };
      }).filter((context) => context.branchName.trim().length > 0);
      const firstGitContext = draftGitContexts[0];
      const draft: DraftMetadata = {
        id: draftId,
        projectPath: selectedRepo,
        projectId: resolvedSelectedProject?.project?.id ?? undefined,
        gitContexts: draftGitContexts,
        repoPath: selectedRepoBasePath || selectedRepo,
        branchName: firstGitContext?.branchName || currentBranchName || undefined,
        message: initialMessage,
        attachmentPaths: [...attachments, ...prefilledAttachmentPaths],
        agentProvider: resolvedProvider,
        model: resolvedModel,
        reasoningEffort: resolvedProvider === 'codex'
          ? normalizeProviderReasoningSelection(resolvedProvider, selectedReasoningEffort)
          : undefined,
        timestamp: new Date().toISOString(),
        title: messageTitle,
        startupScript: startupScript,
        devServerScript: devServerScript,
        sessionMode: sessionMode,
      };

      const result = await saveDraft(draft);
      if (result.success) {
        await refreshSessionData(selectedRepo);
      } else {
        setError(result.error || 'Failed to save draft');
      }
    } catch (e) {
      console.error(e);
      setError('Failed to save draft');
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleOpenDraft = async (draft: DraftMetadata) => {
    setInitialMessage(draft.message);
    setAttachments(draft.attachmentPaths);
    setPrefilledAttachmentPaths([]);
    if (draft.gitContexts.length > 0) {
      const nextBaseBranchByRepo: Record<string, string> = {};
      draft.gitContexts.forEach((context) => {
        const resolvedBaseBranch = context.baseBranch?.trim() || context.branchName.trim();
        if (resolvedBaseBranch) {
          nextBaseBranchByRepo[context.sourceRepoPath] = resolvedBaseBranch;
        }
      });
      setProjectGitRepos(draft.gitContexts.map((context) => context.sourceRepoPath));
      setBaseBranchByRepo((previous) => ({ ...previous, ...nextBaseBranchByRepo }));
      const firstContext = draft.gitContexts[0];
      setCurrentBranchName(nextBaseBranchByRepo[firstContext.sourceRepoPath] || firstContext.branchName || '');
    } else {
      setCurrentBranchName(draft.branchName || '');
    }
    setStartupScript(draft.startupScript || '');
    setDevServerScript(draft.devServerScript || '');
    setSessionMode(draft.sessionMode || 'fast');
    const resolvedProvider = normalizeAgentProvider(draft.agentProvider);
    setSelectedAgentProvider(resolvedProvider);
    setSelectedAgentModel(draft.model || '');
    setSelectedReasoningEffort(
      normalizeProviderReasoningEffort(resolvedProvider, draft.reasoningEffort) || '',
    );

    // delete draft after opening
    await handleDeleteDraft(draft.id);
  };

  const handleDeleteDraft = async (draftId: string) => {
    try {
      await deleteDraft(draftId);
      await refreshSessionData(selectedRepo);
    } catch (e) {
      console.error(e);
    }
  };

  useDialogKeyboardShortcuts({
    enabled: mode === 'home' && isRepoSettingsDialogOpen && !!repoForSettings,
    onConfirm: handleSaveRepoSettings,
    onDismiss: dismissRepoSettingsDialog,
    canConfirm: !isSavingRepoSettings,
  });

  useDialogKeyboardShortcuts({
    enabled: mode === 'home' && isCloneRemoteDialogOpen,
    onConfirm: handleCloneRemoteRepo,
    onDismiss: dismissCloneRemoteDialog,
    canConfirm: !isCloningRemote && remoteRepoUrl.trim().length > 0 && !isLoadingCloneCredentialOptions,
  });

  const handleResumeSession = async (session: SessionMetadata) => {
    if (!selectedRepo) return;
    setLoading(true);

    try {
      // Session runtime is server-managed; reopening the page only reconnects the UI.
      navigateToSession(session.sessionName);
      return;
    } catch (e) {
      console.error(e);
      setError("Failed to resume session");
      setLoading(false);
    }
  };

  const handleNewAttemptFromSession = (session: SessionMetadata) => {
    if (!selectedRepo) return;
    const nextProjectReference = resolveCanonicalProjectReference(projects, selectedRepo);
    if (!nextProjectReference) return;

    const params = new URLSearchParams();
    if (resolvedSelectedProject?.project?.id) {
      params.set('projectId', resolvedSelectedProject.project.id);
    } else {
      params.set('project', nextProjectReference);
    }
    params.set('prefillFromSession', session.sessionName);
    const nextUrl = `/new?${params.toString()}`;
    router.push(nextUrl);
  };

  const handleDeleteSession = async (session: SessionMetadata) => {
    if (!selectedRepo) return;

    const confirmed = await confirmDialog({
      title: `Delete session "${session.sessionName}"?`,
      description: 'This will remove the worktree, branch, and session metadata.',
      confirmLabel: 'Delete session',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    setDeletingSessionName(session.sessionName);
    setError(null);

    try {
      const result = await deleteSession(session.sessionName);
      if (!result.success) {
        setError(result.error || 'Failed to delete session');
        return;
      }

      setExistingSessions((previous) => previous.filter((item) => item.sessionName !== session.sessionName));
      setAllSessions((previous) => previous.filter((item) => item.sessionName !== session.sessionName));
    } catch (e) {
      console.error(e);
      setError('Failed to delete session');
    } finally {
      setDeletingSessionName(null);
    }
  };

  const runningSessionsByProject = useMemo(() => (
    groupHomeProjectSessionsByProject(projects, allSessions)
  ), [allSessions, projects]);

  const runningSessionCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [projectKey, sessions] of runningSessionsByProject.entries()) {
      counts.set(projectKey, sessions.length);
    }
    return counts;
  }, [runningSessionsByProject]);

  const draftCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const draft of allDrafts) {
      const projectKey = resolveClientActivityProjectKey(projects, {
        projectId: draft.projectId,
        projectPath: draft.projectPath,
        fallbackPath: draft.repoPath,
      });
      if (!projectKey) continue;
      counts.set(projectKey, (counts.get(projectKey) ?? 0) + 1);
    }
    return counts;
  }, [allDrafts, projects]);

  const recentProjects = useMemo(
    () => config?.recentProjects ?? config?.recentRepos ?? [],
    [config?.recentProjects, config?.recentRepos],
  );

  const getProjectDisplayName = useCallback((projectPath: string): string => {
    const resolvedProject = resolveProjectEntry(projectPath);
    const alias = config?.projectSettings?.[resolvedProject.project?.id ?? projectPath]?.alias?.trim()
      || config?.projectSettings?.[resolvedProject.primaryPath ?? '']?.alias?.trim()
      || config?.projectSettings?.[projectPath]?.alias?.trim();
    return alias || resolvedProject.displayName || getBaseName(projectPath);
  }, [config?.projectSettings, resolveProjectEntry]);

  const getProjectSecondaryLabel = useCallback((projectPath: string): string => (
    resolveProjectEntry(projectPath).secondaryLabel
  ), [resolveProjectEntry]);
  const isProjectOpenable = useCallback((projectPath: string): boolean => (
    resolveProjectEntry(projectPath).isOpenable
  ), [resolveProjectEntry]);

  const sortedRecentProjects = useMemo(() => (
    sortHomeProjects(recentProjects, homeProjectSort, getProjectDisplayName)
  ), [getProjectDisplayName, homeProjectSort, recentProjects]);

  const filteredRecentProjects = useMemo(() => {
    const normalizedQuery = homeSearchQuery.trim().toLowerCase();
    if (!normalizedQuery) return sortedRecentProjects;

    return sortedRecentProjects.filter((projectPath) => {
      const displayName = getProjectDisplayName(projectPath).toLowerCase();
      return displayName.includes(normalizedQuery) || projectPath.toLowerCase().includes(normalizedQuery);
    });
  }, [getProjectDisplayName, homeSearchQuery, sortedRecentProjects]);

  const handleHomeProjectSortChange = useCallback(async (nextSort: HomeProjectSort) => {
    writeStoredHomeProjectSort(nextSort);
    setHomeProjectSort(nextSort);

    try {
      const nextConfig = await updateConfig({ homeProjectSort: nextSort });
      setConfig(nextConfig);
    } catch (sortError) {
      console.error('Failed to save home project sort:', sortError);
    }
  }, []);

  const handleOpenHomeProjectSession = useCallback((sessionName: string) => {
    navigateToSession(sessionName);
  }, [navigateToSession]);

  const selectableProjects = selectedRepo
    ? (recentProjects.includes(selectedRepo) ? recentProjects : [selectedRepo, ...recentProjects])
    : recentProjects;

  const discoverHomeProjectRepos = useCallback(async (
    projectReference: string,
    options: { force?: boolean } = {},
  ): Promise<HomeProjectGitRepo[]> => {
    const cached = projectGitReposByPath[projectReference];
    if (cached && !options.force) {
      return cached;
    }

    setDiscoveringHomeProjectGitRepos((previous) => ({ ...previous, [projectReference]: true }));
    try {
      const discovery = await discoverProjectGitRepos(projectReference);
      const repos = toHomeProjectGitRepos(discovery.repos);
      setProjectGitReposByPath((previous) => ({ ...previous, [projectReference]: repos }));
      return repos;
    } catch (discoverError) {
      console.error('Failed to discover project git repos:', discoverError);
      setProjectGitReposByPath((previous) => ({ ...previous, [projectReference]: [] }));
      return [];
    } finally {
      setDiscoveringHomeProjectGitRepos((previous) => ({ ...previous, [projectReference]: false }));
    }
  }, [projectGitReposByPath]);

  const handleOpenProjectGitWorkspace = useCallback(async (projectReference: string, sourceRepoPath?: string) => {
    if (sourceRepoPath?.trim()) {
      router.push(`/git?path=${encodeURIComponent(sourceRepoPath)}`);
      return;
    }

    const repos = await discoverHomeProjectRepos(projectReference);
    if (repos.length === 0) {
      setError('No Git repositories were found in this project.');
      return;
    }
    if (repos.length === 1) {
      router.push(`/git?path=${encodeURIComponent(repos[0].repoPath)}`);
      return;
    }
    setHomeProjectGitSelector({ projectPath: projectReference, repos });
  }, [discoverHomeProjectRepos, router]);

  useEffect(() => {
    if (mode !== 'home' || !isPageForegrounded || recentProjects.length === 0) return;
    const runtimeWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const projectsToDiscover = recentProjects.filter((projectPath) => !(projectPath in projectGitReposByPath));
    if (projectsToDiscover.length === 0) return;

    let cancelled = false;
    let fallbackTimer: number | null = null;
    let idleHandle: number | null = null;
    const queuedProjects = projectsToDiscover.slice(0, HOME_REPO_DISCOVERY_MAX_AUTOSTART);

    const clearScheduledWork = () => {
      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      if (idleHandle !== null && typeof runtimeWindow.cancelIdleCallback === 'function') {
        runtimeWindow.cancelIdleCallback(idleHandle);
        idleHandle = null;
      }
    };

    const scheduleNext = (index: number) => {
      if (cancelled || index >= queuedProjects.length) return;

      const run = () => {
        if (cancelled) return;
        void discoverHomeProjectRepos(queuedProjects[index]).finally(() => {
          scheduleNext(index + 1);
        });
      };

      if (typeof runtimeWindow.requestIdleCallback === 'function') {
        idleHandle = runtimeWindow.requestIdleCallback(() => {
          idleHandle = null;
          run();
        }, { timeout: HOME_REPO_DISCOVERY_IDLE_TIMEOUT_MS });
        return;
      }

      fallbackTimer = window.setTimeout(() => {
        fallbackTimer = null;
        run();
      }, HOME_REPO_DISCOVERY_IDLE_TIMEOUT_MS);
    };

    scheduleNext(0);

    return () => {
      cancelled = true;
      clearScheduledWork();
    };
  }, [discoverHomeProjectRepos, isPageForegrounded, mode, projectGitReposByPath, recentProjects]);

  useEffect(() => {
    if (mode !== 'home') return;

    const inFlightResolutions = repoCardIconResolutionsInFlightRef.current;
    const reposToResolve = recentProjects.filter((projectReference) => (
      !(projectReference in repoCardIconByRepo)
      && !inFlightResolutions.has(projectReference)
    ));

    if (reposToResolve.length === 0) return;

    let cancelled = false;
    reposToResolve.forEach((projectReference) => {
      inFlightResolutions.add(projectReference);
    });

    void (async () => {
      const resolutionEntries = await Promise.all(reposToResolve.map(async (projectReference) => {
        const resolvedProject = resolveProjectEntry(projectReference);
        const iconReferencePath = resolvedProject.primaryPath;

        if (resolvedProject.project?.iconEmoji?.trim()) {
          return [projectReference, {
            iconPath: null,
            iconEmoji: resolvedProject.project.iconEmoji.trim(),
          }] as const;
        }

        if (resolvedProject.project?.iconPath?.trim()) {
          return [projectReference, {
            iconPath: resolvedProject.project.iconPath.trim(),
            iconEmoji: null,
          }] as const;
        }

        if (!iconReferencePath) {
          return [projectReference, { iconPath: null, iconEmoji: null }] as const;
        }

        try {
          const result = await resolveRepoCardIcon(iconReferencePath);
          return [projectReference, result.success
            ? { iconPath: result.iconPath, iconEmoji: result.iconEmoji }
            : { iconPath: null, iconEmoji: null }] as const;
        } catch (error) {
          console.error('Failed to resolve project icon:', error);
          return [projectReference, { iconPath: null, iconEmoji: null }] as const;
        }
      }));

      if (!cancelled) {
        setRepoCardIconByRepo((previous) => {
          const next = { ...previous };
          for (const [projectReference, icon] of resolutionEntries) {
            next[projectReference] = icon;
          }
          return next;
        });
      }

      reposToResolve.forEach((projectReference) => {
        inFlightResolutions.delete(projectReference);
      });
    })();

    return () => {
      cancelled = true;
      reposToResolve.forEach((projectReference) => {
        inFlightResolutions.delete(projectReference);
      });
    };
  }, [mode, recentProjects, repoCardIconByRepo, resolveProjectEntry]);

  const currentThemeModeIndex = THEME_MODE_SEQUENCE.indexOf(themeMode);
  const nextThemeMode = THEME_MODE_SEQUENCE[(currentThemeModeIndex + 1) % THEME_MODE_SEQUENCE.length];
  const themeModeLabel = themeMode === 'auto' ? 'Auto' : (themeMode === 'light' ? 'Bright' : 'Dark');
  const nextThemeModeLabel = nextThemeMode === 'auto' ? 'Auto' : (nextThemeMode === 'light' ? 'Bright' : 'Dark');
  const ThemeModeIcon = themeMode === 'auto' ? Monitor : (themeMode === 'light' ? Sun : Moon);
  const handleCycleThemeMode = () => {
    setThemeMode(nextThemeMode);
  };
  const handleRepoIconError = useCallback((repo: string) => {
    setBrokenRepoCardIcons((previous) => {
      if (previous[repo]) return previous;
      return { ...previous, [repo]: true };
    });
  }, []);
  const newSessionPanelClass = `rounded-[22px] p-4 ${APP_PAGE_PANEL_CLASS}`;
  const newSessionToolbarClass = APP_PAGE_TOOLBAR_CLASS;
  const newSessionControlClass =
    'border border-slate-200/70 bg-white/35 text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 app-dark-input';
  const newSessionSurfaceClass =
    'border border-slate-200/70 bg-white/20 app-dark-surface';
  const newSessionRaisedSurfaceClass =
    'border border-slate-200/70 bg-white/30 shadow-sm app-dark-surface-raised';
  const newSessionChipClass =
    'border border-slate-200/70 bg-white/35 text-slate-700 dark:border-slate-800 dark:bg-slate-950/35 dark:text-slate-200';
  const newSessionSegmentButtonClass = 'h-full px-2.5 text-[11px] font-semibold transition lg:px-3';
  const newSessionUnavailableSegmentClass =
    'cursor-not-allowed bg-slate-100/85 text-slate-400 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.2)] hover:bg-slate-100/85 dark:bg-slate-900/90 dark:text-slate-600 dark:shadow-[inset_0_0_0_1px_rgba(51,65,85,0.85)] dark:hover:bg-slate-900/90';

  return (
    <>
      {mode === 'home' && (
        <HomeDashboard
          error={error}
          isLoaded={isLoaded}
          homeSearchQuery={homeSearchQuery}
          homeProjectSort={homeProjectSort}
          showLogout={showLogout}
          logoutEnabled={logoutEnabled}
          themeModeLabel={themeModeLabel}
          nextThemeModeLabel={nextThemeModeLabel}
          ThemeModeIcon={ThemeModeIcon}
          filteredRecentProjects={filteredRecentProjects}
          quickCreateActiveCount={0}
          failedQuickCreateDrafts={[]}
          isDarkThemeActive={isDarkThemeActive}
          runningSessionCountByProject={runningSessionCountByProject}
          runningSessionsByProject={runningSessionsByProject}
          draftCountByProject={draftCountByProject}
          projectCardIconByPath={repoCardIconByRepo}
          brokenProjectCardIcons={brokenRepoCardIcons}
          getProjectDisplayName={getProjectDisplayName}
          projectGitReposByPath={projectGitReposByPath}
          discoveringProjectGitRepos={discoveringHomeProjectGitRepos}
          onHomeSearchQueryChange={setHomeSearchQuery}
          onHomeProjectSortChange={handleHomeProjectSortChange}
          onOpenCredentials={() => router.push('/settings')}
          onCycleThemeMode={handleCycleThemeMode}
          onSelectProject={handleSelectRepo}
          onOpenSession={handleOpenHomeProjectSession}
          onOpenGitWorkspace={handleOpenProjectGitWorkspace}
          projectServiceStatusByProject={{}}
          projectServiceActionStateByProject={{}}
          onOpenQuickCreate={() => {}}
          onProjectServiceAction={async () => {}}
          onOpenProjectServiceLog={async () => {}}
          onOpenProjectSettings={handleOpenRepoSettings}
          onOpenProjectMemory={async () => {}}
          onRemoveRecent={handleRemoveRecent}
          onEditQuickCreateDraft={() => {}}
          onDeleteQuickCreateDraft={async () => {}}
          getProjectSecondaryLabel={getProjectSecondaryLabel}
          isProjectOpenable={isProjectOpenable}
          onProjectIconError={handleRepoIconError}
          onAddProject={openCloneRemoteDialog}
        />
      )}

      {mode === 'home' && (
        <RepoSettingsDialog
          key={`${repoForSettings ?? 'none'}:${isRepoSettingsDialogOpen ? 'open' : 'closed'}`}
          isOpen={isRepoSettingsDialogOpen}
          projectId={repoForSettings}
          projectForSettings={repoForSettings}
          projectName={repoAlias || (repoForSettings ? getProjectDisplayName(repoForSettings) : '')}
          projectFolderPaths={repoForSettings ? [repoForSettings] : []}
          defaultRoot={config?.defaultRoot || undefined}
          projectStartupCommand={repoStartupCommand}
          projectDevServerCommand={repoDevServerCommand}
          projectServiceStartCommand={repoServiceStartCommand}
          projectServiceStopCommand={repoServiceStopCommand}
          defaultProjectStartupCommand={DEFAULT_PROJECT_STARTUP_COMMAND}
          defaultProjectDevServerCommand={DEFAULT_PROJECT_DEV_SERVER_COMMAND}
          defaultProjectServiceStartCommand={DEFAULT_PROJECT_SERVICE_START_COMMAND}
          defaultProjectServiceStopCommand={DEFAULT_PROJECT_SERVICE_STOP_COMMAND}
          projectIconPath={projectIconForSettings.iconPath ?? null}
          projectIconEmoji={projectIconForSettings.iconEmoji ?? null}
          isSavingProjectSettings={isSavingRepoSettings}
          isUploadingProjectIcon={isUploadingProjectIcon}
          projectSettingsError={repoSettingsError}
          onNameChange={setRepoAlias}
          onAddFolderPath={() => {}}
          onRemoveFolderPath={() => {}}
          onStartupCommandChange={setRepoStartupCommand}
          onDevServerCommandChange={setRepoDevServerCommand}
          onServiceStartCommandChange={setRepoServiceStartCommand}
          onServiceStopCommandChange={setRepoServiceStopCommand}
          onUploadIcon={(iconPath) => {
            void handleUploadProjectIcon(iconPath);
          }}
          onChooseEmoji={(iconEmoji) => {
            void handleChooseProjectIconEmoji(iconEmoji);
          }}
          onRemoveIcon={() => {
            void handleRemoveProjectIcon();
          }}
          onClose={dismissRepoSettingsDialog}
          onSave={() => {
            void handleSaveRepoSettings();
          }}
        />
      )}

      {mode === 'home' && (
        <CloneRemoteDialog
          isOpen={isCloneRemoteDialogOpen}
          defaultRoot={config?.defaultRoot}
          remoteRepoUrl={remoteRepoUrl}
          cloneCredentialSelection={cloneCredentialSelection}
          credentialOptions={credentialOptions}
          isCloningRemote={isCloningRemote}
          isLoadingCloneCredentialOptions={isLoadingCloneCredentialOptions}
          cloneRemoteError={cloneRemoteError}
          onClose={dismissCloneRemoteDialog}
          onRemoteRepoUrlChange={setRemoteRepoUrl}
          onCloneCredentialSelectionChange={setCloneCredentialSelection}
          onSetDefaultFolder={handleSetDefaultRoot}
          onCloneProject={() => {
            void handleCloneRemoteRepo();
          }}
        />
      )}

      {mode === 'home' && homeProjectGitSelector && (
        <div className="app-dark-overlay fixed inset-0 z-[1003] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl app-dark-modal">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-white/10">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Select Git Repository</h3>
              <button
                className="btn btn-circle btn-ghost btn-sm"
                onClick={() => setHomeProjectGitSelector(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-5">
              <p className="break-all font-mono text-xs text-slate-600 dark:text-slate-300">
                {homeProjectGitSelector.projectPath}
              </p>
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {homeProjectGitSelector.repos.map((repoEntry) => (
                  <button
                    key={repoEntry.repoPath}
                    type="button"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 app-dark-input app-dark-hover"
                    onClick={() => {
                      setHomeProjectGitSelector(null);
                      router.push(`/git?path=${encodeURIComponent(repoEntry.repoPath)}`);
                    }}
                    title={repoEntry.repoPath}
                  >
                    <span className="block truncate font-mono text-xs">{repoEntry.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      {mode === 'new' && selectedRepo && (
        <div className="w-full max-w-[1380px]">
          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-900/30 dark:text-red-200">
              {error}
            </div>
          )}

          <div className={`mb-5 flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 ${newSessionToolbarClass}`}>
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                onClick={() => { void handleReturnHome(); }}
                aria-label="Back to home"
              >
                <ChevronRight className="h-4 w-4 rotate-180" />
              </button>
              <div className="min-w-0">
                <div className="text-base font-semibold tracking-tight text-slate-900 dark:text-white">New Session</div>
                <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                  Configure the environment and describe the work for your coding agent.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
            <div className="self-start space-y-6 lg:col-span-3">
              <div className={newSessionPanelClass}>
                <h3 className="mb-5 flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
                  <FolderGit2 className="h-5 w-5 text-primary" />
                  Context Setup
                </h3>

                <div className="space-y-4">
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Select Project</span>
                    <div className="relative">
                      <select
                        className={`h-12 w-full appearance-none rounded-lg px-3 pr-10 font-mono text-sm ${newSessionControlClass}`}
                        value={selectedRepo}
                        onChange={(event) => {
                          void handleCurrentRepoChange(event);
                        }}
                        disabled={loading || selectableProjects.length === 0}
                      >
                        {selectableProjects.map((projectPath) => (
                          <option key={projectPath} value={projectPath}>
                            {getProjectDisplayName(projectPath)}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-500" />
                    </div>
                    <span
                      className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400"
                      title={resolvedSelectedProject?.secondaryLabel || selectedRepo || ''}
                    >
                      {resolvedSelectedProject?.secondaryLabel || selectedRepo}
                    </span>
                  </label>

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Git Repositories</span>
                      {selectedProjectGitReposCacheState.isRefreshing ? (
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          Refreshing cached repos...
                        </span>
                      ) : null}
                    </div>
                    {isLoadingProjectGitRepos ? (
                      <div className={`flex h-12 items-center rounded-lg px-3 text-sm text-slate-500 dark:text-slate-400 ${newSessionRaisedSurfaceClass}`}>
                        <span className="loading loading-spinner loading-xs mr-2"></span>
                        Discovering repositories...
                      </div>
                    ) : projectGitRepos.length === 0 ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/40 dark:bg-amber-900/30 dark:text-amber-200">
                        No Git repositories found. This session will run in folder mode.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {projectGitRepos.map((repoPath) => {
                          const repoBranches = branchesByRepo[repoPath] ?? [];
                          const selectedBaseBranch = baseBranchByRepo[repoPath] || '';
                          const displayRepoPath = getRepoDisplayPath(repoPath, projectGitRepos.length);
                          return (
                            <div key={repoPath} className={`rounded-lg p-2 ${newSessionSurfaceClass}`}>
                              <div className="truncate font-mono text-[11px] text-slate-600 dark:text-slate-300" title={repoPath}>
                                {displayRepoPath}
                              </div>
                              <div className="relative mt-2">
                                <select
                                  className={`h-10 w-full appearance-none rounded-md px-2 pr-8 font-mono text-xs ${newSessionControlClass}`}
                                  value={selectedBaseBranch}
                                  onChange={(event) => handleBranchChange(repoPath, event.target.value)}
                                  disabled={loading || repoBranches.length === 0}
                                >
                                  {repoBranches.length === 0 ? (
                                    <option value="">No local branches</option>
                                  ) : repoBranches.map((branch) => (
                                    <option key={branch.name} value={branch.name}>
                                      {branch.name}
                                      {branch.current ? ' (checked out)' : ''}
                                    </option>
                                  ))}
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 dark:text-slate-500" />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {isProjectGitReposTruncated && (
                      <div className="text-[11px] text-amber-700 dark:text-amber-300">
                        Repository discovery was truncated due to scan limits.
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                    onClick={() => setShowSessionAdvanced((prev) => !prev)}
                  >
                    <ChevronRight className={`h-4 w-4 transition-transform ${showSessionAdvanced ? 'rotate-90' : ''}`} />
                    {showSessionAdvanced ? 'Hide Advanced Setup' : collapsedSessionSetupLabel}
                  </button>

                  {showSessionAdvanced && (
                    <div className={`space-y-4 rounded-xl p-3 ${newSessionSurfaceClass}`}>
                      <label className="flex flex-col gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Start Up Command</span>
                        <textarea
                          className={`min-h-[86px] rounded-lg px-3 py-2 font-mono text-sm ${newSessionControlClass}`}
                          placeholder="npm install"
                          value={startupScript}
                          onChange={handleStartupScriptChange}
                          onBlur={saveStartupScript}
                          onKeyDown={(event) => {
                            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                              event.preventDefault();
                              handleStartSession();
                            }
                          }}
                          disabled={loading}
                        />
                      </label>

                      <label className="flex flex-col gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Dev Server Command</span>
                        <textarea
                          className={`min-h-[86px] rounded-lg px-3 py-2 font-mono text-sm ${newSessionControlClass}`}
                          placeholder="npm run dev"
                          value={devServerScript}
                          onChange={handleDevServerScriptChange}
                          onBlur={saveDevServerScript}
                          onKeyDown={(event) => {
                            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                              event.preventDefault();
                              handleStartSession();
                            }
                          }}
                          disabled={loading}
                        />
                      </label>

                    </div>
                  )}
                </div>
              </div>

              <div className={newSessionPanelClass}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Ongoing Tasks</h3>
                  {selectedProjectActivityCacheState.isRefreshing ? (
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Refreshing cached tasks...
                    </span>
                  ) : null}
                </div>
                <div className="space-y-2">
                  {isLoadingProjectActivity ? (
                    <div className={`flex items-center rounded-lg px-3 py-4 text-sm text-slate-500 dark:text-slate-400 ${newSessionSurfaceClass}`}>
                      <span className="loading loading-spinner loading-xs mr-2"></span>
                      Loading ongoing tasks...
                    </div>
                  ) : existingSessions.length === 0 && (
                    <div className="rounded-lg border border-dashed border-slate-200/70 bg-white/20 px-3 py-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/20 dark:text-slate-400">
                      No ongoing sessions for this project.
                    </div>
                  )}

                  {!isLoadingProjectActivity && existingSessions.map((session) => {
                    const sessionStatus = deriveSessionStatus(session.runState);
                    return (
                      <div
                        key={session.sessionName}
                        className="relative rounded-lg border border-transparent px-3 py-3 transition-colors hover:border-slate-100 hover:bg-slate-50 dark:hover:border-slate-700/70 dark:hover:bg-slate-800/50"
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${deletingSessionName === session.sessionName ? 'animate-pulse bg-amber-400' : getSessionStatusDotTone(sessionStatus)
                              }`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start gap-2">
                              <p className="min-w-0 flex-1 line-clamp-3 text-sm font-medium leading-5 text-slate-900 dark:text-white">
                                {session.title || session.sessionName}
                              </p>
                              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${getSessionStatusBadgeTone(sessionStatus)}`}>
                                {formatSessionStatus(sessionStatus)}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3 pl-5">
                          <p className="min-w-0 flex-1 truncate text-xs text-slate-500 dark:text-slate-400">
                            {getProjectDisplayName(session.projectPath || session.repoPath || '')}
                            {' • '}
                            {agentProviderLabel(session.agentProvider || session.agent, agentProviders)}
                            {session.model ? ` • ${session.model}` : ''}
                          </p>
                          <div className="flex shrink-0 items-center justify-end gap-1">
                            <button
                              type="button"
                              className="rounded p-1 text-slate-400 transition-colors hover:text-primary dark:text-slate-400 dark:hover:text-primary"
                              title="Open"
                              onClick={() => handleResumeSession(session)}
                              disabled={loading || deletingSessionName === session.sessionName}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-slate-400 transition-colors hover:text-amber-500 dark:text-slate-400 dark:hover:text-amber-400"
                              title="New Attempt"
                              onClick={() => handleNewAttemptFromSession(session)}
                              disabled={loading || deletingSessionName === session.sessionName}
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-slate-400 transition-colors hover:text-red-500 dark:text-slate-400 dark:hover:text-red-400"
                              title={deletingSessionName === session.sessionName ? 'Deleting...' : 'Delete'}
                              onClick={() => handleDeleteSession(session)}
                              disabled={loading || deletingSessionName === session.sessionName}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className={newSessionPanelClass}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Drafts</h3>
                  {selectedProjectActivityCacheState.isRefreshing ? (
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Refreshing cached drafts...
                    </span>
                  ) : null}
                </div>
                <div className="space-y-2">
                  {isLoadingProjectActivity ? (
                    <div className={`flex items-center rounded-lg px-3 py-4 text-sm text-slate-500 dark:text-slate-400 ${newSessionSurfaceClass}`}>
                      <span className="loading loading-spinner loading-xs mr-2"></span>
                      Loading drafts...
                    </div>
                  ) : existingDrafts.length === 0 && (
                    <div className="rounded-lg border border-dashed border-slate-200/70 bg-white/20 px-3 py-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/20 dark:text-slate-400">
                      No drafts for this project.
                    </div>
                  )}

                  {!isLoadingProjectActivity && existingDrafts.map((draft) => (
                    <div
                      key={draft.id}
                      className="group relative flex items-center gap-3 rounded-lg border border-transparent px-3 py-3 transition-colors hover:border-slate-100 hover:bg-slate-50 dark:hover:border-slate-700/70 dark:hover:bg-slate-800/50"
                    >
                      <div
                        className={`h-2 w-2 flex-shrink-0 rounded-full bg-primary`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{draft.title}</p>
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                          {getProjectDisplayName(draft.projectPath || draft.repoPath || '')}
                          {' • '}
                          {agentProviderLabel(draft.agentProvider, agentProviders)}
                          {draft.model ? ` • ${draft.model}` : ''}
                          {draft.reasoningEffort ? ` • ${draft.reasoningEffort}` : ''}
                        </p>
                      </div>
                      <div className="ml-2 flex w-[56px] items-center justify-end gap-1 overflow-hidden opacity-100 transition-[width,opacity] duration-200 sm:w-0 sm:opacity-0 sm:group-hover:w-[56px] sm:group-hover:opacity-100">
                        <button
                          type="button"
                          className="rounded p-1 text-slate-400 transition-colors hover:text-primary dark:text-slate-400 dark:hover:text-primary"
                          title="Open Draft"
                          onClick={() => handleOpenDraft(draft)}
                          disabled={loading || isSavingDraft}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="rounded p-1 text-slate-400 transition-colors hover:text-red-500 dark:text-slate-400 dark:hover:text-red-400"
                          title="Delete Draft"
                          onClick={() => handleDeleteDraft(draft.id)}
                          disabled={loading || isSavingDraft}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="self-start lg:col-span-9">
              <div
                ref={taskDescriptionPanelRef}
                className={`flex h-full flex-col ${newSessionPanelClass}`}
              >
                <div className="mb-4 space-y-3">
                  <div className={`flex gap-2 ${isStackedTaskHeader ? 'flex-col' : 'flex-row items-center justify-between'}`}>
                    <label className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white" htmlFor="task-description">
                      <Bot className="h-5 w-5 text-primary" />
                      Task Description
                    </label>
                    <div className={`flex flex-1 flex-wrap items-center gap-1.5 ${isStackedTaskHeader ? '' : 'justify-end'}`}>
                      <div
                        className={`inline-flex h-9 items-center overflow-hidden rounded-lg ${newSessionRaisedSurfaceClass}`}
                        role="group"
                        aria-label="Session mode"
                      >
                        <button
                          type="button"
                          className={cn(
                            newSessionSegmentButtonClass,
                            sessionMode === 'fast'
                              ? 'bg-primary text-white'
                              : 'text-slate-700 hover:bg-slate-50/80 dark:text-slate-300 dark:hover:bg-slate-900/70',
                          )}
                          onClick={() => handleSessionModeChange('fast')}
                          aria-pressed={sessionMode === 'fast'}
                          disabled={loading}
                          title="Fast"
                        >
                          {isCompactTaskHeader ? (
                            <Zap className="h-3.5 w-3.5" />
                          ) : (
                            <span>Fast</span>
                          )}
                        </button>
                        <div className="h-5 w-px bg-slate-200/80 dark:bg-slate-800" />
                        <button
                          type="button"
                          className={cn(
                            newSessionSegmentButtonClass,
                            sessionMode === 'plan'
                              ? 'bg-primary text-white'
                              : 'text-slate-700 hover:bg-slate-50/80 dark:text-slate-300 dark:hover:bg-slate-900/70',
                          )}
                          onClick={() => handleSessionModeChange('plan')}
                          aria-pressed={sessionMode === 'plan'}
                          disabled={loading}
                          title="Plan"
                        >
                          {isCompactTaskHeader ? (
                            <FileText className="h-3.5 w-3.5" />
                          ) : (
                            <span>Plan</span>
                          )}
                        </button>
                      </div>

                      <div
                        className={`inline-flex h-9 items-center overflow-hidden rounded-lg ${newSessionRaisedSurfaceClass}`}
                        role="group"
                        aria-label="Task location"
                      >
                        <button
                          type="button"
                          className={cn(
                            newSessionSegmentButtonClass,
                            sessionWorkspacePreference === 'local'
                              ? 'bg-primary text-white'
                              : 'text-slate-700 hover:bg-slate-50/80 dark:text-slate-300 dark:hover:bg-slate-900/70',
                          )}
                          onClick={() => handleSessionWorkspacePreferenceChange('local')}
                          aria-pressed={sessionWorkspacePreference === 'local'}
                          disabled={loading}
                          title="Local"
                        >
                          {isCompactTaskHeader ? (
                            <HardDrive className="h-3.5 w-3.5" />
                          ) : (
                            <span>Local</span>
                          )}
                        </button>
                        <div className="h-5 w-px bg-slate-200/80 dark:bg-slate-800" />
                        <button
                          type="button"
                          className={cn(
                            newSessionSegmentButtonClass,
                            sessionWorkspacePreference === 'workspace'
                              ? 'bg-primary text-white'
                              : 'text-slate-700 hover:bg-slate-50/80 dark:text-slate-300 dark:hover:bg-slate-900/70',
                            isFolderlessSelectedProject && newSessionUnavailableSegmentClass,
                          )}
                          onClick={() => handleSessionWorkspacePreferenceChange('workspace')}
                          aria-pressed={sessionWorkspacePreference === 'workspace'}
                          disabled={loading || isFolderlessSelectedProject}
                          title={isFolderlessSelectedProject ? 'Workspace mode requires an associated folder' : 'Workspace'}
                        >
                          {isCompactTaskHeader ? (
                            <Layers className="h-3.5 w-3.5" />
                          ) : (
                            <span>Workspace</span>
                          )}
                        </button>
                      </div>

                      <div className="relative w-[126px] sm:w-[132px]">
                        <div className="relative">
                          <select
                            className={`h-9 w-full appearance-none rounded-lg px-2.5 pr-8 text-[11px] ${newSessionControlClass}`}
                            value={selectedAgentProvider}
                            onChange={handleAgentProviderChange}
                            disabled={loading}
                            aria-label="Agent runtime"
                          >
                            {(agentProviders.length > 0 ? agentProviders : SUPPORTED_AGENT_PROVIDERS.map((providerId) => ({
                              id: providerId,
                              label: agentProviderLabel(providerId),
                              description: '',
                              available: true,
                            }))).map((provider) => (
                              <option key={provider.id} value={provider.id}>
                                {provider.label}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 dark:text-slate-500" />
                        </div>
                      </div>

                      <div className="relative w-[116px] sm:w-[124px]">
                        <div className="relative">
                          <select
                            className={`h-9 w-full appearance-none rounded-lg px-2.5 pr-8 text-[11px] disabled:cursor-not-allowed disabled:opacity-60 ${newSessionControlClass}`}
                            value={selectedAgentModel}
                            onChange={handleAgentModelChange}
                            disabled={loading || (activeAgentModelCatalog.models.length === 0 && !selectedAgentModel.trim())}
                            aria-label="Model"
                          >
                            {selectableModelOptions.map((model) => (
                              <option key={model.id || 'default-model'} value={model.id}>
                                {model.label}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 dark:text-slate-500" />
                        </div>
                      </div>

                      {selectedAgentProvider === 'codex' && reasoningEffortOptions.length > 0 && (
                        <div className="relative w-[96px] sm:w-[104px]">
                          <div className="relative">
                            <select
                              className={`h-9 w-full appearance-none rounded-lg px-2.5 pr-8 text-[11px] disabled:cursor-not-allowed disabled:opacity-60 ${newSessionControlClass}`}
                              value={selectedReasoningEffort}
                              onChange={handleReasoningEffortChange}
                              disabled={loading}
                              aria-label="Reasoning effort"
                            >
                              {reasoningEffortOptions.map((effort) => (
                                <option key={effort} value={effort}>
                                  {effort}
                                </option>
                              ))}
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 dark:text-slate-500" />
                          </div>
                        </div>
                      )}

                      {hasPredefinedPrompts && (
                        <div className="relative w-[120px] sm:w-[132px]">
                          <div className="relative">
                            <select
                              className={`h-9 w-full appearance-none rounded-lg px-2.5 pr-8 font-mono text-[11px] ${newSessionControlClass}`}
                              value={activePredefinedPrompt?.id ?? ''}
                              onChange={(event) => handleSelectPredefinedPrompt(event.target.value)}
                              disabled={loading}
                              aria-label="Select predefined prompt"
                            >
                              <option value="">Select Prompt</option>
                              {predefinedPromptGroups.map(({ group, prompts }) => (
                                <optgroup key={group} label={group}>
                                  {prompts.map((prompt) => (
                                    <option key={prompt.id} value={prompt.id}>
                                      {prompt.label}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 dark:text-slate-500" />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 rounded-xl border border-slate-200/70 bg-white/20 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-950/20 dark:text-slate-400 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium text-slate-600 dark:text-slate-300">
                        {agentProviderLabel(selectedAgentProvider, agentProviders)}
                      </span>
                      <span>{agentStatusSummary}</span>
                      {agentAccountSummary && (
                        <span className="truncate" title={agentAccountSummary}>
                          {agentAccountSummary}
                        </span>
                      )}
                      {selectedModelOption?.description && (
                        <span className="truncate" title={selectedModelOption.description || undefined}>
                          {selectedModelOption.description}
                        </span>
                      )}
                      {isFolderlessSelectedProject ? (
                        <span>This project has no associated folders. The session will start in local mode from your home directory.</span>
                      ) : sessionWorkspacePreference === 'local' ? (
                        <span>Local mode applies changes directly to the selected source folder.</span>
                      ) : isPreparingWorkspace ? (
                        <span>Prewarming workspace...</span>
                      ) : preparedWorkspace ? (
                        <span className="text-emerald-600 dark:text-emerald-400">Workspace ready</span>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-slate-200/70 bg-white/35 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50/80 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:bg-slate-950/35 dark:text-slate-200 dark:hover:bg-slate-900/70"
                        onClick={() => void fetchAgentStatus(selectedAgentProvider)}
                        disabled={loading || isLoadingAgentStatus}
                      >
                        Refresh
                      </button>
                      {!displayedAgentStatus?.installed && (
                        <button
                          type="button"
                          className="rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-amber-700 dark:hover:bg-[var(--app-dark-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => void handleInstallAgentProvider(selectedAgentProvider)}
                          disabled={loading || isInstallingAgentProvider}
                        >
                          {isInstallingAgentProvider && installingAgentProvider === selectedAgentProvider
                            ? 'Installing...'
                            : 'Install'}
                        </button>
                      )}
                      {displayedAgentStatus?.installed && !displayedAgentStatus.loggedIn && (
                        <button
                          type="button"
                          className="rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-amber-700 dark:hover:bg-[var(--app-dark-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => void handleAgentLogin(selectedAgentProvider)}
                          disabled={loading || isWaitingForLogin}
                        >
                          {isWaitingForLogin && waitingForLoginProvider === selectedAgentProvider
                            ? 'Waiting for login...'
                            : 'Log In'}
                        </button>
                      )}
                    </div>
                  </div>

                  {agentSetupMessage && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/12 dark:text-amber-200">
                      {agentSetupMessage}
                    </div>
                  )}
                </div>

                <div className="group relative mb-4 flex h-[360px] flex-grow flex-col md:h-[420px]">
                  <textarea
                    id="task-description"
                    className="h-full w-full resize-none rounded-xl border border-slate-200/70 bg-white/20 p-5 font-mono text-sm leading-relaxed text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30 dark:border-slate-800 dark:bg-slate-950/20 dark:text-slate-100 dark:placeholder:text-slate-500"
                    placeholder={`Describe the task for the AI agent...\nExample:\n1. Create a new component for the user profile card.\n2. Ensure it fetches data from the /api/user endpoint.\n3. Add error handling for failed requests.\n\nTip: Type @ to mention files or folders, and $ to mention skills.`}
                    value={initialMessage}
                    onChange={handleMessageChange}
                    onPaste={(event) => {
                      void handleTaskDescriptionPaste(event);
                    }}
                    onKeyDown={handleKeyDown}
                    onClick={(event) => {
                      const nextCursorPosition = event.currentTarget.selectionStart;
                      latestCursorPositionRef.current = nextCursorPosition;
                      setCursorPosition(nextCursorPosition);
                      hideSuggestions();
                    }}
                    onKeyUp={(event) => {
                      const nextCursorPosition = event.currentTarget.selectionStart;
                      latestCursorPositionRef.current = nextCursorPosition;
                      setCursorPosition(nextCursorPosition);
                    }}
                    disabled={loading}
                  />

                  {showSuggestions && suggestionList.length > 0 && (
                    <div className="absolute left-3 right-3 top-[calc(100%-8rem)] z-50 max-h-48 overflow-y-auto rounded-lg border border-slate-200/70 bg-white/95 shadow-lg backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
                      {suggestionList.map((suggestion, idx) => (
                        <button
                          key={suggestion}
                          className={`w-full truncate border-b border-slate-100 px-3 py-2 text-left text-xs last:border-0 ${idx === selectedIndex
                              ? 'bg-primary text-white'
                              : 'text-slate-700 hover:bg-slate-50 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-800/60'
                            }`}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            handleSelectSuggestion(suggestion);
                          }}
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-100 pt-4 dark:border-slate-700/70">
                  <input
                    ref={mobileAttachmentInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleMobileAttachmentSelection}
                  />
                  <div className="mb-3 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
                    <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Attachments</h4>
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 text-sm font-medium text-primary transition-colors hover:text-amber-700 dark:hover:text-[var(--app-dark-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={handleSelectAttachments}
                      disabled={loading || !selectedRepo || isUploadingTaskAttachments}
                    >
                      <CloudDownload className="h-4 w-4" />
                      Select Attachments
                    </button>
                  </div>
                  {isPastingTaskAttachments && (
                    <div className="mb-2 text-xs text-slate-500 dark:text-slate-400">Saving pasted image attachments...</div>
                  )}
                  {isUploadingTaskAttachments && (
                    <div className="mb-2 text-xs text-slate-500 dark:text-slate-400">Uploading selected attachments...</div>
                  )}

                  <div className="min-h-[88px] rounded-xl border-2 border-dashed border-slate-200/70 bg-white/20 p-3 dark:border-slate-800 dark:bg-slate-950/20">
                    <div className="flex flex-wrap gap-2">
                      {attachments.map((attachmentPath, idx) => (
                        <span
                          key={`upload-${attachmentPath}-${idx}`}
                          className={`inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1 text-xs ${newSessionChipClass}`}
                          title={attachmentPath}
                        >
                          <span className="truncate">{getBaseName(attachmentPath)}</span>
                          <button
                            type="button"
                            className="rounded text-slate-500 transition hover:text-red-500 dark:text-slate-400 dark:hover:text-red-400"
                            onClick={() => removeAttachment(idx)}
                            title="Remove attachment"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}

                      {prefilledAttachmentPaths.map((attachmentPath, idx) => (
                        <span
                          key={`prefill-${attachmentPath}-${idx}`}
                          className={`inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1 text-xs ${newSessionChipClass}`}
                          title={attachmentPath}
                        >
                          <span className="truncate">{getBaseName(attachmentPath)}</span>
                          <button
                            type="button"
                            className="rounded text-slate-500 transition hover:text-red-500 dark:text-slate-400 dark:hover:text-red-400"
                            onClick={() => removePrefilledAttachment(idx)}
                            title="Remove carried attachment"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}

                      {(attachments.length === 0 && prefilledAttachmentPaths.length === 0) && (
                        <span className="text-xs text-slate-500 dark:text-slate-400">No attachments selected.</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-5 dark:border-slate-700/70">
                  <span className="mr-auto hidden text-xs text-slate-400 dark:text-slate-500 sm:block">
                    Press <kbd className="rounded border border-slate-200 bg-slate-100 px-2 py-1 font-sans text-[11px] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">Enter</kbd> to submit, <kbd className="rounded border border-slate-200 bg-slate-100 px-2 py-1 font-sans text-[11px] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">Shift+Enter</kbd> for new line
                  </span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-200 px-5 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-300 dark:bg-slate-700 dark:text-white dark:hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-70"
                    onClick={handleSaveDraft}
                    disabled={loading || isSavingDraft}
                  >
                    {isSavingDraft ? <span className="loading loading-spinner loading-xs"></span> : 'Save Draft'}
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white shadow-md shadow-primary/20 transition hover:bg-amber-700 dark:hover:bg-[var(--app-dark-accent-hover)] disabled:cursor-not-allowed disabled:opacity-70"
                    onClick={handleStartSession}
                    disabled={loading || isSavingDraft}
                  >
                    {loading ? <span className="loading loading-spinner loading-xs"></span> : 'Create New Task'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {mode === 'new' && !selectedRepo && !!repoPath && !error && (
        <div className="w-full max-w-2xl rounded-2xl border border-slate-200/70 bg-white/88 p-8 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/88 dark:shadow-[0_16px_36px_-24px_rgba(2,6,23,0.95)]">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="loading loading-spinner loading-lg text-primary"></span>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Loading project...</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Preparing your task workspace.</p>
          </div>
        </div>
      )}

      {mode === 'new' && isInstallingAgentProvider && installingAgentProvider && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-base-content/45 px-4">
          <div className="w-full max-w-3xl rounded-xl border border-base-300 bg-base-100 p-6 shadow-2xl">
            <div className="flex items-start gap-4">
              <span className="loading loading-spinner loading-lg text-primary"></span>
              <div className="min-w-0 flex-1 space-y-4">
                <div className="space-y-1">
                  <h3 className="text-lg font-semibold">
                    Installing {agentProviderLabel(installingAgentProvider, agentProviders)}
                  </h3>
                  <p className="text-sm opacity-70">
                    The runtime is being installed in the background. You can close this dialog after it completes.
                  </p>
                </div>
                <pre className="max-h-[360px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-950 px-4 py-3 font-mono text-[11px] text-slate-100">
                  {installLogs.join('\n') || 'Waiting for install output...'}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {mode === 'new' && !selectedRepo && (!repoPath || !!error) && (
        <div className="card w-full max-w-2xl bg-base-200 shadow-xl">
          <div className="card-body">
            <h2 className="card-title flex items-center gap-2">
              <FolderGit2 className="w-6 h-6 text-primary" />
              Project Selector
            </h2>
            {isResolvingRepoFromName ? (
              <div className="alert text-sm py-2 px-3 mt-2 flex items-center gap-2">
                <span className="loading loading-spinner loading-sm"></span>
                {fromRepoName
                  ? `Searching for project "${fromRepoName}"...`
                  : 'Searching for project...'}
              </div>
            ) : error ? (
              <div className="alert alert-error text-sm py-2 px-3 mt-2">{error}</div>
            ) : (
              <div className="text-sm opacity-70 mt-2">No project specified.</div>
            )}
            <div className="mt-4">
              <button className="btn btn-primary btn-sm" onClick={() => { void handleReturnHome(); }}>
                Choose Project
              </button>
            </div>
          </div>
        </div>
      )}


      {mode === 'new' && selectedRepo && isAttachmentBrowserOpen && (
        <SessionFileBrowser
          initialPath={lastAttachmentBrowserPath || selectedRepoFilesystemPath || selectedRepo}
          onPathChange={setLastAttachmentBrowserPath}
          onConfirm={async (paths) => {
            appendAttachmentPaths(paths);
            setIsAttachmentBrowserOpen(false);
          }}
          onCancel={() => setIsAttachmentBrowserOpen(false)}
        />
      )}

      {mode === 'home' && isBrowsing && (
        <FileBrowser
          initialPath={config?.defaultRoot || undefined}
          onSelect={(path) => handleSelectRepo(path, { navigateToNewInHome: false })}
          onCancel={() => setIsBrowsing(false)}
        />
      )}

      {mode === 'home' && isSelectingRoot && (
        <FileBrowser
          title="Default Root Folder"
          initialPath={config?.defaultRoot || undefined}
          onSelect={handleSetDefaultRoot}
          onCancel={() => setIsSelectingRoot(false)}
        />
      )}

      {appDialog}
    </>
  );
}
