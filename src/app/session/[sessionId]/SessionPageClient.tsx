'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { SessionView } from '@/components/SessionView';
import { consumeSessionLaunchContext, getSessionMetadata, SessionMetadata, markSessionInitialized } from '@/app/actions/session';
import { getSessionTerminalSources, resolveRepoCardIcon, startTtydProcess } from '@/app/actions/git';
import { getRepoAlias } from '@/app/actions/config';
import { clearPendingSessionNavigation } from '@/lib/session-navigation';

type SessionNotificationPayload = {
    type: 'session-notification';
    sessionId: string;
    title: string;
    description: string;
    timestamp: string;
};

const SESSION_FALLBACK_FAVICON_PATH = '/repo-generic-icon.svg';
const APP_DEFAULT_FAVICON_PATH = '/palx-icon.png';
const SESSION_FAVICON_DATA_ATTR = 'data-viba-session-favicon';

function withFaviconCacheBuster(href: string, key: string): string {
    const separator = href.includes('?') ? '&' : '?';
    return `${href}${separator}${key}=${Date.now()}`;
}

function upsertManagedFaviconLink(rel: 'icon' | 'shortcut icon', href: string): void {
    const selector = `link[rel="${rel}"][${SESSION_FAVICON_DATA_ATTR}="1"]`;
    const existing = document.head.querySelector(selector) as HTMLLinkElement | null;
    if (existing) {
        existing.href = href;
        return;
    }

    const link = document.createElement('link');
    link.rel = rel;
    link.href = href;
    link.setAttribute(SESSION_FAVICON_DATA_ATTR, '1');
    document.head.appendChild(link);
}

function applySessionFavicon(href: string): void {
    upsertManagedFaviconLink('icon', href);
    upsertManagedFaviconLink('shortcut icon', href);
}

function clearManagedSessionFavicons(): void {
    document.head.querySelectorAll(`link[${SESSION_FAVICON_DATA_ATTR}="1"]`).forEach((node) => {
        node.remove();
    });
}

function restoreAppFavicon(): void {
    clearManagedSessionFavicons();
    const defaultHref = withFaviconCacheBuster(APP_DEFAULT_FAVICON_PATH, 'viba-app-favicon');
    const defaultIconLink = document.head.querySelector(`link[rel="icon"]:not([${SESSION_FAVICON_DATA_ATTR}])`) as HTMLLinkElement | null;
    if (defaultIconLink) {
        defaultIconLink.href = defaultHref;
    }
}

export default function SessionPage() {
    const params = useParams<{ sessionId: string }>();
    const sessionIdParam = params.sessionId;
    const sessionId = Array.isArray(sessionIdParam) ? sessionIdParam[0] : sessionIdParam;
    const router = useRouter();

    const [metadata, setMetadata] = useState<SessionMetadata | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [terminalSources, setTerminalSources] = useState<{
        agentTerminalSrc: string;
        floatingTerminalSrc: string;
    } | null>(null);

    // Startup params — only populated on first open (initialized === false)
    const [initialMessage, setInitialMessage] = useState<string | undefined>(undefined);
    const [startupScript, setStartupScript] = useState<string | undefined>(undefined);
    const [contextTitle, setContextTitle] = useState<string | undefined>(undefined);
    const [contextAgentProvider, setContextAgentProvider] = useState<string | undefined>(undefined);
    const [contextSessionMode, setContextSessionMode] = useState<'fast' | 'plan' | undefined>(undefined);
    const [contextAttachmentPaths, setContextAttachmentPaths] = useState<string[]>([]);

    // True = send --resume to agent; False = send fresh start params
    const [isResume, setIsResume] = useState<boolean>(true);
    const [terminalPersistenceMode, setTerminalPersistenceMode] = useState<'tmux' | 'shell'>('shell');
    const [repoDisplayName, setRepoDisplayName] = useState<string | undefined>(undefined);
    const [sessionFaviconHref, setSessionFaviconHref] = useState<string>(SESSION_FALLBACK_FAVICON_PATH);

    const handleOpenSessionNotification = useCallback(() => {
        if (!sessionId) return;

        window.focus();
        const targetPath = `/session/${sessionId}`;
        if (window.location.pathname !== targetPath) {
            router.push(targetPath);
        }
    }, [router, sessionId]);

    useEffect(() => {
        document.documentElement.classList.add('session-page');
        return () => {
            document.documentElement.classList.remove('session-page');
        };
    }, []);

    useEffect(() => {
        const cacheBustedFavicon = withFaviconCacheBuster(sessionFaviconHref, 'viba-session-favicon');
        applySessionFavicon(cacheBustedFavicon);
    }, [sessionFaviconHref]);

    useEffect(() => {
        return () => {
            restoreAppFavicon();
        };
    }, []);

    useEffect(() => {
        if (!sessionId) return;
        clearPendingSessionNavigation(sessionId);
    }, [sessionId]);

    useEffect(() => {
        if (!sessionId) return;

        let cancelled = false;
        let socket: WebSocket | null = null;
        let reconnectTimer: number | null = null;
        let reconnectAttempt = 0;
        let browserNotification: Notification | null = null;

        const clearReconnectTimer = () => {
            if (reconnectTimer === null) return;
            window.clearTimeout(reconnectTimer);
            reconnectTimer = null;
        };

        const scheduleReconnect = () => {
            if (cancelled) return;
            const delay = Math.min(10000, 1000 * (2 ** reconnectAttempt));
            reconnectAttempt += 1;
            reconnectTimer = window.setTimeout(() => {
                reconnectTimer = null;
                void connect();
            }, delay);
        };

        const showBrowserNotification = async (payload: SessionNotificationPayload) => {
            if (!('Notification' in window)) return;

            let permission = Notification.permission;
            if (permission === 'default') {
                permission = await Notification.requestPermission();
            }
            if (permission !== 'granted') return;

            if (browserNotification) {
                browserNotification.close();
            }

            browserNotification = new Notification(payload.title, {
                body: payload.description,
                tag: `viba-session-notification-${payload.sessionId}`,
            });
            browserNotification.onclick = (event) => {
                event.preventDefault();
                handleOpenSessionNotification();
                browserNotification?.close();
            };
        };

        const handleIncomingNotification = (payload: SessionNotificationPayload) => {
            void showBrowserNotification(payload);
        };

        const connect = async () => {
            try {
                const response = await fetch(
                    `/api/notifications/socket?sessionId=${encodeURIComponent(sessionId)}`,
                    { cache: 'no-store' }
                );
                if (!response.ok) {
                    throw new Error('Failed to initialize notification socket');
                }

                const data = await response.json() as { wsUrl?: string };
                if (!data.wsUrl) {
                    throw new Error('Notification socket URL missing');
                }

                if (cancelled) return;

                socket = new WebSocket(data.wsUrl);
                socket.onopen = () => {
                    reconnectAttempt = 0;
                    clearReconnectTimer();
                };
                socket.onerror = () => {
                    socket?.close();
                };
                socket.onclose = () => {
                    if (cancelled) return;
                    scheduleReconnect();
                };
                socket.onmessage = (event) => {
                    try {
                        const payload = JSON.parse(event.data as string) as Partial<SessionNotificationPayload>;
                        if (
                            payload.type !== 'session-notification' ||
                            payload.sessionId !== sessionId ||
                            typeof payload.title !== 'string' ||
                            !payload.title.trim() ||
                            typeof payload.description !== 'string' ||
                            !payload.description.trim() ||
                            typeof payload.timestamp !== 'string'
                        ) {
                            return;
                        }

                        handleIncomingNotification(payload as SessionNotificationPayload);
                    } catch {
                        // Ignore malformed notification messages.
                    }
                };
            } catch {
                scheduleReconnect();
            }
        };

        void connect();

        return () => {
            cancelled = true;
            clearReconnectTimer();
            socket?.close();
            browserNotification?.close();
        };
    }, [handleOpenSessionNotification, sessionId]);

    useEffect(() => {
        if (!sessionId) return;

        let cancelled = false;

        const loadSession = async () => {
            try {
                setSessionFaviconHref(SESSION_FALLBACK_FAVICON_PATH);
                setTerminalSources(null);

                // Ensure ttyd is running
                const ttydResult = await startTtydProcess();
                if (!ttydResult.success) {
                    if (cancelled) return;
                    setError('Failed to start terminal service');
                    setLoading(false);
                    return;
                }
                if (cancelled) return;
                setTerminalPersistenceMode(ttydResult.persistenceMode === 'tmux' ? 'tmux' : 'shell');

                const data = await getSessionMetadata(sessionId);
                if (!data) {
                    if (cancelled) return;
                    setError('Session not found');
                    setLoading(false);
                    return;
                }

                try {
                    const iconResult = await resolveRepoCardIcon(data.repoPath);
                    if (!cancelled && iconResult.success && iconResult.iconPath) {
                        setSessionFaviconHref(`/api/file-thumbnail?path=${encodeURIComponent(iconResult.iconPath)}`);
                    }
                } catch {
                    if (!cancelled) {
                        setSessionFaviconHref(SESSION_FALLBACK_FAVICON_PATH);
                    }
                }

                if (cancelled) return;
                setMetadata(data);
                const alias = await getRepoAlias(data.repoPath);
                if (cancelled) return;
                if (alias) {
                    setRepoDisplayName(alias);
                }
                const resolvedTerminalSources = await getSessionTerminalSources(
                    data.sessionName,
                    data.repoPath,
                    data.agent,
                );
                if (cancelled) return;
                setTerminalSources(resolvedTerminalSources);

                // Determine fresh start vs resume purely from the initialized flag:
                // - initialized === false  → first open, send startup params
                // - initialized === true   → already started before, resume
                // - initialized === undefined → legacy session (no flag), treat as resume
                const isFirstOpen = data.initialized === false;

                if (isFirstOpen) {
                    // Consume the launch context (startup params) written by GitRepoSelector
                    const contextResult = await consumeSessionLaunchContext(sessionId);
                    if (cancelled) return;
                    if (contextResult.success && contextResult.context) {
                        const ctx = contextResult.context;
                        setInitialMessage(ctx.initialMessage);
                        setStartupScript(ctx.startupScript);
                        setContextTitle(ctx.title);
                        setContextAgentProvider(ctx.agentProvider);
                        setContextSessionMode(ctx.sessionMode);
                        const launchAttachmentPaths = (ctx.attachmentPaths || [])
                            .map((entry) => entry.trim())
                            .filter(Boolean);
                        const resolvedAttachmentPaths = launchAttachmentPaths.length > 0
                            ? Array.from(new Set(launchAttachmentPaths))
                            : Array.from(
                                new Set(
                                    (ctx.attachmentNames || [])
                                        .map((name) => name.trim())
                                        .filter(Boolean)
                                        .map((name) => `${data.worktreePath}-attachments/${name}`)
                                )
                            );
                        setContextAttachmentPaths(resolvedAttachmentPaths);
                    }
                    // Whether or not we got context, this is a fresh start
                    setIsResume(false);
                } else {
                    // Already initialized (or legacy) — resume
                    setIsResume(true);
                }

                if (cancelled) return;
                setLoading(false);
            } catch (e) {
                if (cancelled) return;
                console.error('Failed to load session:', e);
                setError('Failed to load session');
                setLoading(false);
            }
        };

        void loadSession();

        return () => {
            cancelled = true;
        };
    }, [sessionId]);

    const handleExit = (force?: boolean) => {
        if (force) {
            router.replace('/');
        } else {
            router.push('/');
        }
    };

    // Called by SessionView once the agent command has been sent for the first time
    const handleSessionStart = async () => {
        if (sessionId) {
            await markSessionInitialized(sessionId);
        }
    };

    if (loading) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-[#f6f6f8] dark:bg-[#0d1117]">
                <div className="flex flex-col items-center gap-4">
                    <span className="loading loading-spinner loading-lg text-primary"></span>
                    <p className="opacity-60 dark:text-slate-400">Loading session...</p>
                </div>
            </div>
        );
    }

    if (error || !metadata) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-[#f6f6f8] dark:bg-[#0d1117]">
                <div className="card w-96 border border-slate-200 bg-white shadow-xl dark:border-[#30363d] dark:bg-[#161b22]">
                    <div className="card-body items-center text-center">
                        <h2 className="card-title text-error dark:text-red-300">Error</h2>
                        <p className="text-slate-700 dark:text-slate-300">{error || 'Session not found'}</p>
                        <div className="card-actions justify-end">
                            <button className="btn btn-primary" onClick={() => handleExit()}>Back to Home</button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (!terminalSources) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-[#f6f6f8] dark:bg-[#0d1117]">
                <div className="flex flex-col items-center gap-4">
                    <span className="loading loading-spinner loading-lg text-primary"></span>
                    <p className="opacity-60 dark:text-slate-400">Initializing terminals...</p>
                </div>
            </div>
        );
    }

    return (
        <SessionView
            repo={metadata.repoPath}
            repoDisplayName={repoDisplayName}
            worktree={metadata.worktreePath}
            branch={metadata.branchName}
            baseBranch={metadata.baseBranch}
            sessionName={metadata.sessionName}
            agent={contextAgentProvider || metadata.agent}
            startupScript={startupScript}
            devServerScript={metadata.devServerScript}
            initialMessage={initialMessage}
            attachmentPaths={contextAttachmentPaths}
            title={contextTitle || metadata.title}
            sessionMode={contextSessionMode}
            onExit={handleExit}
            isResume={isResume}
            terminalPersistenceMode={terminalPersistenceMode}
            onSessionStart={handleSessionStart}
            agentTerminalSrc={terminalSources.agentTerminalSrc}
            floatingTerminalSrc={terminalSources.floatingTerminalSrc}
        />
    );
}
