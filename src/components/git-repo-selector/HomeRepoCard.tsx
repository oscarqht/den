import {
  ChevronRight,
  MoreHorizontal,
  Play,
  RotateCw,
  Settings,
  Square,
  X,
  GitBranch as GitBranchIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { APP_PAGE_PANEL_CLASS } from '@/components/app-shell/AppPageSurface';
import { getBaseName } from '@/lib/path';
import { getProjectIconUrl } from '@/lib/project-icons';
import type { HomeProjectGitRepo } from '@/lib/home-project-git';
import { getStableRepoCardGradient } from '@/lib/repo-card-gradient';

export type HomeRepoCardProps = {
  project: string;
  projectDisplayName?: string;
  projectSecondaryLabel?: string;
  isProjectOpenable?: boolean;
  isDarkThemeActive: boolean;
  runningSessionCount: number;
  latestRunningSessionId?: string | null;
  draftCount: number;
  projectIconPath: string | null;
  showProjectIcon: boolean;
  projectGitRepos?: HomeProjectGitRepo[];
  isDiscoveringProjectGitRepos: boolean;
  isProjectServiceConfigured?: boolean;
  isProjectServiceRunning?: boolean;
  projectServiceActionState?: 'start' | 'stop' | 'restart' | null;
  onSelectProject: (project: string) => void | Promise<boolean>;
  onOpenGitWorkspace: (project: string, repoPath?: string) => void;
  onProjectServiceAction: (
    event: ReactMouseEvent,
    project: string,
    action: 'start' | 'stop' | 'restart',
  ) => void | Promise<void>;
  onOpenProjectServiceLog: (event: ReactMouseEvent, project: string) => void | Promise<void>;
  onOpenProjectSettings: (event: ReactMouseEvent, project: string) => void | Promise<void>;
  onRemoveRecent: (event: ReactMouseEvent, project: string) => void;
  onProjectIconError: (project: string) => void;
  onMouseMove: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onMouseLeave: (event: ReactMouseEvent<HTMLDivElement>) => void;
};

function normalizePathForComparison(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function HomeRepoCard({
  project,
  projectDisplayName,
  projectSecondaryLabel,
  isProjectOpenable = true,
  isDarkThemeActive,
  runningSessionCount,
  latestRunningSessionId,
  draftCount,
  projectIconPath,
  showProjectIcon,
  projectGitRepos,
  isDiscoveringProjectGitRepos,
  isProjectServiceConfigured = false,
  isProjectServiceRunning = false,
  projectServiceActionState = null,
  onSelectProject,
  onOpenGitWorkspace,
  onProjectServiceAction,
  onOpenProjectServiceLog,
  onOpenProjectSettings,
  onRemoveRecent,
  onProjectIconError,
  onMouseMove,
  onMouseLeave,
}: HomeRepoCardProps) {
  const projectName = projectDisplayName || getBaseName(project);
  const secondaryLabel = projectSecondaryLabel || project;
  const cardGradient = getStableRepoCardGradient(normalizePathForComparison(project));
  const [isGitRepoMenuOpen, setIsGitRepoMenuOpen] = useState(false);
  const [isServiceMenuOpen, setIsServiceMenuOpen] = useState(false);
  const gitRepoMenuRef = useRef<HTMLDivElement | null>(null);
  const serviceMenuRef = useRef<HTMLDivElement | null>(null);
  const hasCustomProjectIcon = showProjectIcon && !!projectIconPath;
  const projectIconUrl = hasCustomProjectIcon
    ? getProjectIconUrl(projectIconPath)
    : getProjectIconUrl();
  const discoveredProjectGitRepos = projectGitRepos ?? [];
  const hasDiscoveredGitRepos = Array.isArray(projectGitRepos);
  const hasGitRepos = discoveredProjectGitRepos.length > 0;
  const hasMultipleGitRepos = discoveredProjectGitRepos.length > 1;
  const shouldShowGitWorkspaceButton = isDiscoveringProjectGitRepos || !hasDiscoveredGitRepos || hasGitRepos;

  useEffect(() => {
    if (!isGitRepoMenuOpen && !isServiceMenuOpen) return;
    const handleDocumentClick = (event: globalThis.MouseEvent) => {
      if (gitRepoMenuRef.current?.contains(event.target as Node)) return;
      if (serviceMenuRef.current?.contains(event.target as Node)) return;
      setIsGitRepoMenuOpen(false);
      setIsServiceMenuOpen(false);
    };
    document.addEventListener('mousedown', handleDocumentClick);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
    };
  }, [isGitRepoMenuOpen, isServiceMenuOpen]);

  return (
    <div
      onClick={() => {
        if (!isProjectOpenable) return;
        void onSelectProject(project);
      }}
      onKeyDown={(event) => {
        if (!isProjectOpenable) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          void onSelectProject(project);
        }
      }}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      role={isProjectOpenable ? 'button' : undefined}
      tabIndex={isProjectOpenable ? 0 : -1}
      className={`repo-card-tilt-wrapper group relative h-[224px] text-left transition-transform duration-200 ${
        isProjectOpenable ? 'cursor-pointer' : 'cursor-default'
      }`}
    >
      <div
        className={`repo-card-tilt relative h-full overflow-hidden bg-white/82 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_22px_44px_-24px_rgba(15,23,42,0.4)] dark:bg-slate-950/82 dark:hover:border-slate-700 ${APP_PAGE_PANEL_CLASS}`}
        style={isDarkThemeActive ? undefined : cardGradient}
      >
        <div className="absolute inset-0 bg-white/46 dark:bg-slate-950/44" />
        <div className="repo-card-tilt-content relative flex h-full flex-col justify-between p-4">
          <div className="absolute right-4 top-4 z-20 flex items-start gap-2">
            <div className="flex shrink-0 items-center gap-2">
              {isProjectServiceConfigured ? (
                <div className="relative" ref={serviceMenuRef}>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setIsGitRepoMenuOpen(false);
                      setIsServiceMenuOpen((previous) => !previous);
                    }}
                    className="btn btn-circle btn-xs border border-slate-200/70 bg-white/85 text-slate-600 opacity-100 shadow-none transition-opacity md:opacity-0 md:group-hover:opacity-100 hover:bg-white hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-80 disabled:hover:bg-white/85 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white dark:disabled:hover:bg-slate-900/90"
                    title="Service controls"
                    disabled={projectServiceActionState !== null}
                  >
                    {projectServiceActionState ? (
                      <span className="loading loading-spinner loading-xs" />
                    ) : (
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    )}
                  </button>
                  {isServiceMenuOpen ? (
                    <div className="absolute right-0 top-8 z-30 w-36 rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-[#30363d] dark:bg-[#161b22]">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300 dark:hover:bg-[#30363d]/70"
                        disabled={isProjectServiceRunning}
                        onClick={(event) => {
                          event.stopPropagation();
                          setIsServiceMenuOpen(false);
                          void onProjectServiceAction(event, project, 'start');
                        }}
                      >
                        <Play className="h-3.5 w-3.5" />
                        Start
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300 dark:hover:bg-[#30363d]/70"
                        disabled={!isProjectServiceRunning}
                        onClick={(event) => {
                          event.stopPropagation();
                          setIsServiceMenuOpen(false);
                          void onProjectServiceAction(event, project, 'stop');
                        }}
                      >
                        <Square className="h-3.5 w-3.5" />
                        Stop
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300 dark:hover:bg-[#30363d]/70"
                        disabled={!isProjectServiceRunning}
                        onClick={(event) => {
                          event.stopPropagation();
                          setIsServiceMenuOpen(false);
                          void onProjectServiceAction(event, project, 'restart');
                        }}
                      >
                        <RotateCw className="h-3.5 w-3.5" />
                        Restart
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {isProjectOpenable && shouldShowGitWorkspaceButton ? (
                <div className="relative" ref={gitRepoMenuRef}>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      setIsServiceMenuOpen(false);
                      if (isDiscoveringProjectGitRepos) return;
                      if (!hasMultipleGitRepos) {
                        onOpenGitWorkspace(project);
                        return;
                      }
                      setIsGitRepoMenuOpen((previous) => !previous);
                    }}
                    className="btn btn-circle btn-xs border border-slate-200/70 bg-white/85 text-slate-600 opacity-100 shadow-none transition-opacity md:opacity-0 md:group-hover:opacity-100 hover:bg-white hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-80 disabled:hover:bg-white/85 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white dark:disabled:hover:bg-slate-900/90"
                    title={isDiscoveringProjectGitRepos
                      ? 'Discovering repositories...'
                      : hasMultipleGitRepos
                          ? 'Select a repository'
                          : 'Open Git Workspace'}
                    disabled={isDiscoveringProjectGitRepos}
                  >
                    <GitBranchIcon className="h-3.5 w-3.5" />
                  </button>
                  {hasMultipleGitRepos && isGitRepoMenuOpen ? (
                    <div className="absolute right-0 top-8 z-30 max-h-56 w-52 overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-[#30363d] dark:bg-[#161b22]">
                      {discoveredProjectGitRepos.map((repoEntry) => {
                        return (
                          <button
                            key={repoEntry.repoPath}
                            type="button"
                            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-[#30363d]/70"
                            title={repoEntry.repoPath}
                            onClick={(event) => {
                              event.stopPropagation();
                              setIsGitRepoMenuOpen(false);
                              onOpenGitWorkspace(project, repoEntry.repoPath);
                            }}
                          >
                            <span className="truncate">{repoEntry.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {latestRunningSessionId ? (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    window.location.assign(`/session/${encodeURIComponent(latestRunningSessionId)}`);
                  }}
                  className="btn btn-circle btn-xs border border-slate-200/70 bg-white/85 text-slate-600 opacity-100 shadow-none transition-opacity md:opacity-0 md:group-hover:opacity-100 hover:bg-white hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                  title="Open latest running session"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <button
                onClick={(event) => {
                  void onOpenProjectSettings(event, project);
                }}
                className="btn btn-circle btn-xs border border-slate-200/70 bg-white/85 text-slate-600 opacity-100 shadow-none transition-opacity md:opacity-0 md:group-hover:opacity-100 hover:bg-white hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                title="Project settings"
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={(event) => onRemoveRecent(event, project)}
                className="btn btn-circle btn-xs border border-slate-200/70 bg-white/85 text-slate-500 opacity-100 shadow-none transition-opacity md:opacity-0 md:group-hover:opacity-100 hover:bg-white hover:text-rose-600 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-rose-300"
                title="Delete project"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {isProjectServiceRunning ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void onOpenProjectServiceLog(event, project);
                }}
                className="inline-flex h-6 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200 dark:hover:bg-emerald-500/20"
                title="View service output"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Live
              </button>
            ) : null}
          </div>
          <div className="flex items-start gap-3">
            <div className="relative flex shrink-0 items-center">
              <div className="repo-card-tilt-icon flex h-16 w-16 items-center justify-center rounded-[1.1rem] border border-slate-200/80 bg-white text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={projectIconUrl}
                  alt={`${projectName} icon`}
                  className="h-11 w-11 rounded-lg object-cover"
                  onError={hasCustomProjectIcon ? () => onProjectIconError(project) : undefined}
                />
              </div>
              <div className="absolute -right-3 -top-2 z-10 flex gap-1">
                {draftCount > 0 && (
                  <span
                    className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-white bg-blue-500 px-1.5 text-[11px] font-bold text-white shadow-sm dark:border-[#141a25]"
                    title={`${draftCount} draft${draftCount === 1 ? '' : 's'}`}
                  >
                    {draftCount}
                  </span>
                )}
                {runningSessionCount > 0 && (
                  <span
                    className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-white bg-emerald-500 px-1.5 text-[11px] font-bold text-white shadow-sm dark:border-[#141a25]"
                    title={`${runningSessionCount} running session${runningSessionCount === 1 ? '' : 's'}`}
                    style={draftCount > 0 ? { marginLeft: '-0.5rem' } : {}}
                  >
                    {runningSessionCount}
                  </span>
                )}
              </div>
            </div>
            <div className="min-w-0 flex-1 self-start pr-24 pt-1">
              <h3 className="min-w-0 truncate pr-2 text-base font-semibold leading-tight text-slate-900 dark:text-white">
                {projectName}
              </h3>
              <p
                className="mt-2 line-clamp-2 break-all font-mono text-[11px] leading-5 text-slate-600 dark:text-slate-300"
                title={secondaryLabel}
              >
                {secondaryLabel}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between text-[12px] font-semibold text-slate-700 dark:text-slate-200">
            <span>{isProjectOpenable ? 'Open project' : 'Add folders in settings to open'}</span>
            <ChevronRight className={`h-4 w-4 transition-transform ${isProjectOpenable ? 'group-hover:translate-x-0.5' : ''}`} />
          </div>
        </div>
      </div>
    </div>
  );
}
