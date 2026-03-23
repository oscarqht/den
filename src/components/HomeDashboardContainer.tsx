'use client';

import dynamic from 'next/dynamic';
import { Monitor, Moon, Sun, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { getConfig, updateConfig, updateProjectSettings, type Config } from '@/app/actions/config';
import { listCredentials } from '@/app/actions/credentials';
import { listDrafts, type DraftMetadata } from '@/app/actions/draft';
import { resolveRepoCardIcon } from '@/app/actions/git';
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
import type { Credential } from '@/lib/credentials';
import { getBaseName } from '@/lib/path';
import type { QuickCreateDraft } from '@/lib/quick-create';
import { getQuickCreateTabId, subscribeToQuickCreateJobUpdates } from '@/lib/quick-create-updates';
import { subscribeToSessionsUpdated } from '@/lib/session-updates';
import {
  resolveShouldUseDarkTheme,
  THEME_MODE_STORAGE_KEY,
  THEME_REFRESH_EVENT,
} from '@/lib/ttyd-theme';
import { HomeDashboard } from './git-repo-selector/HomeDashboard';
import type { RepoCredentialSelection } from './git-repo-selector/types';

const FileBrowser = dynamic(() => import('./FileBrowser'));
const RepoSettingsDialog = dynamic(() =>
  import('./git-repo-selector/RepoSettingsDialog').then((module) => module.RepoSettingsDialog),
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

  const [isBrowsing, setIsBrowsing] = useState(false);
  const [isSelectingRoot, setIsSelectingRoot] = useState(false);
  const [isRepoSettingsDialogOpen, setIsRepoSettingsDialogOpen] = useState(false);
  const [repoForSettings, setRepoForSettings] = useState<string | null>(null);
  const [repoAlias, setRepoAlias] = useState('');
  const [repoStartupCommand, setRepoStartupCommand] = useState(DEFAULT_PROJECT_STARTUP_COMMAND);
  const [repoDevServerCommand, setRepoDevServerCommand] = useState(DEFAULT_PROJECT_DEV_SERVER_COMMAND);
  const [projectIconPathForSettings, setProjectIconPathForSettings] = useState<string | null>(null);
  const [repoSettingsError, setRepoSettingsError] = useState<string | null>(null);
  const [isUploadingProjectIcon, setIsUploadingProjectIcon] = useState(false);
  const [isSavingRepoSettings, setIsSavingRepoSettings] = useState(false);

  const [isCloneRemoteDialogOpen, setIsCloneRemoteDialogOpen] = useState(false);
  const [remoteRepoUrl, setRemoteRepoUrl] = useState('');
  const [cloneCredentialSelection, setCloneCredentialSelection] =
    useState<RepoCredentialSelection>('auto');
  const [credentialOptions, setCredentialOptions] = useState<Credential[]>([]);
  const [cloneRemoteError, setCloneRemoteError] = useState<string | null>(null);
  const [isCloningRemote, setIsCloningRemote] = useState(false);
  const [isLoadingCloneCredentialOptions, setIsLoadingCloneCredentialOptions] = useState(false);

  const [repoCardIconByRepo, setRepoCardIconByRepo] = useState<Record<string, string | null>>({});
  const [brokenRepoCardIcons, setBrokenRepoCardIcons] = useState<Record<string, boolean>>({});
  const [projectGitReposByPath, setProjectGitReposByPath] = useState<Record<string, string[]>>({});
  const [discoveringHomeProjectGitRepos, setDiscoveringHomeProjectGitRepos] = useState<Record<string, boolean>>({});
  const [homeProjectGitSelector, setHomeProjectGitSelector] = useState<{
    projectPath: string;
    repos: string[];
  } | null>(null);
  const [projectPendingDelete, setProjectPendingDelete] = useState<string | null>(null);
  const [deleteProjectLocalFolder, setDeleteProjectLocalFolder] = useState(false);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [isQuickCreateDialogOpen, setIsQuickCreateDialogOpen] = useState(false);
  const [quickCreateDraftForEdit, setQuickCreateDraftForEdit] = useState<QuickCreateDraft | null>(null);

  const repoCardIconResolutionsInFlightRef = useRef<Set<string>>(new Set());

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

  const ensureProjectRegistered = useCallback(async (projectPath: string) => {
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath, name: getBaseName(projectPath) }),
      });

      if (response.ok) return;

      const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
      const errorMessage = typeof payload?.error === 'string' ? payload.error : '';
      if (/already exists/i.test(errorMessage)) return;
      if (response.status === 500 && !errorMessage) return;

      console.warn('Failed to ensure project registration:', errorMessage || response.statusText);
    } catch (registrationError) {
      console.warn('Failed to ensure project registration:', registrationError);
    }
  }, []);

  const handleSelectProject = useCallback(async (
    path: string,
    options?: { navigateToNewInHome?: boolean },
  ) => {
    setError(null);

    try {
      await ensureProjectRegistered(path);

      const currentConfig = config ?? await getConfig();
      if (!config) {
        setConfig(currentConfig);
      }

      let nextRecentProjects = [...currentConfig.recentProjects];
      if (!nextRecentProjects.includes(path)) {
        nextRecentProjects.unshift(path);
      } else {
        nextRecentProjects = [path, ...nextRecentProjects.filter((project) => project !== path)];
      }

      const nextConfig = arePathListsEqual(nextRecentProjects, currentConfig.recentProjects)
        ? currentConfig
        : await updateConfig({ recentProjects: nextRecentProjects });

      setConfig(nextConfig);
      setIsBrowsing(false);

      if (options?.navigateToNewInHome !== false) {
        router.push(`/new?project=${encodeURIComponent(path)}`);
      }

      return true;
    } catch (selectError) {
      console.error(selectError);
      setError('Failed to open project.');
      return false;
    }
  }, [config, ensureProjectRegistered, router]);

  const dismissRepoSettingsDialog = useCallback(() => {
    if (isSavingRepoSettings) return;
    setIsRepoSettingsDialogOpen(false);
    setRepoForSettings(null);
    setRepoAlias('');
    setRepoStartupCommand(DEFAULT_PROJECT_STARTUP_COMMAND);
    setRepoDevServerCommand(DEFAULT_PROJECT_DEV_SERVER_COMMAND);
    setProjectIconPathForSettings(null);
    setRepoSettingsError(null);
    setIsUploadingProjectIcon(false);
  }, [isSavingRepoSettings]);

  const handleOpenRepoSettings = useCallback(async (
    event: ReactMouseEvent,
    repo: string,
  ) => {
    event.stopPropagation();
    await ensureProjectRegistered(repo);

    const settings = config?.projectSettings?.[repo];
    setRepoForSettings(repo);
    setRepoAlias(settings?.alias?.trim() || '');
    setRepoStartupCommand(settings?.startupScript ?? DEFAULT_PROJECT_STARTUP_COMMAND);
    setRepoDevServerCommand(settings?.devServerScript ?? DEFAULT_PROJECT_DEV_SERVER_COMMAND);
    setProjectIconPathForSettings(repoCardIconByRepo[repo] ?? null);
    setRepoSettingsError(null);
    setIsRepoSettingsDialogOpen(true);
  }, [config?.projectSettings, ensureProjectRegistered, repoCardIconByRepo]);

  const handleSaveRepoSettings = useCallback(async () => {
    if (!repoForSettings) return;

    const startupCommandToSave = repoStartupCommand.trim() || DEFAULT_PROJECT_STARTUP_COMMAND;
    const devServerCommandToSave =
      repoDevServerCommand.trim() || DEFAULT_PROJECT_DEV_SERVER_COMMAND;

    setIsSavingRepoSettings(true);
    setRepoSettingsError(null);
    try {
      const aliasToSave = repoAlias.trim() || null;
      const nextConfig = await updateProjectSettings(repoForSettings, {
        startupScript: startupCommandToSave,
        devServerScript: devServerCommandToSave,
        alias: aliasToSave,
      });
      setConfig(nextConfig);

      try {
        await fetch('/api/projects', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: repoForSettings, updates: { displayName: aliasToSave } }),
        });
      } catch {
        // Non-critical if the project registry is temporarily unavailable.
      }

      dismissRepoSettingsDialog();
    } catch (saveError) {
      console.error(saveError);
      setRepoSettingsError('Failed to save project settings.');
    } finally {
      setIsSavingRepoSettings(false);
    }
  }, [
    dismissRepoSettingsDialog,
    repoAlias,
    repoDevServerCommand,
    repoForSettings,
    repoStartupCommand,
  ]);

  const handleUploadProjectIcon = useCallback(async (iconPath: string) => {
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

      const uploadedIconPath = typeof payload?.iconPath === 'string' ? payload.iconPath : null;
      setProjectIconPathForSettings(uploadedIconPath);
      setRepoCardIconByRepo((previous) => ({ ...previous, [repoForSettings]: uploadedIconPath }));
      setBrokenRepoCardIcons((previous) => ({ ...previous, [repoForSettings]: false }));
    } catch (uploadError) {
      console.error(uploadError);
      setRepoSettingsError(
        uploadError instanceof Error ? uploadError.message : 'Failed to upload project icon.',
      );
    } finally {
      setIsUploadingProjectIcon(false);
    }
  }, [isUploadingProjectIcon, repoForSettings]);

  const handleRemoveProjectIcon = useCallback(async () => {
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

      setProjectIconPathForSettings(null);
      setRepoCardIconByRepo((previous) => ({ ...previous, [repoForSettings]: null }));
      setBrokenRepoCardIcons((previous) => ({ ...previous, [repoForSettings]: false }));
    } catch (removeError) {
      console.error(removeError);
      setRepoSettingsError(
        removeError instanceof Error ? removeError.message : 'Failed to remove project icon.',
      );
    } finally {
      setIsUploadingProjectIcon(false);
    }
  }, [isUploadingProjectIcon, repoForSettings]);

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
    setProjectPendingDelete(null);
    setDeleteProjectLocalFolder(false);
  }, [isDeletingProject]);

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

      if (!result.success || !result.projectPath) {
        setCloneRemoteError(result.error || 'Failed to clone project.');
        return;
      }

      const opened = await handleSelectProject(result.projectPath, {
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
    remoteRepoUrl,
  ]);

  const handleSetDefaultRoot = useCallback(async (path: string) => {
    const nextConfig = await updateConfig({ defaultRoot: path });
    setConfig(nextConfig);
    setIsSelectingRoot(false);
  }, []);

  const handleRemoveRecent = useCallback((event: ReactMouseEvent, repo: string) => {
    event.stopPropagation();
    if (isDeletingProject) return;
    setProjectPendingDelete(repo);
    setDeleteProjectLocalFolder(false);
  }, [isDeletingProject]);

  const handleDeleteProjectConfirm = useCallback(async () => {
    if (!projectPendingDelete || !config || isDeletingProject) return;

    setError(null);
    setIsDeletingProject(true);
    try {
      const response = await fetch('/api/projects', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: projectPendingDelete,
          deleteLocalFolder: deleteProjectLocalFolder,
        }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to delete project.');
      }

      const nextRecentProjects = config.recentProjects.filter((project) => project !== projectPendingDelete);
      const nextConfig = await updateConfig({ recentProjects: nextRecentProjects });
      setConfig(nextConfig);
      setProjectGitReposByPath((previous) => {
        const next = { ...previous };
        delete next[projectPendingDelete];
        return next;
      });
      setDiscoveringHomeProjectGitRepos((previous) => {
        const next = { ...previous };
        delete next[projectPendingDelete];
        return next;
      });
      setRepoCardIconByRepo((previous) => {
        const next = { ...previous };
        delete next[projectPendingDelete];
        return next;
      });
      setBrokenRepoCardIcons((previous) => {
        const next = { ...previous };
        delete next[projectPendingDelete];
        return next;
      });
      setHomeProjectGitSelector((current) => (
        current?.projectPath === projectPendingDelete ? null : current
      ));
      setProjectPendingDelete(null);
      setDeleteProjectLocalFolder(false);
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
    deleteProjectLocalFolder,
    isDeletingProject,
    projectPendingDelete,
  ]);

  const discoverHomeProjectRepos = useCallback(async (
    projectPath: string,
    options: { force?: boolean } = {},
  ): Promise<string[]> => {
    const cached = projectGitReposByPath[projectPath];
    if (cached && !options.force) {
      return cached;
    }

    setDiscoveringHomeProjectGitRepos((previous) => ({ ...previous, [projectPath]: true }));
    try {
      const discovery = await discoverProjectGitRepos(projectPath);
      const repos = discovery.repos.map((entry) => entry.repoPath);
      setProjectGitReposByPath((previous) => ({ ...previous, [projectPath]: repos }));
      return repos;
    } catch (discoverError) {
      console.error('Failed to discover project git repos:', discoverError);
      setProjectGitReposByPath((previous) => ({ ...previous, [projectPath]: [] }));
      return [];
    } finally {
      setDiscoveringHomeProjectGitRepos((previous) => ({ ...previous, [projectPath]: false }));
    }
  }, [projectGitReposByPath]);

  const handleOpenProjectGitWorkspace = useCallback(async (
    projectPath: string,
    sourceRepoPath?: string,
  ) => {
    setError(null);

    if (sourceRepoPath?.trim()) {
      router.push(`/git?path=${encodeURIComponent(sourceRepoPath)}`);
      return;
    }

    const repos = await discoverHomeProjectRepos(projectPath);
    if (repos.length === 0) {
      setError('No Git repositories were found in this project.');
      return;
    }
    if (repos.length === 1) {
      router.push(`/git?path=${encodeURIComponent(repos[0])}`);
      return;
    }
    setHomeProjectGitSelector({ projectPath, repos });
  }, [discoverHomeProjectRepos, router]);

  useEffect(() => {
    const recentProjects = config?.recentProjects ?? [];
    if (!isHomePageForegrounded || recentProjects.length === 0) return;

    const runtimeWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const projectsToDiscover = recentProjects.filter(
      (projectPath) => !(projectPath in projectGitReposByPath),
    );
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
  }, [config?.recentProjects, discoverHomeProjectRepos, isHomePageForegrounded, projectGitReposByPath]);

  useEffect(() => {
    const recentProjects = config?.recentProjects ?? [];
    const inFlightResolutions = repoCardIconResolutionsInFlightRef.current;
    const reposToResolve = recentProjects.filter((repo) => (
      !(repo in repoCardIconByRepo) && !inFlightResolutions.has(repo)
    ));

    if (reposToResolve.length === 0) return;

    let cancelled = false;
    reposToResolve.forEach((repo) => {
      inFlightResolutions.add(repo);
    });

    void (async () => {
      const resolutionEntries = await Promise.all(reposToResolve.map(async (repo) => {
        try {
          const result = await resolveRepoCardIcon(repo);
          return [repo, result.success ? result.iconPath : null] as const;
        } catch (resolveError) {
          console.error('Failed to resolve project icon:', resolveError);
          return [repo, null] as const;
        }
      }));

      if (!cancelled) {
        setRepoCardIconByRepo((previous) => {
          const next = { ...previous };
          for (const [repo, iconPath] of resolutionEntries) {
            next[repo] = iconPath;
          }
          return next;
        });
      }

      reposToResolve.forEach((repo) => {
        inFlightResolutions.delete(repo);
      });
    })();

    return () => {
      cancelled = true;
      reposToResolve.forEach((repo) => {
        inFlightResolutions.delete(repo);
      });
    };
  }, [config?.recentProjects, repoCardIconByRepo]);

  useDialogKeyboardShortcuts({
    enabled: isRepoSettingsDialogOpen && !!repoForSettings,
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
    enabled: !!projectPendingDelete,
    onConfirm: handleDeleteProjectConfirm,
    onDismiss: dismissDeleteProjectDialog,
    canConfirm: !isDeletingProject,
  });

  const runningSessionCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const session of allSessions) {
      const projectKey = session.projectPath || session.repoPath;
      if (!projectKey) continue;
      counts.set(projectKey, (counts.get(projectKey) ?? 0) + 1);
    }
    return counts;
  }, [allSessions]);

  const draftCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const draft of allDrafts) {
      const projectKey = draft.projectPath || draft.repoPath;
      if (!projectKey) continue;
      counts.set(projectKey, (counts.get(projectKey) ?? 0) + 1);
    }
    return counts;
  }, [allDrafts]);

  const recentProjects = useMemo(() => config?.recentProjects ?? [], [config?.recentProjects]);

  const getProjectDisplayName = useCallback((projectPath: string): string => {
    const alias = config?.projectSettings?.[projectPath]?.alias?.trim();
    return alias || getBaseName(projectPath);
  }, [config?.projectSettings]);

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
    sortHomeProjects(recentProjects, homeProjectSort, getProjectDisplayName)
  ), [getProjectDisplayName, homeProjectSort, recentProjects]);

  const filteredRecentProjects = useMemo(() => {
    const normalizedQuery = homeSearchQuery.trim().toLowerCase();
    if (!normalizedQuery) return sortedRecentProjects;

    return sortedRecentProjects.filter((projectPath) => {
      const displayName = getProjectDisplayName(projectPath).toLowerCase();
      return (
        displayName.includes(normalizedQuery)
        || projectPath.toLowerCase().includes(normalizedQuery)
      );
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
        runningSessionCountByProject={runningSessionCountByProject}
        draftCountByProject={draftCountByProject}
        projectCardIconByPath={repoCardIconByRepo}
        brokenProjectCardIcons={brokenRepoCardIcons}
        projectGitReposByPath={projectGitReposByPath}
        discoveringProjectGitRepos={discoveringHomeProjectGitRepos}
        getProjectDisplayName={getProjectDisplayName}
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
        onAddProject={openCloneRemoteDialog}
      />

      <RepoSettingsDialog
        key={`${repoForSettings ?? 'none'}:${isRepoSettingsDialogOpen ? 'open' : 'closed'}`}
        isOpen={isRepoSettingsDialogOpen}
        projectForSettings={repoForSettings}
        projectAlias={repoAlias}
        projectStartupCommand={repoStartupCommand}
        projectDevServerCommand={repoDevServerCommand}
        defaultProjectStartupCommand={DEFAULT_PROJECT_STARTUP_COMMAND}
        defaultProjectDevServerCommand={DEFAULT_PROJECT_DEV_SERVER_COMMAND}
        projectIconPath={projectIconPathForSettings}
        isSavingProjectSettings={isSavingRepoSettings}
        isUploadingProjectIcon={isUploadingProjectIcon}
        projectSettingsError={repoSettingsError}
        onAliasChange={setRepoAlias}
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
          setIsBrowsing(true);
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
                {homeProjectGitSelector.projectPath}
              </p>
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {homeProjectGitSelector.repos.map((repoPath) => (
                  <button
                    key={repoPath}
                    type="button"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 dark:border-[#30363d] dark:text-slate-200 dark:hover:bg-[#30363d]/60"
                    onClick={() => {
                      setHomeProjectGitSelector(null);
                      router.push(`/git?path=${encodeURIComponent(repoPath)}`);
                    }}
                    title={repoPath}
                  >
                    <span className="block truncate font-mono text-xs">{repoPath}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {projectPendingDelete && (
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
                Remove this project from the home page.
              </p>
              <p className="break-all font-mono text-xs text-slate-600 dark:text-slate-300">
                {projectPendingDelete}
              </p>
              <label className="flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm text-slate-700 dark:border-white/10 dark:text-slate-200">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500 dark:border-slate-600 dark:bg-slate-900"
                  checked={deleteProjectLocalFolder}
                  onChange={(event) => setDeleteProjectLocalFolder(event.target.checked)}
                  disabled={isDeletingProject}
                />
                <span>
                  Delete local folder too
                </span>
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Leave this unchecked to remove the project from Palx only and keep the local files on disk.
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

      {isBrowsing && (
        <FileBrowser
          initialPath={config?.defaultRoot || undefined}
          onSelect={(path) => handleSelectProject(path, { navigateToNewInHome: false })}
          onCancel={() => setIsBrowsing(false)}
        />
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
