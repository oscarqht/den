'use client';

import dynamic from 'next/dynamic';
import { useQueryClient } from '@tanstack/react-query';
import { Monitor, Moon, Sun, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { getConfig, updateConfig, updateProjectSettings, type Config } from '@/app/actions/config';
import { listCredentials } from '@/app/actions/credentials';
import { listDrafts, type DraftMetadata } from '@/app/actions/draft';
import { cloneRemoteProject, discoverProjectGitRepos } from '@/app/actions/project';
import {
  deleteQuickCreateDraft,
  getHomeQuickCreateState,
  startQuickCreateTask,
} from '@/app/actions/quick-create';
import { listSessions, type SessionMetadata } from '@/app/actions/session';
import { useDialogKeyboardShortcuts } from '@/hooks/useDialogKeyboardShortcuts';
import { useToast } from '@/hooks/use-toast';
import {
  DEFAULT_HOME_PROJECT_SORT,
  normalizeHomeProjectSort,
  sortHomeProjects,
  type HomeProjectSort,
} from '@/lib/home-project-sort';
import { countHomeProjectSessionsByProject } from '@/lib/home-project-activity';
import {
  omitRecordKeys,
  toHomeProjectGitRepos,
  type HomeProjectGitRepo,
} from '@/lib/home-project-git';
import type { Credential } from '@/lib/credentials';
import {
  createClientProjectCompatibilityMap,
  findClientProjectByReference,
  getClientProjectCompatibilityKeys,
  resolveClientProjectActivityKey,
  resolveClientProjectReference,
  resolveClientRecentProjects,
} from '@/lib/project-client';
import type { QuickCreateDraft } from '@/lib/quick-create';
import { getQuickCreateTabId, subscribeToQuickCreateJobUpdates } from '@/lib/quick-create-updates';
import { subscribeToSessionsUpdated } from '@/lib/session-updates';
import {
  resolveShouldUseDarkTheme,
  THEME_MODE_STORAGE_KEY,
  THEME_REFRESH_EVENT,
} from '@/lib/ttyd-theme';
import type { Project } from '@/lib/types';
import { useProjects } from '@/hooks/use-git';
import { HomeDashboard } from './git-repo-selector/HomeDashboard';
import type { RepoCredentialSelection } from './git-repo-selector/types';

const FileBrowser = dynamic(() => import('./FileBrowser'));
const RepoSettingsDialog = dynamic(() =>
  import('./git-repo-selector/RepoSettingsDialog').then((module) => module.RepoSettingsDialog),
);
const CreateProjectDialog = dynamic(() =>
  import('./git-repo-selector/CreateProjectDialog').then((module) => module.CreateProjectDialog),
);
const CloneRemoteDialog = dynamic(() =>
  import('./git-repo-selector/CloneRemoteDialog').then((module) => module.CloneRemoteDialog),
);
const QuickCreateTaskDialog = dynamic(() =>
  import('./QuickCreateTaskDialog').then((module) => module.QuickCreateTaskDialog),
);

type ThemeMode = 'auto' | 'light' | 'dark';

const DEFAULT_PROJECT_STARTUP_COMMAND = '';
const DEFAULT_PROJECT_DEV_SERVER_COMMAND = '';
const THEME_MODE_SEQUENCE: ThemeMode[] = ['auto', 'light', 'dark'];
const HOME_REPO_DISCOVERY_IDLE_TIMEOUT_MS = 4000;
const HOME_REPO_DISCOVERY_MAX_AUTOSTART = 3;
const HOME_PROJECT_SORT_STORAGE_KEY = 'palx-home-project-sort';

const repoCardTiltFrameByElement = new WeakMap<HTMLElement, number>();
const repoCardTiltRectByElement = new WeakMap<HTMLElement, DOMRect>();

function readIsDocumentForegrounded(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState === 'visible' && document.hasFocus();
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

type HomeDashboardContainerProps = {
  showLogout?: boolean;
  logoutEnabled?: boolean;
};

export default function HomeDashboardContainer({
  showLogout = false,
  logoutEnabled = true,
}: HomeDashboardContainerProps) {
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: projects = [] } = useProjects();
  const [config, setConfig] = useState<Config | null>(null);
  const [allSessions, setAllSessions] = useState<SessionMetadata[]>([]);
  const [allDrafts, setAllDrafts] = useState<DraftMetadata[]>([]);
  const [quickCreateDrafts, setQuickCreateDrafts] = useState<QuickCreateDraft[]>([]);
  const [quickCreateActiveCount, setQuickCreateActiveCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [homeSearchQuery, setHomeSearchQuery] = useState('');
  const [homeProjectSort, setHomeProjectSort] = useState<HomeProjectSort>(() => (
    readStoredHomeProjectSort() ?? DEFAULT_HOME_PROJECT_SORT
  ));
  const [themeMode, setThemeMode] = useState<ThemeMode>('auto');
  const [isDarkThemeActive, setIsDarkThemeActive] = useState(false);
  const [isHomePageForegrounded, setIsHomePageForegrounded] = useState<boolean>(() => readIsDocumentForegrounded());

  const [isSelectingRoot, setIsSelectingRoot] = useState(false);
  const [isRepoSettingsDialogOpen, setIsRepoSettingsDialogOpen] = useState(false);
  const [projectForSettingsId, setProjectForSettingsId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [projectFolderPaths, setProjectFolderPaths] = useState<string[]>([]);
  const [repoStartupCommand, setRepoStartupCommand] = useState(DEFAULT_PROJECT_STARTUP_COMMAND);
  const [repoDevServerCommand, setRepoDevServerCommand] = useState(DEFAULT_PROJECT_DEV_SERVER_COMMAND);
  const [projectIconPathForSettings, setProjectIconPathForSettings] = useState<string | null>(null);
  const [repoSettingsError, setRepoSettingsError] = useState<string | null>(null);
  const [isUploadingProjectIcon, setIsUploadingProjectIcon] = useState(false);
  const [isSavingRepoSettings, setIsSavingRepoSettings] = useState(false);
  const [isCreateProjectDialogOpen, setIsCreateProjectDialogOpen] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [createProjectError, setCreateProjectError] = useState<string | null>(null);

  const [isCloneRemoteDialogOpen, setIsCloneRemoteDialogOpen] = useState(false);
  const [remoteRepoUrl, setRemoteRepoUrl] = useState('');
  const [cloneCredentialSelection, setCloneCredentialSelection] =
    useState<RepoCredentialSelection>('auto');
  const [credentialOptions, setCredentialOptions] = useState<Credential[]>([]);
  const [cloneRemoteError, setCloneRemoteError] = useState<string | null>(null);
  const [isCloningRemote, setIsCloningRemote] = useState(false);
  const [isLoadingCloneCredentialOptions, setIsLoadingCloneCredentialOptions] = useState(false);

  const [brokenRepoCardIcons, setBrokenRepoCardIcons] = useState<Record<string, boolean>>({});
  const [projectGitReposByPath, setProjectGitReposByPath] = useState<Record<string, HomeProjectGitRepo[]>>({});
  const [discoveringHomeProjectGitRepos, setDiscoveringHomeProjectGitRepos] = useState<Record<string, boolean>>({});
  const [homeProjectGitSelector, setHomeProjectGitSelector] = useState<{
    projectKey: string;
    projectLabel: string;
    repos: HomeProjectGitRepo[];
  } | null>(null);
  const [projectPendingDeleteId, setProjectPendingDeleteId] = useState<string | null>(null);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [isQuickCreateDialogOpen, setIsQuickCreateDialogOpen] = useState(false);
  const [quickCreateDraftForEdit, setQuickCreateDraftForEdit] = useState<QuickCreateDraft | null>(null);

  const refreshQuickCreateState = useCallback(async () => {
    try {
      const state = await getHomeQuickCreateState();
      setQuickCreateDrafts(state.drafts);
      setQuickCreateActiveCount(state.activeCount);
    } catch (refreshError) {
      console.error('Failed to refresh quick create state:', refreshError);
    }
  }, []);

  const refreshActivity = useCallback(async () => {
    try {
      const [sessions, drafts] = await Promise.all([listSessions(), listDrafts()]);
      setAllSessions(sessions);
      setAllDrafts(drafts);
    } catch (refreshError) {
      console.error('Failed to refresh home activity:', refreshError);
    }
  }, []);

  const resolveProjectEntry = useCallback((projectReference: string) => (
    resolveClientProjectReference(projects, projectReference)
  ), [projects]);

  const getProjectByReference = useCallback((projectReference: string): Project | null => (
    findClientProjectByReference(projects, projectReference)
  ), [projects]);

  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      try {
        const [nextConfig, sessions, drafts, quickCreateState] = await Promise.all([
          getConfig(),
          listSessions(),
          listDrafts(),
          getHomeQuickCreateState(),
        ]);
        if (cancelled) return;
        setConfig(nextConfig);
        setHomeProjectSort(readStoredHomeProjectSort() ?? nextConfig.homeProjectSort);
        setAllSessions(sessions);
        setAllDrafts(drafts);
        setQuickCreateDrafts(quickCreateState.drafts);
        setQuickCreateActiveCount(quickCreateState.activeCount);
      } catch (loadError) {
        console.error('Failed to load home dashboard data:', loadError);
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
  }, []);

  useEffect(() => {
    const syncForegroundState = () => {
      setIsHomePageForegrounded(readIsDocumentForegrounded());
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
    try {
      const storedMode = window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
      if (storedMode === 'light' || storedMode === 'dark' || storedMode === 'auto') {
        setThemeMode(storedMode);
        return;
      }
    } catch {
      // Ignore localStorage access errors.
    }

    setThemeMode('auto');
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
      // Ignore localStorage access errors.
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
    const unsubscribe = subscribeToSessionsUpdated(() => {
      void refreshActivity();
    });
    void refreshActivity();
    return () => {
      unsubscribe();
    };
  }, [refreshActivity]);

  const dismissCreateProjectDialog = useCallback(() => {
    if (isCreatingProject) return;
    setIsCreateProjectDialogOpen(false);
    setCreateProjectError(null);
  }, [isCreatingProject]);

  const openCreateProjectDialog = useCallback(() => {
    setCreateProjectError(null);
    setIsCreateProjectDialogOpen(true);
  }, []);

  const handleSelectProject = useCallback(async (
    projectReference: string,
    options?: { navigateToNewInHome?: boolean },
  ) => {
    setError(null);

    try {
      const resolvedProject = resolveProjectEntry(projectReference);
      if (!resolvedProject.isOpenable || !resolvedProject.sessionReference) {
        setError('Failed to open project.');
        return false;
      }

      const currentConfig = config ?? await getConfig();
      if (!config) {
        setConfig(currentConfig);
      }

      const nextRecentKey = resolvedProject.project?.id ?? resolvedProject.sessionReference;
      const compatibilityKeys = resolvedProject.project
        ? getClientProjectCompatibilityKeys(resolvedProject.project)
        : [resolvedProject.sessionReference];
      const nextRecentProjects = [
        nextRecentKey,
        ...currentConfig.recentProjects.filter((projectEntry) => !compatibilityKeys.includes(projectEntry)),
      ];

      const nextConfig = arePathListsEqual(nextRecentProjects, currentConfig.recentProjects)
        ? currentConfig
        : await updateConfig({ recentProjects: nextRecentProjects });

      setConfig(nextConfig);

      if (options?.navigateToNewInHome !== false) {
        router.push(`/new?project=${encodeURIComponent(resolvedProject.sessionReference)}`);
      }

      return true;
    } catch (selectError) {
      console.error(selectError);
      setError('Failed to open project.');
      return false;
    }
  }, [config, resolveProjectEntry, router]);

  const dismissRepoSettingsDialog = useCallback(() => {
    if (isSavingRepoSettings) return;
    setIsRepoSettingsDialogOpen(false);
    setProjectForSettingsId(null);
    setProjectName('');
    setProjectFolderPaths([]);
    setRepoStartupCommand(DEFAULT_PROJECT_STARTUP_COMMAND);
    setRepoDevServerCommand(DEFAULT_PROJECT_DEV_SERVER_COMMAND);
    setProjectIconPathForSettings(null);
    setRepoSettingsError(null);
    setIsUploadingProjectIcon(false);
  }, [isSavingRepoSettings]);

  const handleOpenRepoSettings = useCallback(async (
    event: ReactMouseEvent,
    projectReference: string,
  ) => {
    event.stopPropagation();
    const resolvedProject = resolveProjectEntry(projectReference);
    if (!resolvedProject.project) {
      setError('Project metadata could not be loaded.');
      return;
    }

    const settings = config?.projectSettings?.[resolvedProject.project.id]
      || (resolvedProject.primaryPath ? config?.projectSettings?.[resolvedProject.primaryPath] : undefined);
    setProjectForSettingsId(resolvedProject.project.id);
    setProjectName(resolvedProject.project.name);
    setProjectFolderPaths(resolvedProject.project.folderPaths);
    setRepoStartupCommand(settings?.startupScript ?? DEFAULT_PROJECT_STARTUP_COMMAND);
    setRepoDevServerCommand(settings?.devServerScript ?? DEFAULT_PROJECT_DEV_SERVER_COMMAND);
    setProjectIconPathForSettings(resolvedProject.project.iconPath ?? null);
    setRepoSettingsError(null);
    setIsRepoSettingsDialogOpen(true);
  }, [config?.projectSettings, resolveProjectEntry]);

  const handleSaveRepoSettings = useCallback(async () => {
    if (!projectForSettingsId) return;

    const trimmedProjectName = projectName.trim();
    if (!trimmedProjectName) {
      setRepoSettingsError('Project name is required.');
      return;
    }

    const startupCommandToSave = repoStartupCommand.trim() || DEFAULT_PROJECT_STARTUP_COMMAND;
    const devServerCommandToSave =
      repoDevServerCommand.trim() || DEFAULT_PROJECT_DEV_SERVER_COMMAND;

    setIsSavingRepoSettings(true);
    setRepoSettingsError(null);
    try {
      const projectResponse = await fetch('/api/projects', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: projectForSettingsId,
          updates: {
            name: trimmedProjectName,
            folderPaths: projectFolderPaths,
          },
        }),
      });
      const projectPayload = await projectResponse.json().catch(() => null) as { error?: string } | null;
      if (!projectResponse.ok) {
        throw new Error(projectPayload?.error || 'Failed to save project.');
      }

      const nextConfig = await updateProjectSettings(projectForSettingsId, {
        startupScript: startupCommandToSave,
        devServerScript: devServerCommandToSave,
        alias: null,
      });
      setConfig(nextConfig);
      setProjectGitReposByPath((previous) => omitRecordKeys(previous, [projectForSettingsId]));
      setDiscoveringHomeProjectGitRepos((previous) => omitRecordKeys(previous, [projectForSettingsId]));
      setHomeProjectGitSelector((current) => (
        current?.projectKey === projectForSettingsId ? null : current
      ));
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      dismissRepoSettingsDialog();
    } catch (saveError) {
      console.error(saveError);
      setRepoSettingsError(
        saveError instanceof Error ? saveError.message : 'Failed to save project settings.',
      );
    } finally {
      setIsSavingRepoSettings(false);
    }
  }, [
    dismissRepoSettingsDialog,
    repoDevServerCommand,
    repoStartupCommand,
    projectFolderPaths,
    projectForSettingsId,
    projectName,
    queryClient,
  ]);

  const handleUploadProjectIcon = useCallback(async (iconPath: string) => {
    if (!projectForSettingsId || isUploadingProjectIcon) return;
    setRepoSettingsError(null);
    setIsUploadingProjectIcon(true);

    try {
      const response = await fetch('/api/projects/icon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: projectForSettingsId,
          iconPath,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to upload project icon.');
      }

      const uploadedIconPath = typeof payload?.iconPath === 'string' ? payload.iconPath : null;
      setProjectIconPathForSettings(uploadedIconPath);
      setBrokenRepoCardIcons((previous) => ({ ...previous, [projectForSettingsId]: false }));
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    } catch (uploadError) {
      console.error(uploadError);
      setRepoSettingsError(
        uploadError instanceof Error ? uploadError.message : 'Failed to upload project icon.',
      );
    } finally {
      setIsUploadingProjectIcon(false);
    }
  }, [isUploadingProjectIcon, projectForSettingsId, queryClient]);

  const handleRemoveProjectIcon = useCallback(async () => {
    if (!projectForSettingsId || isUploadingProjectIcon) return;
    setRepoSettingsError(null);
    setIsUploadingProjectIcon(true);

    try {
      const response = await fetch('/api/projects/icon', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: projectForSettingsId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to remove project icon.');
      }

      setProjectIconPathForSettings(null);
      setBrokenRepoCardIcons((previous) => ({ ...previous, [projectForSettingsId]: false }));
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    } catch (removeError) {
      console.error(removeError);
      setRepoSettingsError(
        removeError instanceof Error ? removeError.message : 'Failed to remove project icon.',
      );
    } finally {
      setIsUploadingProjectIcon(false);
    }
  }, [isUploadingProjectIcon, projectForSettingsId, queryClient]);

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
      } catch (loadError) {
        console.error(loadError);
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

  const dismissDeleteProjectDialog = useCallback(() => {
    if (isDeletingProject) return;
    setProjectPendingDeleteId(null);
  }, [isDeletingProject]);

  const handleCreateProject = useCallback(async (payload: {
    name: string;
    folderPaths: string[];
    createDefaultFolder?: {
      enabled: boolean;
      folderName?: string;
    };
  }) => {
    setCreateProjectError(null);
    setIsCreatingProject(true);

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const responsePayload = await response.json().catch(() => null) as {
        id?: string;
        error?: string;
      } | null;
      if (!response.ok || !responsePayload?.id) {
        throw new Error(responsePayload?.error || 'Failed to create project.');
      }

      const nextConfig = await updateConfig({
        recentProjects: [
          responsePayload.id,
          ...(config?.recentProjects ?? []).filter((projectEntry) => projectEntry !== responsePayload.id),
        ],
      });
      setConfig(nextConfig);
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      setIsCreateProjectDialogOpen(false);
    } catch (createError) {
      console.error(createError);
      setCreateProjectError(
        createError instanceof Error ? createError.message : 'Failed to create project.',
      );
    } finally {
      setIsCreatingProject(false);
    }
  }, [config?.recentProjects, queryClient]);

  const handleCloneRemoteRepo = useCallback(async () => {
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
      );

      if (!result.success || !result.projectId || !result.projectPath) {
        setCloneRemoteError(result.error || 'Failed to clone project.');
        return;
      }

      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      const opened = await handleSelectProject(result.projectId, {
        navigateToNewInHome: false,
      });
      if (!opened) {
        setCloneRemoteError('Project was cloned, but failed to open it.');
        return;
      }

      dismissCloneRemoteDialog();
    } catch (cloneError) {
      console.error(cloneError);
      setCloneRemoteError('Failed to clone project.');
    } finally {
      setIsCloningRemote(false);
    }
  }, [
    cloneCredentialSelection,
    dismissCloneRemoteDialog,
    handleSelectProject,
    isCloningRemote,
    queryClient,
    remoteRepoUrl,
  ]);

  const handleSetDefaultRoot = useCallback(async (path: string) => {
    const nextConfig = await updateConfig({ defaultRoot: path });
    setConfig(nextConfig);
    setIsSelectingRoot(false);
  }, []);

  const handleRemoveRecent = useCallback((event: ReactMouseEvent, projectReference: string) => {
    event.stopPropagation();
    if (isDeletingProject) return;
    const resolvedProject = resolveProjectEntry(projectReference);
    if (!resolvedProject.project) {
      setError('Project not found.');
      return;
    }
    setProjectPendingDeleteId(resolvedProject.project.id);
  }, [isDeletingProject, resolveProjectEntry]);

  const handleDeleteProjectConfirm = useCallback(async () => {
    if (!projectPendingDeleteId || !config || isDeletingProject) return;

    setError(null);
    setIsDeletingProject(true);
    try {
      const pendingProject = getProjectByReference(projectPendingDeleteId);
      const response = await fetch('/api/projects', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: projectPendingDeleteId }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to delete project.');
      }

      const compatibilityKeys = pendingProject
        ? getClientProjectCompatibilityKeys(pendingProject)
        : [projectPendingDeleteId];
      const nextRecentProjects = config.recentProjects.filter((projectEntry) => !compatibilityKeys.includes(projectEntry));
      const nextConfig = await updateConfig({ recentProjects: nextRecentProjects });
      setConfig(nextConfig);
      const stateKeysToRemove = pendingProject
        ? [pendingProject.id, ...pendingProject.folderPaths]
        : [projectPendingDeleteId];
      setProjectGitReposByPath((previous) => omitRecordKeys(previous, stateKeysToRemove));
      setDiscoveringHomeProjectGitRepos((previous) => omitRecordKeys(previous, stateKeysToRemove));
      setHomeProjectGitSelector((current) => (
        current?.projectKey === projectPendingDeleteId ? null : current
      ));
      setProjectPendingDeleteId(null);
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    } catch (deleteError) {
      console.error(deleteError);
      setError(
        deleteError instanceof Error ? deleteError.message : 'Failed to delete project.',
      );
    } finally {
      setIsDeletingProject(false);
    }
  }, [
    config,
    getProjectByReference,
    isDeletingProject,
    projectPendingDeleteId,
    queryClient,
  ]);

  const discoverHomeProjectRepos = useCallback(async (
    projectReference: string,
    options: { force?: boolean } = {},
  ): Promise<HomeProjectGitRepo[]> => {
    const resolvedProject = resolveProjectEntry(projectReference);
    const projectKey = resolvedProject.key;
    if (!resolvedProject.isOpenable) {
      return [];
    }

    const cached = projectGitReposByPath[projectKey];
    if (cached && !options.force) {
      return cached;
    }

    setDiscoveringHomeProjectGitRepos((previous) => ({ ...previous, [projectKey]: true }));
    try {
      const discovery = await discoverProjectGitRepos(resolvedProject.project?.id ?? resolvedProject.primaryPath!);
      const repos = toHomeProjectGitRepos(discovery.repos);
      setProjectGitReposByPath((previous) => ({ ...previous, [projectKey]: repos }));
      return repos;
    } catch (discoverError) {
      console.error('Failed to discover project git repos:', discoverError);
      setProjectGitReposByPath((previous) => ({ ...previous, [projectKey]: [] }));
      return [];
    } finally {
      setDiscoveringHomeProjectGitRepos((previous) => ({ ...previous, [projectKey]: false }));
    }
  }, [projectGitReposByPath, resolveProjectEntry]);

  const handleOpenProjectGitWorkspace = useCallback(async (
    projectReference: string,
    sourceRepoPath?: string,
  ) => {
    setError(null);

    if (sourceRepoPath?.trim()) {
      router.push(`/git?path=${encodeURIComponent(sourceRepoPath)}`);
      return;
    }

    const resolvedProject = resolveProjectEntry(projectReference);
    const repos = await discoverHomeProjectRepos(projectReference);
    if (repos.length === 0) {
      setError('No Git repositories were found in this project.');
      return;
    }
    if (repos.length === 1) {
      router.push(`/git?path=${encodeURIComponent(repos[0].repoPath)}`);
      return;
    }
    setHomeProjectGitSelector({
      projectKey: resolvedProject.key,
      projectLabel: resolvedProject.displayName,
      repos,
    });
  }, [discoverHomeProjectRepos, resolveProjectEntry, router]);

  const recentProjects = useMemo(() => config?.recentProjects ?? [], [config?.recentProjects]);
  const resolvedRecentProjects = useMemo(() => (
    resolveClientRecentProjects(projects, recentProjects)
  ), [projects, recentProjects]);
  const recentProjectKeyByCompatibilityKey = useMemo(() => (
    createClientProjectCompatibilityMap(resolvedRecentProjects)
  ), [resolvedRecentProjects]);

  useEffect(() => {
    if (!isHomePageForegrounded || resolvedRecentProjects.length === 0) return;

    const runtimeWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const projectsToDiscover = resolvedRecentProjects
      .filter((projectEntry) => projectEntry.isOpenable && !(projectEntry.key in projectGitReposByPath))
      .map((projectEntry) => projectEntry.key);
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
  }, [discoverHomeProjectRepos, isHomePageForegrounded, projectGitReposByPath, resolvedRecentProjects]);

  useDialogKeyboardShortcuts({
    enabled: isRepoSettingsDialogOpen && !!projectForSettingsId,
    onConfirm: handleSaveRepoSettings,
    onDismiss: dismissRepoSettingsDialog,
    canConfirm: !isSavingRepoSettings,
  });

  useDialogKeyboardShortcuts({
    enabled: isCloneRemoteDialogOpen,
    onConfirm: handleCloneRemoteRepo,
    onDismiss: dismissCloneRemoteDialog,
    canConfirm: !isCloningRemote && remoteRepoUrl.trim().length > 0 && !isLoadingCloneCredentialOptions,
  });

  useDialogKeyboardShortcuts({
    enabled: !!projectPendingDeleteId,
    onConfirm: handleDeleteProjectConfirm,
    onDismiss: dismissDeleteProjectDialog,
    canConfirm: !isDeletingProject,
  });

  const sessionCountByProject = useMemo(() => (
    countHomeProjectSessionsByProject(
      allSessions,
      (session) => resolveClientProjectActivityKey(projects, session, recentProjectKeyByCompatibilityKey),
    )
  ), [allSessions, projects, recentProjectKeyByCompatibilityKey]);

  const draftCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const draft of allDrafts) {
      const projectKey = resolveClientProjectActivityKey(projects, draft, recentProjectKeyByCompatibilityKey);
      if (!projectKey) continue;
      counts.set(projectKey, (counts.get(projectKey) ?? 0) + 1);
    }
    return counts;
  }, [allDrafts, projects, recentProjectKeyByCompatibilityKey]);

  const getProjectDisplayName = useCallback((projectReference: string): string => (
    resolveProjectEntry(projectReference).displayName
  ), [resolveProjectEntry]);

  const getProjectSecondaryLabel = useCallback((projectReference: string): string => (
    resolveProjectEntry(projectReference).secondaryLabel
  ), [resolveProjectEntry]);

  const isProjectOpenable = useCallback((projectReference: string): boolean => (
    resolveProjectEntry(projectReference).isOpenable
  ), [resolveProjectEntry]);

  useEffect(() => {
    const unsubscribe = subscribeToQuickCreateJobUpdates((payload) => {
      setQuickCreateActiveCount(payload.activeCount);
      void refreshQuickCreateState();

      if (payload.sourceTabId !== getQuickCreateTabId()) {
        return;
      }

      if (payload.status === 'succeeded' && payload.sessionId && payload.projectPath) {
        const { projectPath, sessionId } = payload;
        const projectLabel = getProjectDisplayName(projectPath);
        toast({
          type: 'success',
          title: 'Quick create finished',
          description: `Created a new task for ${projectLabel}.`,
          action: (
            <button
              type="button"
              className="btn btn-xs btn-outline"
              onClick={() => router.push(`/session/${encodeURIComponent(sessionId)}`)}
            >
              Open Task
            </button>
          ),
        });
        return;
      }

      if (payload.status === 'failed') {
        toast({
          type: 'error',
          title: 'Quick create failed',
          description: payload.error || 'Palx saved the request as a failed quick create draft.',
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [getProjectDisplayName, refreshQuickCreateState, router, toast]);

  const sortedRecentProjects = useMemo(() => (
    sortHomeProjects(
      resolvedRecentProjects.map((projectEntry) => projectEntry.key),
      homeProjectSort,
      getProjectDisplayName,
    )
  ), [getProjectDisplayName, homeProjectSort, resolvedRecentProjects]);

  const filteredRecentProjects = useMemo(() => {
    const normalizedQuery = homeSearchQuery.trim().toLowerCase();
    if (!normalizedQuery) return sortedRecentProjects;

    return sortedRecentProjects.filter((projectReference) => {
      const displayName = getProjectDisplayName(projectReference).toLowerCase();
      const secondaryLabel = getProjectSecondaryLabel(projectReference).toLowerCase();
      return (
        displayName.includes(normalizedQuery)
        || secondaryLabel.includes(normalizedQuery)
      );
    });
  }, [getProjectDisplayName, getProjectSecondaryLabel, homeSearchQuery, sortedRecentProjects]);

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

  const projectCardIconByKey = useMemo(() => {
    const nextIcons: Record<string, string | null> = {};
    resolvedRecentProjects.forEach((projectEntry) => {
      nextIcons[projectEntry.key] = projectEntry.project?.iconPath ?? null;
    });
    return nextIcons;
  }, [resolvedRecentProjects]);

  const currentThemeModeIndex = THEME_MODE_SEQUENCE.indexOf(themeMode);
  const nextThemeMode =
    THEME_MODE_SEQUENCE[(currentThemeModeIndex + 1) % THEME_MODE_SEQUENCE.length];
  const themeModeLabel = themeMode === 'auto' ? 'Auto' : (themeMode === 'light' ? 'Bright' : 'Dark');
  const nextThemeModeLabel =
    nextThemeMode === 'auto' ? 'Auto' : (nextThemeMode === 'light' ? 'Bright' : 'Dark');
  const ThemeModeIcon = themeMode === 'auto' ? Monitor : (themeMode === 'light' ? Sun : Moon);

  const handleRepoCardMouseMove = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const wrapper = event.currentTarget;
    const card = wrapper.firstElementChild;
    if (!(card instanceof HTMLElement)) return;

    const pendingFrame = repoCardTiltFrameByElement.get(wrapper);
    if (pendingFrame) {
      window.cancelAnimationFrame(pendingFrame);
    }

    const { clientX, clientY } = event;
    const cachedRect = repoCardTiltRectByElement.get(wrapper);
    const rect = cachedRect ?? wrapper.getBoundingClientRect();
    repoCardTiltRectByElement.set(wrapper, rect);

    const frameId = window.requestAnimationFrame(() => {
      repoCardTiltFrameByElement.delete(wrapper);

      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      if (centerX <= 0 || centerY <= 0) return;

      const rotateX = ((y - centerY) / centerY) * -12;
      const rotateY = ((x - centerX) / centerX) * 12;
      const bgPosX = 50 + (((x - centerX) / centerX) * 40);
      const bgPosY = 50 + (((y - centerY) / centerY) * 40);

      card.style.setProperty('--tilt-mouse-x', `${x}px`);
      card.style.setProperty('--tilt-mouse-y', `${y}px`);
      card.style.setProperty('--tilt-bg-pos-x', `${bgPosX}%`);
      card.style.setProperty('--tilt-bg-pos-y', `${bgPosY}%`);
      card.style.setProperty('--tilt-rotate-x', `${rotateX.toFixed(2)}deg`);
      card.style.setProperty('--tilt-rotate-y', `${rotateY.toFixed(2)}deg`);
      card.style.setProperty('--tilt-scale', '1.02');
    });

    repoCardTiltFrameByElement.set(wrapper, frameId);
  }, []);

  const handleRepoCardMouseLeave = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const wrapper = event.currentTarget;
    const card = wrapper.firstElementChild;
    if (!(card instanceof HTMLElement)) return;

    const pendingFrame = repoCardTiltFrameByElement.get(wrapper);
    if (pendingFrame) {
      window.cancelAnimationFrame(pendingFrame);
      repoCardTiltFrameByElement.delete(wrapper);
    }
    repoCardTiltRectByElement.delete(wrapper);

    card.style.setProperty('--tilt-rotate-x', '0deg');
    card.style.setProperty('--tilt-rotate-y', '0deg');
    card.style.setProperty('--tilt-scale', '1');
    card.style.setProperty('--tilt-bg-pos-x', '50%');
    card.style.setProperty('--tilt-bg-pos-y', '50%');
  }, []);

  const handleRepoIconError = useCallback((repo: string) => {
    setBrokenRepoCardIcons((previous) => {
      if (previous[repo]) return previous;
      return { ...previous, [repo]: true };
    });
  }, []);

  const handleOpenQuickCreateDialog = useCallback((draft?: QuickCreateDraft | null) => {
    setQuickCreateDraftForEdit(draft ?? null);
    setIsQuickCreateDialogOpen(true);
  }, []);

  const handleCloseQuickCreateDialog = useCallback(() => {
    setIsQuickCreateDialogOpen(false);
    setQuickCreateDraftForEdit(null);
  }, []);

  const handleDeleteQuickCreateDraft = useCallback(async (draftId: string) => {
    const result = await deleteQuickCreateDraft(draftId);
    if (!result.success) {
      toast({
        type: 'error',
        title: 'Failed to delete quick create draft',
        description: result.error || 'Please try again.',
      });
      return;
    }

    await refreshQuickCreateState();
  }, [refreshQuickCreateState, toast]);

  const handleSubmitQuickCreateTask = useCallback(async (input: {
    draftId?: string | null;
    message: string;
    attachmentPaths: string[];
  }) => {
    const result = await startQuickCreateTask({
      draftId: input.draftId,
      message: input.message,
      attachmentPaths: input.attachmentPaths,
      sourceTabId: getQuickCreateTabId(),
    });

    if (result.success) {
      handleCloseQuickCreateDialog();
      return { success: true };
    }

    return {
      success: false,
      error: result.error || 'Failed to start quick create.',
    };
  }, [handleCloseQuickCreateDialog]);

  return (
    <>
      <HomeDashboard
        error={error}
        isLoaded={isLoaded}
        homeSearchQuery={homeSearchQuery}
        homeProjectSort={homeProjectSort}
        showLogout={showLogout}
        logoutEnabled={logoutEnabled}
        quickCreateActiveCount={quickCreateActiveCount}
        failedQuickCreateDrafts={quickCreateDrafts}
        themeModeLabel={themeModeLabel}
        nextThemeModeLabel={nextThemeModeLabel}
        ThemeModeIcon={ThemeModeIcon}
        filteredRecentProjects={filteredRecentProjects}
        isDarkThemeActive={isDarkThemeActive}
        sessionCountByProject={sessionCountByProject}
        draftCountByProject={draftCountByProject}
        projectCardIconByPath={projectCardIconByKey}
        brokenProjectCardIcons={brokenRepoCardIcons}
        projectGitReposByPath={projectGitReposByPath}
        discoveringProjectGitRepos={discoveringHomeProjectGitRepos}
        getProjectDisplayName={getProjectDisplayName}
        getProjectSecondaryLabel={getProjectSecondaryLabel}
        isProjectOpenable={isProjectOpenable}
        onHomeSearchQueryChange={setHomeSearchQuery}
        onHomeProjectSortChange={handleHomeProjectSortChange}
        onOpenCredentials={() => router.push('/settings')}
        onOpenQuickCreate={() => handleOpenQuickCreateDialog()}
        onEditQuickCreateDraft={handleOpenQuickCreateDialog}
        onDeleteQuickCreateDraft={handleDeleteQuickCreateDraft}
        onCycleThemeMode={() => setThemeMode(nextThemeMode)}
        onSelectProject={handleSelectProject}
        onOpenGitWorkspace={handleOpenProjectGitWorkspace}
        onOpenProjectSettings={handleOpenRepoSettings}
        onRemoveRecent={handleRemoveRecent}
        onProjectIconError={handleRepoIconError}
        onRepoCardMouseMove={handleRepoCardMouseMove}
        onRepoCardMouseLeave={handleRepoCardMouseLeave}
        onAddProject={openCreateProjectDialog}
      />

      <RepoSettingsDialog
        key={`${projectForSettingsId ?? 'none'}:${isRepoSettingsDialogOpen ? 'open' : 'closed'}`}
        isOpen={isRepoSettingsDialogOpen}
        projectId={projectForSettingsId}
        projectForSettings={projectFolderPaths[0] ?? null}
        projectName={projectName}
        projectFolderPaths={projectFolderPaths}
        defaultRoot={config?.defaultRoot || undefined}
        projectStartupCommand={repoStartupCommand}
        projectDevServerCommand={repoDevServerCommand}
        defaultProjectStartupCommand={DEFAULT_PROJECT_STARTUP_COMMAND}
        defaultProjectDevServerCommand={DEFAULT_PROJECT_DEV_SERVER_COMMAND}
        projectIconPath={projectIconPathForSettings}
        isSavingProjectSettings={isSavingRepoSettings}
        isUploadingProjectIcon={isUploadingProjectIcon}
        projectSettingsError={repoSettingsError}
        onNameChange={setProjectName}
        onAddFolderPath={(folderPath) => {
          setProjectFolderPaths((previous) => (
            previous.includes(folderPath) ? previous : [...previous, folderPath]
          ));
        }}
        onRemoveFolderPath={(folderPath) => {
          setProjectFolderPaths((previous) => previous.filter((currentPath) => currentPath !== folderPath));
        }}
        onStartupCommandChange={setRepoStartupCommand}
        onDevServerCommandChange={setRepoDevServerCommand}
        onUploadIcon={(iconPath) => {
          void handleUploadProjectIcon(iconPath);
        }}
        onRemoveIcon={() => {
          void handleRemoveProjectIcon();
        }}
        onClose={dismissRepoSettingsDialog}
        onSave={() => {
          void handleSaveRepoSettings();
        }}
      />

      <CreateProjectDialog
        isOpen={isCreateProjectDialogOpen}
        defaultRoot={config?.defaultRoot || undefined}
        isSubmitting={isCreatingProject}
        error={createProjectError}
        onClose={dismissCreateProjectDialog}
        onCreate={handleCreateProject}
        onCloneRemote={() => {
          dismissCreateProjectDialog();
          openCloneRemoteDialog();
        }}
      />

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
        onBrowseLocalFolder={() => {
          dismissCloneRemoteDialog();
          openCreateProjectDialog();
        }}
        onSetDefaultFolder={() => {
          dismissCloneRemoteDialog();
          setIsSelectingRoot(true);
        }}
        onCloneProject={() => {
          void handleCloneRemoteRepo();
        }}
      />

      <QuickCreateTaskDialog
        key={quickCreateDraftForEdit?.id ?? 'new-quick-create'}
        isOpen={isQuickCreateDialogOpen}
        draft={quickCreateDraftForEdit}
        defaultRoot={config?.defaultRoot || undefined}
        onClose={handleCloseQuickCreateDialog}
        onSubmit={handleSubmitQuickCreateTask}
      />

      {homeProjectGitSelector && (
        <div className="fixed inset-0 z-[1003] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#151b26]">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-white/10">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                Select Git Repository
              </h3>
              <button
                className="btn btn-circle btn-ghost btn-sm"
                onClick={() => setHomeProjectGitSelector(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-5">
              <p className="break-all font-mono text-xs text-slate-600 dark:text-slate-300">
                {homeProjectGitSelector.projectLabel}
              </p>
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {homeProjectGitSelector.repos.map((repoEntry) => (
                  <button
                    key={repoEntry.repoPath}
                    type="button"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 dark:border-[#30363d] dark:text-slate-200 dark:hover:bg-[#30363d]/60"
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

      {projectPendingDeleteId && (
        <div className="fixed inset-0 z-[1003] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#151b26]">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-white/10">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                Delete Project
              </h3>
              <button
                className="btn btn-circle btn-ghost btn-sm"
                onClick={dismissDeleteProjectDialog}
                disabled={isDeletingProject}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <p className="text-sm text-slate-700 dark:text-slate-200">
                Delete this project from Palx. Associated folders on disk will not be removed.
              </p>
              <p className="break-all font-mono text-xs text-slate-600 dark:text-slate-300">
                {resolveProjectEntry(projectPendingDeleteId).displayName}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={dismissDeleteProjectDialog}
                  disabled={isDeletingProject}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-error"
                  onClick={() => {
                    void handleDeleteProjectConfirm();
                  }}
                  disabled={isDeletingProject}
                >
                  {isDeletingProject ? 'Deleting...' : 'Delete Project'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isSelectingRoot && (
        <FileBrowser
          title="Default Root Folder"
          initialPath={config?.defaultRoot || undefined}
          onSelect={handleSetDefaultRoot}
          onCancel={() => setIsSelectingRoot(false)}
        />
      )}
    </>
  );
}
