import {
  ChevronRight,
  ChevronsUpDown,
  MoreHorizontal,
  Play,
  RotateCw,
  Settings,
  Square,
  X,
  GitBranch as GitBranchIcon,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import type { SessionMetadata } from '@/app/actions/session';
import { APP_PAGE_PANEL_CLASS } from '@/components/app-shell/AppPageSurface';
import type { HomeProjectGitRepo } from '@/lib/home-project-git';
import { shouldShowHomeProjectGitAction } from '@/lib/home-project-card-actions';
import { getBaseName } from '@/lib/path';
import { getProjectIconUrl, type ProjectIconValue } from '@/lib/project-icons';
import { getStableRepoCardGradient } from '@/lib/repo-card-gradient';
import {
  deriveSessionStatus,
  formatSessionStatus,
  getSessionStatusBadgeTone,
} from '@/lib/session-status';

export type HomeRepoCardProps = {
  project: string;
  projectDisplayName?: string;
  projectSecondaryLabel?: string;
  isProjectOpenable?: boolean;
  areActionButtonsReady?: boolean;
  isDarkThemeActive: boolean;
  runningSessionCount: number;
  runningSessions: SessionMetadata[];
  draftCount: number;
  projectIcon: ProjectIconValue | null;
  showProjectIcon: boolean;
  projectGitRepos?: HomeProjectGitRepo[];
  isDiscoveringProjectGitRepos: boolean;
  isProjectServiceConfigured?: boolean;
  isProjectServiceRunning?: boolean;
  projectServiceActionState?: 'start' | 'stop' | 'restart' | null;
  onSelectProject: (project: string) => void | Promise<boolean>;
  onOpenSession: (sessionName: string) => void | Promise<void>;
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
};

function normalizePathForComparison(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').replace(/\/+$/, '');
}

function HomeRepoCardAction({
  isVisible,
  children,
}: {
  isVisible: boolean;
  children: ReactNode;
}) {
  const [isAnimatedIn, setIsAnimatedIn] = useState(false);

  useEffect(() => {
    if (!isVisible) {
      setIsAnimatedIn(false);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setIsAnimatedIn(true);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isVisible]);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      className={`transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none ${
        isAnimatedIn ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
      }`}
    >
      {children}
    </div>
  );
}

export function HomeRepoCard({
  project,
  projectDisplayName,
  projectSecondaryLabel,
  isProjectOpenable = true,
  areActionButtonsReady = true,
  isDarkThemeActive,
  runningSessionCount,
  runningSessions,
  draftCount,
  projectIcon,
  showProjectIcon,
  projectGitRepos,
  isDiscoveringProjectGitRepos,
  isProjectServiceConfigured = false,
  isProjectServiceRunning = false,
  projectServiceActionState = null,
  onSelectProject,
  onOpenSession,
  onOpenGitWorkspace,
  onProjectServiceAction,
  onOpenProjectServiceLog,
  onOpenProjectSettings,
  onRemoveRecent,
  onProjectIconError,
}: HomeRepoCardProps) {
  const projectName = projectDisplayName || getBaseName(project);
  const secondaryLabel = projectSecondaryLabel || project;
  const cardGradient = getStableRepoCardGradient(normalizePathForComparison(project));
  const actionButtonClass = 'app-ui-icon-button';
  const destructiveActionButtonClass = 'app-ui-icon-button app-ui-icon-button-danger';
  const menuItemClass =
    'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300 dark:hover:bg-[#30363d]/70';
  const [isGitRepoMenuOpen, setIsGitRepoMenuOpen] = useState(false);
  const [isSessionMenuOpen, setIsSessionMenuOpen] = useState(false);
  const [isServiceMenuOpen, setIsServiceMenuOpen] = useState(false);
  const gitRepoMenuRef = useRef<HTMLDivElement | null>(null);
  const sessionMenuRef = useRef<HTMLDivElement | null>(null);
  const serviceMenuRef = useRef<HTMLDivElement | null>(null);
  const hasOpenMenu = isGitRepoMenuOpen || isSessionMenuOpen || isServiceMenuOpen;
  const hasCustomProjectIcon = showProjectIcon;
  const projectIconUrl = getProjectIconUrl(projectIcon);
  const discoveredProjectGitRepos = projectGitRepos ?? [];
  const hasGitRepos = discoveredProjectGitRepos.length > 0;
  const hasMultipleGitRepos = discoveredProjectGitRepos.length > 1;
  const shouldShowGitWorkspaceButton = shouldShowHomeProjectGitAction(projectGitRepos);

  useEffect(() => {
    if (!isGitRepoMenuOpen && !isSessionMenuOpen && !isServiceMenuOpen) return;
    const handleDocumentClick = (event: globalThis.MouseEvent) => {
      if (gitRepoMenuRef.current?.contains(event.target as Node)) return;
      if (sessionMenuRef.current?.contains(event.target as Node)) return;
      if (serviceMenuRef.current?.contains(event.target as Node)) return;
      setIsGitRepoMenuOpen(false);
      setIsSessionMenuOpen(false);
      setIsServiceMenuOpen(false);
    };
    document.addEventListener('mousedown', handleDocumentClick);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
    };
  }, [isGitRepoMenuOpen, isSessionMenuOpen, isServiceMenuOpen]);

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
      role={isProjectOpenable ? 'button' : undefined}
      tabIndex={isProjectOpenable ? 0 : -1}
      className={`group relative min-h-[194px] text-left ${
        hasOpenMenu ? 'z-20 ' : ''
      }${
        isProjectOpenable ? 'cursor-pointer' : 'cursor-default'
      }`}
    >
      <div
        className={`relative h-full ${
          hasOpenMenu ? 'overflow-visible' : 'overflow-hidden'
        } transition-all duration-200 hover:-translate-y-1 hover:border-primary/45 hover:bg-white dark:hover:border-slate-600 dark:hover:bg-slate-950 ${APP_PAGE_PANEL_CLASS}`}
        style={isDarkThemeActive ? undefined : cardGradient}
      >
        <div className="absolute inset-0 rounded-[inherit] bg-white/46 dark:bg-slate-950/44" />
        <div className="relative flex h-full flex-col p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="relative flex shrink-0 items-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-[1rem] border border-slate-200/80 bg-white text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={projectIconUrl}
                  alt={`${projectName} icon`}
                  className="h-10 w-10 rounded-lg object-cover"
                  onError={hasCustomProjectIcon && projectIcon?.iconPath ? () => onProjectIconError(project) : undefined}
                />
              </div>
              <div className="absolute -right-3 -top-2 z-10 flex gap-1">
                {draftCount > 0 ? (
                  <span
                    className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-white bg-primary px-1.5 text-[11px] font-bold text-white shadow-sm dark:border-[var(--app-dark-root)]"
                    title={`${draftCount} draft${draftCount === 1 ? '' : 's'}`}
                  >
                    {draftCount}
                  </span>
                ) : null}
                {runningSessionCount > 0 ? (
                  <span
                    className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-white bg-emerald-500 px-1.5 text-[11px] font-bold text-white shadow-sm dark:border-[#141a25]"
                    title={`${runningSessionCount} running session${runningSessionCount === 1 ? '' : 's'}`}
                    style={draftCount > 0 ? { marginLeft: '-0.5rem' } : {}}
                  >
                    {runningSessionCount}
                  </span>
                ) : null}
              </div>
            </div>

            <div
              className={`flex min-h-10 shrink-0 flex-nowrap items-center justify-end gap-1.5 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none ${
                areActionButtonsReady
                  ? 'translate-y-0 opacity-100'
                  : 'pointer-events-none translate-y-1 opacity-0'
              }`}
              aria-hidden={!areActionButtonsReady}
            >
              <HomeRepoCardAction isVisible={isProjectServiceConfigured}>
                <div className="relative" ref={serviceMenuRef}>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setIsGitRepoMenuOpen(false);
                      setIsSessionMenuOpen(false);
                      setIsServiceMenuOpen((previous) => !previous);
                    }}
                    className={`relative ${actionButtonClass}`}
                    title="Service controls"
                    disabled={projectServiceActionState !== null}
                  >
                    {projectServiceActionState ? (
                      <span className="loading loading-spinner loading-sm" />
                    ) : (
                      <MoreHorizontal className="h-[18px] w-[18px]" />
                    )}
                    {isProjectServiceRunning && projectServiceActionState === null ? (
                      <span className="pointer-events-none absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900" />
                    ) : null}
                  </button>
                  {isServiceMenuOpen ? (
                    <div className="absolute right-0 top-11 z-30 w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-[#30363d] dark:bg-[#161b22]">
                      <button
                        type="button"
                        className={menuItemClass}
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
                        className={menuItemClass}
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
                        className={menuItemClass}
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
                      {isProjectServiceRunning ? (
                        <button
                          type="button"
                          className={menuItemClass}
                          onClick={(event) => {
                            event.stopPropagation();
                            setIsServiceMenuOpen(false);
                            void onOpenProjectServiceLog(event, project);
                          }}
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                          View logs
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </HomeRepoCardAction>

              <HomeRepoCardAction isVisible={isProjectOpenable && shouldShowGitWorkspaceButton}>
                <div className="relative" ref={gitRepoMenuRef}>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setIsServiceMenuOpen(false);
                      setIsSessionMenuOpen(false);
                      if (isDiscoveringProjectGitRepos) return;
                      if (!hasMultipleGitRepos) {
                        onOpenGitWorkspace(project);
                        return;
                      }
                      setIsGitRepoMenuOpen((previous) => !previous);
                    }}
                    className={actionButtonClass}
                    title={isDiscoveringProjectGitRepos
                      ? 'Discovering repositories...'
                      : hasMultipleGitRepos
                          ? 'Select a repository'
                          : 'Open Git Workspace'}
                    disabled={isDiscoveringProjectGitRepos}
                  >
                    <GitBranchIcon className="h-[18px] w-[18px]" />
                  </button>
                  {hasMultipleGitRepos && isGitRepoMenuOpen ? (
                    <div className="absolute right-0 top-11 z-30 max-h-56 w-52 overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-[#30363d] dark:bg-[#161b22]">
                      {discoveredProjectGitRepos.map((repoEntry) => {
                        return (
                          <button
                            key={repoEntry.repoPath}
                            type="button"
                            className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-[#30363d]/70"
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
              </HomeRepoCardAction>

              <HomeRepoCardAction isVisible={runningSessions.length > 0}>
                <div className="relative" ref={sessionMenuRef}>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setIsGitRepoMenuOpen(false);
                      setIsServiceMenuOpen(false);
                      setIsSessionMenuOpen((previous) => !previous);
                    }}
                    className={actionButtonClass}
                    title="Open an ongoing session"
                  >
                    <ChevronsUpDown className="h-[18px] w-[18px]" />
                  </button>
                  {isSessionMenuOpen ? (
                    <div className="absolute right-0 top-11 z-30 max-h-64 w-64 overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-[#30363d] dark:bg-[#161b22]">
                      {runningSessions.map((session) => {
                        const sessionStatus = deriveSessionStatus(session.runState);
                        return (
                          <button
                            key={session.sessionName}
                            type="button"
                            className="flex w-full flex-col items-start gap-1 rounded-md px-2 py-2 text-left hover:bg-slate-100 dark:hover:bg-[#30363d]/70"
                            title={session.title || session.sessionName}
                            onClick={(event) => {
                              event.stopPropagation();
                              setIsSessionMenuOpen(false);
                              void onOpenSession(session.sessionName);
                            }}
                          >
                            <span className="w-full truncate text-xs font-medium text-slate-800 dark:text-slate-100">
                              {session.title || session.sessionName}
                            </span>
                            <div className="flex w-full items-center gap-2">
                              <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
                                {session.model || session.agent}
                              </span>
                              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${getSessionStatusBadgeTone(sessionStatus)}`}>
                                {formatSessionStatus(sessionStatus)}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </HomeRepoCardAction>

              <button
                type="button"
                onClick={(event) => {
                  void onOpenProjectSettings(event, project);
                }}
                className={actionButtonClass}
                title="Project settings"
              >
                <Settings className="h-[18px] w-[18px]" />
              </button>
              <button
                type="button"
                onClick={(event) => onRemoveRecent(event, project)}
                className={destructiveActionButtonClass}
                title="Delete project"
              >
                <X className="h-[18px] w-[18px]" />
              </button>
            </div>
          </div>

          <h3 className="mt-4 min-w-0 truncate text-base font-semibold leading-tight text-slate-900 dark:text-white">
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
    </div>
  );
}
