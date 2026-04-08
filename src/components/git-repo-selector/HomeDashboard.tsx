import type { SessionMetadata } from '@/app/actions/session';
import type { QuickCreateDraft } from '@/lib/quick-create';
import type { HomeProjectSort } from '@/lib/home-project-sort';
import type { HomeProjectGitRepo } from '@/lib/home-project-git';
import { getHomeDashboardRenderState } from '@/lib/home-dashboard-state';
import { hasProjectIcon, type ProjectIconValue } from '@/lib/project-icons';
import { APP_PAGE_PANEL_CLASS, APP_PAGE_TOOLBAR_CLASS } from '@/components/app-shell/AppPageSurface';
import { ArrowUpDown, KeyRound, LogOut, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import Image from 'next/image';
import type { ComponentType, MouseEvent } from 'react';
import appIcon from '@/app/icon.png';
import { HomeRepoCard } from './HomeRepoCard';

type HomeProjectServiceStatus = {
  configured: boolean;
  running: boolean;
};

export type HomeDashboardProps = {
  error: string | null;
  isLoaded?: boolean;
  isBootstrapLoaded?: boolean;
  isActivityLoaded?: boolean;
  isRefreshing?: boolean;
  lastUpdatedAt?: string | null;
  homeSearchQuery: string;
  homeProjectSort: HomeProjectSort;
  showLogout: boolean;
  logoutEnabled: boolean;
  quickCreateActiveCount: number;
  failedQuickCreateDrafts: QuickCreateDraft[];
  themeModeLabel: string;
  nextThemeModeLabel: string;
  ThemeModeIcon: ComponentType<{ className?: string }>;
  filteredRecentProjects: string[];
  isDarkThemeActive: boolean;
  runningSessionCountByProject: Map<string, number>;
  runningSessionsByProject: Map<string, SessionMetadata[]>;
  draftCountByProject: Map<string, number>;
  projectCardIconByPath: Record<string, ProjectIconValue>;
  brokenProjectCardIcons: Record<string, boolean>;
  projectGitReposByPath: Record<string, HomeProjectGitRepo[]>;
  discoveringProjectGitRepos: Record<string, boolean>;
  projectServiceStatusByProject: Record<string, HomeProjectServiceStatus | undefined>;
  projectServiceActionStateByProject: Record<string, 'start' | 'stop' | 'restart' | null | undefined>;
  getProjectDisplayName: (project: string) => string;
  getProjectSecondaryLabel: (project: string) => string;
  isProjectOpenable: (project: string) => boolean;
  onHomeSearchQueryChange: (value: string) => void;
  onHomeProjectSortChange: (value: HomeProjectSort) => void;
  onOpenCredentials: () => void;
  onOpenQuickCreate: () => void;
  onEditQuickCreateDraft: (draft: QuickCreateDraft) => void;
  onDeleteQuickCreateDraft: (draftId: string) => void | Promise<void>;
  onCycleThemeMode: () => void;
  onSelectProject: (project: string) => void | Promise<boolean>;
  onOpenSession: (sessionName: string) => void | Promise<void>;
  onOpenGitWorkspace: (project: string, repoPath?: string) => void;
  onProjectServiceAction: (
    event: MouseEvent,
    project: string,
    action: 'start' | 'stop' | 'restart',
  ) => void | Promise<void>;
  onOpenProjectServiceLog: (event: MouseEvent, project: string) => void | Promise<void>;
  onOpenProjectSettings: (event: MouseEvent, project: string) => void | Promise<void>;
  onOpenProjectMemory: (event: MouseEvent, project: string) => void | Promise<void>;
  onRemoveRecent: (event: MouseEvent, project: string) => void;
  onProjectIconError: (project: string) => void;
  onAddProject: () => void;
};

export function HomeDashboard({
  error,
  isLoaded,
  isBootstrapLoaded,
  isActivityLoaded,
  isRefreshing = false,
  lastUpdatedAt = null,
  homeSearchQuery,
  homeProjectSort,
  showLogout,
  logoutEnabled,
  quickCreateActiveCount,
  failedQuickCreateDrafts,
  themeModeLabel,
  nextThemeModeLabel,
  ThemeModeIcon,
  filteredRecentProjects,
  isDarkThemeActive,
  runningSessionCountByProject,
  runningSessionsByProject,
  draftCountByProject,
  projectCardIconByPath,
  brokenProjectCardIcons,
  projectGitReposByPath,
  discoveringProjectGitRepos,
  projectServiceStatusByProject,
  projectServiceActionStateByProject,
  getProjectDisplayName,
  getProjectSecondaryLabel,
  isProjectOpenable,
  onHomeSearchQueryChange,
  onHomeProjectSortChange,
  onOpenCredentials,
  onOpenQuickCreate,
  onEditQuickCreateDraft,
  onDeleteQuickCreateDraft,
  onCycleThemeMode,
  onSelectProject,
  onOpenSession,
  onOpenGitWorkspace,
  onProjectServiceAction,
  onOpenProjectServiceLog,
  onOpenProjectSettings,
  onOpenProjectMemory,
  onRemoveRecent,
  onProjectIconError,
  onAddProject,
}: HomeDashboardProps) {
  const compactGhostButtonClass =
    'btn btn-ghost btn-sm h-8 min-h-8 shrink-0 gap-2 rounded-lg px-2.5 text-[12px] font-medium text-slate-700 shadow-none hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white';
  const compactPanelShadowClass =
    'rounded-[22px] shadow-[0_18px_36px_-24px_rgba(15,23,42,0.38)] backdrop-blur dark:shadow-[0_20px_42px_-26px_rgba(2,6,23,0.82)]';
  const effectiveBootstrapLoaded = isBootstrapLoaded ?? isLoaded ?? false;
  const effectiveActivityLoaded = isActivityLoaded ?? effectiveBootstrapLoaded;
  const renderState = getHomeDashboardRenderState({
    isBootstrapLoaded: effectiveBootstrapLoaded,
    isActivityLoaded: effectiveActivityLoaded,
    filteredRecentProjects,
    homeSearchQuery,
  });

  return (
    <div className="w-full max-w-[1380px]">
      <header className={`relative z-10 flex flex-col gap-3 px-4 py-3 transition-colors lg:flex-row lg:items-center lg:justify-between ${APP_PAGE_TOOLBAR_CLASS}`}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-white/80 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
            <Image src={appIcon} alt="Den" width={20} height={20} className="h-5 w-5 shrink-0 rounded-sm" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate whitespace-nowrap text-base font-semibold tracking-tight text-slate-900 dark:text-white">Den</h2>
            <p className="truncate whitespace-nowrap text-[11px] text-slate-500 dark:text-slate-400">Local control center for AI coding work</p>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:flex-nowrap">
          {isRefreshing ? (
            <span
              className="shrink-0 text-[11px] font-medium text-slate-500 dark:text-slate-400"
              title={lastUpdatedAt ? `Last updated ${new Date(lastUpdatedAt).toLocaleString()}` : 'Refreshing cached home data'}
            >
              Syncing cached data...
            </span>
          ) : null}
          <label className="flex h-8 w-full items-center gap-2 rounded-lg border border-slate-200/90 bg-white/85 px-2.5 text-slate-700 shadow-none transition-colors lg:w-72 dark:border-slate-700 dark:bg-slate-900/85 dark:text-slate-200">
            <Search className="h-4 w-4 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              className="grow bg-transparent text-[12px] placeholder:text-slate-400 focus:outline-none dark:placeholder:text-slate-500"
              placeholder="Search projects..."
              value={homeSearchQuery}
              onChange={(event) => onHomeSearchQueryChange(event.target.value)}
            />
          </label>
          <label className="flex h-8 shrink-0 items-center gap-2 rounded-lg border border-slate-200/90 bg-white/85 px-2.5 text-[12px] text-slate-700 transition-colors dark:border-slate-700 dark:bg-slate-900/85 dark:text-slate-200">
            <ArrowUpDown className="h-4 w-4 text-slate-400 dark:text-slate-500" />
            <span className="sr-only">Sort projects</span>
            <select
              className="min-w-0 bg-transparent text-[12px] outline-none"
              value={homeProjectSort}
              onChange={(event) => onHomeProjectSortChange(event.target.value as HomeProjectSort)}
              aria-label="Sort projects"
            >
              <option value="last-update">Last update</option>
              <option value="name">Name</option>
            </select>
          </label>
          <div className="relative shrink-0">
            <button
              className="btn btn-primary btn-sm h-8 min-h-8 gap-2 rounded-lg px-3 text-[12px]"
              onClick={onOpenQuickCreate}
              title="Create task"
              aria-label="Create task"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden whitespace-nowrap sm:inline">Create Task</span>
            </button>
            {quickCreateActiveCount > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 badge badge-primary badge-sm min-w-5 px-1">
                {quickCreateActiveCount > 99 ? '99+' : quickCreateActiveCount}
              </span>
            ) : null}
          </div>
          <button
            className={compactGhostButtonClass}
            onClick={onOpenCredentials}
            title="Open settings"
            aria-label="Open settings"
          >
            <KeyRound className="h-4 w-4" />
            <span className="hidden max-w-24 truncate whitespace-nowrap lg:inline">Settings</span>
          </button>
          {showLogout && logoutEnabled ? (
            <a
              href="/auth/logout"
              className={compactGhostButtonClass}
              title="Log out"
              aria-label="Log out"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden max-w-20 truncate whitespace-nowrap lg:inline">Logout</span>
            </a>
          ) : null}
          <button
            className="btn btn-ghost btn-sm btn-square h-8 min-h-8 w-8 rounded-lg text-slate-700 hover:bg-slate-100 dark:border dark:border-slate-700 dark:bg-slate-900/85 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            onClick={onCycleThemeMode}
            title={`Theme mode: ${themeModeLabel}. Click to switch to ${nextThemeModeLabel}.`}
            aria-label={`Theme mode: ${themeModeLabel}. Click to switch to ${nextThemeModeLabel}.`}
          >
            <ThemeModeIcon className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="relative z-10 px-1 py-5 md:py-7">
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-500/50 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        )}

        {failedQuickCreateDrafts.length > 0 ? (
          <div className="mb-5 rounded-[22px] border border-amber-200/80 bg-amber-50/88 p-4 shadow-[0_18px_36px_-24px_rgba(15,23,42,0.28)] backdrop-blur dark:border-amber-400/20 dark:bg-amber-950/24 dark:shadow-[0_20px_42px_-26px_rgba(2,6,23,0.75)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                  Failed Quick Creates
                </h3>
                <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-200/80">
                  Review and retry tasks that could not be assigned to a project automatically.
                </p>
              </div>
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-400/10 dark:text-amber-100">
                {failedQuickCreateDrafts.length}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
              {failedQuickCreateDrafts.map((draft) => (
                <div
                  key={draft.id}
                  className="rounded-xl border border-amber-200/70 bg-white/90 p-4 dark:border-amber-400/20 dark:bg-slate-900/58"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                        {draft.title}
                      </h4>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-600 dark:text-slate-300">
                        {draft.message}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        className="app-ui-icon-button app-ui-icon-button-sm"
                        onClick={() => onEditQuickCreateDraft(draft)}
                        title="Edit failed quick create"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="app-ui-icon-button app-ui-icon-button-danger app-ui-icon-button-sm"
                        onClick={() => {
                          void onDeleteQuickCreateDraft(draft.id);
                        }}
                        title="Delete failed quick create"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 rounded-lg border border-red-200/70 bg-red-50/80 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-200">
                    {draft.lastError}
                  </div>

                  <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                    {draft.attachmentPaths.length} attachment{draft.attachmentPaths.length === 1 ? '' : 's'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {renderState.kind === 'loading' ? (
          <div className="flex h-24 items-center justify-center">
            <span className="loading loading-spinner loading-md text-primary"></span>
          </div>
        ) : renderState.kind === 'empty' ? (
          <div className={`flex h-52 flex-col items-center justify-center text-center ${APP_PAGE_PANEL_CLASS}`}>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {renderState.emptyMessage}
            </p>
            {!homeSearchQuery.trim() && (
              <button className="btn btn-primary btn-sm mt-3 h-8 min-h-8 gap-2 rounded-lg px-3 text-[12px]" onClick={onAddProject}>
                <Plus className="h-4 w-4" />
                Add your first project
              </button>
            )}
          </div>
        ) : (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 20.25rem), 1fr))' }}
          >
            {filteredRecentProjects.map((project) => (
              <HomeRepoCard
                key={project}
                project={project}
                projectDisplayName={getProjectDisplayName(project)}
                projectSecondaryLabel={getProjectSecondaryLabel(project)}
                isProjectOpenable={isProjectOpenable(project)}
                areActionButtonsReady={effectiveActivityLoaded}
                isDarkThemeActive={isDarkThemeActive}
                runningSessionCount={runningSessionCountByProject.get(project) ?? 0}
                runningSessions={runningSessionsByProject.get(project) ?? []}
                draftCount={draftCountByProject.get(project) ?? 0}
                projectIcon={projectCardIconByPath[project] ?? null}
                showProjectIcon={hasProjectIcon(projectCardIconByPath[project]) && !brokenProjectCardIcons[project]}
                projectGitRepos={projectGitReposByPath[project]}
                isDiscoveringProjectGitRepos={!!discoveringProjectGitRepos[project]}
                isProjectServiceConfigured={!!projectServiceStatusByProject[project]?.configured}
                isProjectServiceRunning={!!projectServiceStatusByProject[project]?.running}
                projectServiceActionState={projectServiceActionStateByProject[project] ?? null}
                onSelectProject={onSelectProject}
                onOpenSession={onOpenSession}
                onOpenGitWorkspace={onOpenGitWorkspace}
                onProjectServiceAction={onProjectServiceAction}
                onOpenProjectServiceLog={onOpenProjectServiceLog}
                onOpenProjectSettings={onOpenProjectSettings}
                onOpenProjectMemory={onOpenProjectMemory}
                onRemoveRecent={onRemoveRecent}
                onProjectIconError={onProjectIconError}
              />
            ))}

            <button
              onClick={onAddProject}
              className={`group flex min-h-[194px] w-full flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-200/90 bg-white/72 text-slate-600 transition-all duration-200 hover:-translate-y-1 hover:border-primary/45 hover:bg-white dark:border-slate-700 dark:bg-slate-950/72 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-950 ${compactPanelShadowClass}`}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200/80 bg-white/90 shadow-sm transition-transform group-hover:scale-105 dark:border-slate-700 dark:bg-slate-900/90">
                <Plus className="h-7 w-7 text-slate-400 transition-colors group-hover:text-primary" />
              </span>
              <span className="text-base font-semibold transition-colors group-hover:text-primary">
                Add Project
              </span>
              <span className="text-xs text-slate-400 dark:text-slate-500">Import from local folder or git URL</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
