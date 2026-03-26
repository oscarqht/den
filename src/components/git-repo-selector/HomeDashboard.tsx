import type { QuickCreateDraft } from '@/lib/quick-create';
import type { HomeProjectSort } from '@/lib/home-project-sort';
import type { HomeProjectGitRepo } from '@/lib/home-project-git';
import { ArrowUpDown, KeyRound, LogOut, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import Image from 'next/image';
import type { ComponentType, MouseEvent } from 'react';
import { HomeRepoCard } from './HomeRepoCard';

export type HomeDashboardProps = {
  error: string | null;
  isLoaded: boolean;
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
  draftCountByProject: Map<string, number>;
  projectCardIconByPath: Record<string, string | null>;
  brokenProjectCardIcons: Record<string, boolean>;
  projectGitReposByPath: Record<string, HomeProjectGitRepo[]>;
  discoveringProjectGitRepos: Record<string, boolean>;
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
  onOpenGitWorkspace: (project: string, repoPath?: string) => void;
  onOpenProjectSettings: (event: MouseEvent, project: string) => void | Promise<void>;
  onRemoveRecent: (event: MouseEvent, project: string) => void;
  onProjectIconError: (project: string) => void;
  onRepoCardMouseMove: (event: MouseEvent<HTMLDivElement>) => void;
  onRepoCardMouseLeave: (event: MouseEvent<HTMLDivElement>) => void;
  onAddProject: () => void;
};

export function HomeDashboard({
  error,
  isLoaded,
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
  draftCountByProject,
  projectCardIconByPath,
  brokenProjectCardIcons,
  projectGitReposByPath,
  discoveringProjectGitRepos,
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
  onOpenGitWorkspace,
  onOpenProjectSettings,
  onRemoveRecent,
  onProjectIconError,
  onRepoCardMouseMove,
  onRepoCardMouseLeave,
  onAddProject,
}: HomeDashboardProps) {
  return (
    <div className="w-full max-w-7xl">
      <header className="relative z-10 flex flex-col gap-4 rounded-xl border border-white/50 bg-white/40 px-4 py-4 shadow-[0_8px_32px_-8px_rgba(15,23,42,0.15)] backdrop-blur-xl backdrop-saturate-150 transition-colors lg:flex-row lg:items-center lg:justify-between lg:px-7 dark:border-white/10 dark:bg-slate-900/30 dark:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5)]">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 aspect-square items-center justify-center rounded-xl bg-white/60 shadow-sm backdrop-blur-sm dark:border dark:border-white/10 dark:bg-white/10">
            <Image src="/palx-icon.png" alt="Palx" width={22} height={22} className="h-[22px] w-[22px] shrink-0 rounded-sm" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate whitespace-nowrap text-xl font-semibold tracking-tight text-slate-900 dark:text-white">Palx</h2>
            <p className="truncate whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">AI Coding Agent Dashboard</p>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:flex-nowrap">
          <label className="input input-sm flex w-full items-center gap-2 border-white/40 bg-white/50 text-slate-700 shadow-none backdrop-blur-sm transition-colors lg:w-72 dark:border-white/10 dark:bg-white/10 dark:text-slate-200">
            <Search className="h-4 w-4 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              className="grow text-sm placeholder:text-slate-400 dark:placeholder:text-slate-500"
              placeholder="Search projects..."
              value={homeSearchQuery}
              onChange={(event) => onHomeSearchQueryChange(event.target.value)}
            />
          </label>
          <label className="flex h-8 shrink-0 items-center gap-2 rounded-lg border border-white/40 bg-white/50 px-2.5 text-sm text-slate-700 backdrop-blur-sm transition-colors dark:border-white/10 dark:bg-white/10 dark:text-slate-200">
            <ArrowUpDown className="h-4 w-4 text-slate-400 dark:text-slate-500" />
            <span className="sr-only">Sort projects</span>
            <select
              className="min-w-0 bg-transparent text-sm outline-none"
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
              className="btn btn-primary btn-sm gap-2"
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
            className="btn btn-ghost btn-sm shrink-0 gap-2 px-2 lg:px-3 text-slate-700 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
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
              className="btn btn-ghost btn-sm shrink-0 gap-2 px-2 lg:px-3 text-slate-700 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
              title="Log out"
              aria-label="Log out"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden max-w-20 truncate whitespace-nowrap lg:inline">Logout</span>
            </a>
          ) : null}
          <button
            className="btn btn-ghost btn-sm btn-square text-slate-700 dark:border dark:border-white/10 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/20 dark:hover:text-white"
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
          <div className="mb-5 rounded-2xl border border-amber-200/70 bg-amber-50/80 p-4 shadow-sm backdrop-blur-sm dark:border-amber-400/20 dark:bg-amber-950/20">
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
                  className="rounded-xl border border-amber-200/70 bg-white/80 p-4 dark:border-amber-400/20 dark:bg-slate-900/50"
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
                        className="btn btn-ghost btn-xs"
                        onClick={() => onEditQuickCreateDraft(draft)}
                        title="Edit failed quick create"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-300 dark:hover:bg-red-500/10 dark:hover:text-red-200"
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

        {!isLoaded ? (
          <div className="flex h-56 items-center justify-center rounded-2xl border border-white/40 bg-white/25 backdrop-blur-lg dark:border-white/10 dark:bg-white/5">
            <span className="loading loading-spinner loading-md text-primary"></span>
          </div>
        ) : filteredRecentProjects.length === 0 ? (
          <div className="flex h-56 flex-col items-center justify-center rounded-2xl border border-white/40 bg-white/25 text-center backdrop-blur-lg dark:border-white/10 dark:bg-white/5">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {homeSearchQuery.trim() ? 'No projects match your search.' : 'No recent projects found.'}
            </p>
            {!homeSearchQuery.trim() && (
              <button className="btn btn-primary btn-sm mt-3 gap-2" onClick={onAddProject}>
                <Plus className="h-4 w-4" />
                Add your first project
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {filteredRecentProjects.map((project) => (
              <HomeRepoCard
                key={project}
                project={project}
                projectDisplayName={getProjectDisplayName(project)}
                projectSecondaryLabel={getProjectSecondaryLabel(project)}
                isProjectOpenable={isProjectOpenable(project)}
                isDarkThemeActive={isDarkThemeActive}
                runningSessionCount={runningSessionCountByProject.get(project) ?? 0}
                draftCount={draftCountByProject.get(project) ?? 0}
                projectIconPath={projectCardIconByPath[project] ?? null}
                showProjectIcon={!!projectCardIconByPath[project] && !brokenProjectCardIcons[project]}
                projectGitRepos={projectGitReposByPath[project]}
                isDiscoveringProjectGitRepos={!!discoveringProjectGitRepos[project]}
                onSelectProject={onSelectProject}
                onOpenGitWorkspace={onOpenGitWorkspace}
                onOpenProjectSettings={onOpenProjectSettings}
                onRemoveRecent={onRemoveRecent}
                onProjectIconError={onProjectIconError}
                onMouseMove={onRepoCardMouseMove}
                onMouseLeave={onRepoCardMouseLeave}
              />
            ))}

            <button
              onClick={onAddProject}
              className="group flex h-[248px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-white/50 bg-white/25 text-slate-600 backdrop-blur-lg backdrop-saturate-150 transition-all duration-200 hover:-translate-y-1 hover:border-primary/50 hover:bg-white/45 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:border-white/20 dark:hover:bg-white/10"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/70 shadow-sm backdrop-blur-sm transition-transform group-hover:scale-105 dark:border dark:border-white/10 dark:bg-white/10">
                <Plus className="h-7 w-7 text-slate-400 transition-colors group-hover:text-primary" />
              </span>
              <span className="text-lg font-semibold transition-colors group-hover:text-primary">
                Add Project
              </span>
              <span className="text-sm text-slate-400 dark:text-slate-500">Import from local folder or git URL</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
