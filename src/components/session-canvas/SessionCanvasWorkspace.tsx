'use client';

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import ReactMarkdown from 'react-markdown';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { atomOneDark, github } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ExternalLink,
  FolderOpen,
  GitBranch,
  Monitor,
  PanelLeft,
  RefreshCw,
  ScanSearch,
  Search,
  TerminalSquare,
  Trash2,
} from 'lucide-react';

import {
  readSessionCanvasFile,
  saveSessionCanvasLayout,
  searchSessionCanvasWorkspace,
  type SessionCanvasBootstrapResult,
} from '@/app/actions/session-canvas';
import { deleteSessionInBackground } from '@/app/actions/session';
import { startTtydProcess, terminateTmuxSessionRole } from '@/app/actions/git';
import {
  buildSessionCanvasTerminalBootstrapCommand,
  buildSessionCanvasTerminalSrc,
  centerSessionCanvasViewportOnPanels,
  clampSessionCanvasScale,
  closeSessionCanvasPanel,
  createSessionCanvasPanelId,
  fitSessionCanvasLayoutToViewport,
  fitSessionCanvasViewportToPanels,
  getDefaultSessionCanvasPanelId,
  getSessionCanvasTerminalRole,
  SESSION_CANVAS_DEFAULT_GIT_PANEL_HEIGHT,
  SESSION_CANVAS_DEFAULT_GIT_PANEL_WIDTH,
  SESSION_CANVAS_STARTUP_BOOTSTRAP_VERSION,
  SESSION_CANVAS_DEFAULT_EXPLORER_WIDTH,
  shouldBootstrapSessionCanvasTerminalPanel,
} from '@/lib/session-canvas';
import AgentSessionPane, { type AgentSessionHeaderMeta } from '@/components/AgentSessionPane';
import {
  insertPathsIntoAgentInput,
  shouldAutoStartSessionCanvasAgentTurn,
  type SessionCanvasAgentInputHandle,
} from '@/lib/session-canvas-agent';
import type { SessionCanvasWorkspaceSearchResult } from '@/lib/session-canvas-search';
import { normalizeMarkdownLists } from '@/lib/markdown';
import { isPrimaryShortcutModifierPressed, isWindowsPlatform } from '@/lib/keyboard-shortcuts';
import { getBaseName, getDirName } from '@/lib/path';
import {
  sendTerminalDataEvent,
  submitTerminalBootstrapCommand,
} from '@/lib/terminal-input';
import {
  applyThemeToTerminalWindow,
  TERMINAL_THEME_DARK,
  TERMINAL_THEME_LIGHT,
} from '@/lib/ttyd-theme';
import { uploadAttachments } from '@/lib/upload-attachments';
import { normalizePreviewUrl } from '@/lib/url';
import { shouldUseDeviceFilePicker } from '@/lib/url';
import { SESSION_MOBILE_VIEWPORT_QUERY } from '@/lib/responsive';
import type {
  SessionCanvasAgentTerminalPanel,
  SessionCanvasFileViewerPanel,
  SessionCanvasLayout,
  SessionCanvasPanel,
  SessionCanvasPreviewPanel,
  SessionCanvasTerminalPanel,
} from '@/lib/types';
import { useAppDialog } from '@/hooks/use-app-dialog';
import { usePageVisibility } from '@/hooks/usePageVisibility';
import { useTerminalLink } from '@/hooks/useTerminalLink';
import SessionFileBrowser from '../SessionFileBrowser';
import { CanvasPanelFrame } from './CanvasPanelFrame';
import { SessionCanvasGitPanel } from './SessionCanvasGitPanel';
import { SessionExplorerDock } from './SessionExplorerDock';

type SessionCanvasBootstrapSuccess = Extract<SessionCanvasBootstrapResult, { success: true }>;
type SessionCanvasWorkspaceProps = {
  sessionId: string;
  bootstrap: SessionCanvasBootstrapSuccess;
};

type TerminalRuntime = {
  iframe: HTMLIFrameElement;
  win: Window & { term?: NonNullable<TerminalWindow['term']> };
  term: NonNullable<TerminalWindow['term']>;
};

type TerminalPanelHandle = {
  terminateSession: () => boolean;
};

type TerminalWindow = Window & {
  term?: {
    paste?: (text: string) => void;
    rows?: number;
    scrollLines?: (amount: number) => void;
    scrollToLine?: (line: number) => void;
    buffer?: {
      active?: {
        baseY: number;
        cursorY: number;
        getLine?: (index: number) => { translateToString: (trimRight?: boolean) => string } | undefined;
      };
    };
    _core?: {
      coreService?: {
        triggerDataEvent?: (text: string, wasUserInput?: boolean) => void;
      };
    };
  };
};

type FileViewerState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; content: string; mode: 'markdown' | 'text'; sizeBytes: number };

type PanelRestoreBounds = NonNullable<NonNullable<SessionCanvasPanel['state']>['restoreBounds']>;

type TerminalPanelProps = {
  sessionId: string;
  panel: SessionCanvasAgentTerminalPanel | SessionCanvasTerminalPanel;
  src: string;
  isDocumentDarkMode: boolean;
  isPageVisible: boolean;
  forceMount: boolean;
  terminalPersistenceMode: 'tmux' | 'shell';
  terminalServiceReady: boolean;
  terminalError: string | null;
  bootstrapCommand: string | null;
  shouldBootstrap: boolean;
  onBootstrapComplete: () => void;
  onOpenPreview: (url: string, openPreview: boolean) => Promise<boolean>;
  onRequireTerminalService: () => Promise<void>;
};

const SHELL_PROMPT_PATTERN = /(?:\$|%|#|>) $/;
const CANVAS_GRID_SIZE = 28;
const CANVAS_ZOOM_SENSITIVITY = 0.0015;
const CANVAS_WHEEL_LINE_PIXELS = 16;
const CANVAS_WHEEL_PAGE_PIXELS = 160;
const CANVAS_FIT_PADDING = {
  top: 96,
  right: 40,
  bottom: 40,
  left: 40,
} as const;
const MAXIMIZED_PANEL_PADDING = {
  top: 84,
  right: 24,
  bottom: 24,
  left: 24,
} as const;
const MOBILE_STACKED_PANEL_HEIGHT = 'calc(100dvh - 8.5rem)';
const COMMAND_PALETTE_MIN_QUERY_LENGTH = 2;
const COMMAND_PALETTE_DEBOUNCE_MS = 160;
const TERMINAL_TOUCH_SCROLL_LINE_HEIGHT_FALLBACK = 18;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toUpperCase();
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable;
}

function nextPanelZIndex(panels: SessionCanvasPanel[]): number {
  return panels.reduce((maxValue, panel) => Math.max(maxValue, panel.zIndex), 0) + 1;
}

function isValidRestoreBounds(bounds: unknown): bounds is PanelRestoreBounds {
  const candidate = bounds as Partial<PanelRestoreBounds> | null;
  return Boolean(
    candidate
    && typeof candidate === 'object'
    && Number.isFinite(candidate.x)
    && Number.isFinite(candidate.y)
    && Number.isFinite(candidate.width)
    && Number.isFinite(candidate.height),
  );
}

function updatePanelInLayout(
  layout: SessionCanvasLayout,
  panelId: string,
  updates: Partial<SessionCanvasPanel>,
): SessionCanvasLayout {
  return {
    ...layout,
    panels: layout.panels.map((panel) => (
      panel.id === panelId
        ? ({ ...panel, ...updates } as SessionCanvasPanel)
        : panel
    )),
  };
}

function focusPanelInLayout(layout: SessionCanvasLayout, panelId: string): SessionCanvasLayout {
  const topZIndex = nextPanelZIndex(layout.panels) - 1;
  const targetPanel = layout.panels.find((panel) => panel.id === panelId);
  if (!targetPanel || targetPanel.zIndex === topZIndex) {
    return layout;
  }

  return updatePanelInLayout(layout, panelId, { zIndex: topZIndex + 1 });
}

function resolveFileLanguage(filePath: string): string | undefined {
  const extension = filePath.split('.').pop()?.toLowerCase() || '';
  const languageMap: Record<string, string> = {
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    md: 'markdown',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    go: 'go',
    java: 'java',
    sh: 'bash',
    zsh: 'bash',
    css: 'css',
    scss: 'scss',
    html: 'html',
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    sql: 'sql',
  };

  return languageMap[extension] || (extension || undefined);
}

function isShellPromptReady(term: NonNullable<TerminalWindow['term']>): boolean {
  const activeBuffer = term.buffer?.active;
  if (!activeBuffer || typeof activeBuffer.getLine !== 'function') {
    return true;
  }

  const cursorLine = activeBuffer.baseY + activeBuffer.cursorY;
  for (let offset = 0; offset < 6; offset += 1) {
    const line = activeBuffer.getLine(cursorLine - offset);
    const text = line?.translateToString(true) ?? '';
    if (!text.trim()) continue;
    return SHELL_PROMPT_PATTERN.test(text);
  }

  return false;
}

function getTerminalRuntime(iframe: HTMLIFrameElement | null): TerminalRuntime | null {
  if (!iframe) return null;

  try {
    const win = iframe.contentWindow as TerminalWindow | null;
    if (!win?.term) return null;
    return {
      iframe,
      win: win as TerminalRuntime['win'],
      term: win.term,
    };
  } catch {
    return null;
  }
}

function sendTerminalEnter(runtime: TerminalRuntime): boolean {
  try {
    const textarea = runtime.iframe.contentDocument?.querySelector('textarea.xterm-helper-textarea');
    const TerminalKeyboardEvent = KeyboardEvent;
    if (textarea && typeof textarea.dispatchEvent === 'function') {
      const eventInit = {
        bubbles: true,
        cancelable: true,
        code: 'Enter',
        charCode: 13,
        keyCode: 13,
        key: 'Enter',
        which: 13,
        view: runtime.win,
      };
      textarea.dispatchEvent(new TerminalKeyboardEvent('keydown', eventInit));
      textarea.dispatchEvent(new TerminalKeyboardEvent('keypress', eventInit));
      textarea.dispatchEvent(new TerminalKeyboardEvent('keyup', eventInit));
      return true;
    }
  } catch {
    // Fall through to the direct-input fallback.
  }

  return sendTerminalDataEvent(runtime.term, '\r');
}

function attachTerminalTouchScrollBridge(runtime: TerminalRuntime): () => void {
  const doc = runtime.iframe.contentDocument;
  const term = runtime.term;
  if (!doc || typeof term.scrollLines !== 'function') {
    return () => {};
  }
  const scrollLines = term.scrollLines.bind(term);

  let activeTouchId: number | null = null;
  let lastClientY: number | null = null;
  let pixelCarry = 0;

  const resolveLineHeight = () => {
    const viewport = doc.querySelector('.xterm-viewport');
    const rows = typeof term.rows === 'number' ? term.rows : 0;
    if (viewport instanceof HTMLElement && rows > 0 && viewport.clientHeight > 0) {
      return Math.max(8, viewport.clientHeight / rows);
    }
    return TERMINAL_TOUCH_SCROLL_LINE_HEIGHT_FALLBACK;
  };

  const resetGestureState = () => {
    activeTouchId = null;
    lastClientY = null;
    pixelCarry = 0;
  };

  const getTrackedTouch = (touchList: TouchList) => {
    if (activeTouchId == null) return null;
    for (const touch of Array.from(touchList)) {
      if (touch.identifier === activeTouchId) {
        return touch;
      }
    }
    return null;
  };

  const handleTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      resetGestureState();
      return;
    }

    const [touch] = Array.from(event.touches);
    if (!touch) {
      resetGestureState();
      return;
    }

    activeTouchId = touch.identifier;
    lastClientY = touch.clientY;
    pixelCarry = 0;
  };

  const handleTouchMove = (event: TouchEvent) => {
    const touch = getTrackedTouch(event.touches);
    if (!touch) return;

    if (lastClientY == null) {
      lastClientY = touch.clientY;
      return;
    }

    const deltaY = touch.clientY - lastClientY;
    lastClientY = touch.clientY;
    pixelCarry += deltaY;

    const lineHeight = resolveLineHeight();
    const wholeLines = pixelCarry > 0
      ? Math.floor(pixelCarry / lineHeight)
      : Math.ceil(pixelCarry / lineHeight);

    if (wholeLines !== 0) {
      scrollLines(-wholeLines);
      pixelCarry -= wholeLines * lineHeight;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  const handleTouchEnd = (event: TouchEvent) => {
    const touch = getTrackedTouch(event.changedTouches);
    if (!touch) return;
    resetGestureState();
  };

  const options: AddEventListenerOptions = { passive: false };
  doc.addEventListener('touchstart', handleTouchStart, options);
  doc.addEventListener('touchmove', handleTouchMove, options);
  doc.addEventListener('touchend', handleTouchEnd, options);
  doc.addEventListener('touchcancel', handleTouchEnd, options);

  return () => {
    doc.removeEventListener('touchstart', handleTouchStart);
    doc.removeEventListener('touchmove', handleTouchMove);
    doc.removeEventListener('touchend', handleTouchEnd);
    doc.removeEventListener('touchcancel', handleTouchEnd);
  };
}

function resolveBrowserInitialPath(args: {
  selectedPath: string | null;
  expandedPaths: string[];
  rootPaths: string[];
  fallbackPath: string;
}): string {
  const normalizedPath = args.selectedPath?.trim();
  if (!normalizedPath) {
    return args.fallbackPath;
  }

  if (args.rootPaths.includes(normalizedPath) || args.expandedPaths.includes(normalizedPath)) {
    return normalizedPath;
  }

  return getDirName(normalizedPath) || args.fallbackPath;
}

function buildPreviewPanelTitle(url: string): string {
  const normalized = normalizePreviewUrl(url);
  if (!normalized) return 'Preview';
  try {
    return new URL(normalized).host || 'Preview';
  } catch {
    return 'Preview';
  }
}

function sessionWorkspacePreferenceLabel(workspaceMode: SessionCanvasBootstrapSuccess['metadata']['workspaceMode']): 'Local' | 'Workspace' {
  return workspaceMode === 'local_source' ? 'Local' : 'Workspace';
}

function renderHighlightedText(text: string, query: string): React.ReactNode {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return text;
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = trimmedQuery.toLowerCase();
  const segments: React.ReactNode[] = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(lowerQuery, cursor);

  while (matchIndex !== -1) {
    if (matchIndex > cursor) {
      segments.push(text.slice(cursor, matchIndex));
    }

    const matchEnd = matchIndex + trimmedQuery.length;
    segments.push(
      <mark
        key={`${matchIndex}:${matchEnd}`}
        className="rounded bg-amber-200/80 px-0.5 text-inherit dark:bg-amber-400/20"
      >
        {text.slice(matchIndex, matchEnd)}
      </mark>,
    );
    cursor = matchEnd;
    matchIndex = lowerText.indexOf(lowerQuery, cursor);
  }

  if (cursor < text.length) {
    segments.push(text.slice(cursor));
  }

  return segments;
}

function getShortcutPlatform(): string {
  if (typeof navigator === 'undefined') {
    return '';
  }

  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };

  return navigatorWithUserAgentData.userAgentData?.platform || navigator.platform || '';
}

function readDocumentDarkMode(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  return document.documentElement.classList.contains('dark');
}

function useDocumentDarkMode(): boolean {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => readDocumentDarkMode());

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
      return;
    }

    const root = document.documentElement;
    const syncDarkMode = () => {
      setIsDarkMode(root.classList.contains('dark'));
    };

    syncDarkMode();

    const observer = new MutationObserver(() => {
      syncDarkMode();
    });

    observer.observe(root, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  return isDarkMode;
}

function usePanelIframeVisibility(options: {
  enabled: boolean;
  forceMount?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isIntersecting, setIsIntersecting] = useState(() => Boolean(options.enabled));

  useEffect(() => {
    if (!options.enabled) {
      setIsIntersecting(false);
      return;
    }

    if (options.forceMount) {
      setIsIntersecting(true);
      return;
    }

    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setIsIntersecting(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      setIsIntersecting(entry?.isIntersecting ?? false);
    }, {
      threshold: 0.01,
      rootMargin: '96px',
    });

    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [options.enabled, options.forceMount]);

  return {
    containerRef,
    shouldMount: options.enabled && (options.forceMount || isIntersecting),
  };
}

const MarkdownFileContent = memo(function MarkdownFileContent({ content }: { content: string }) {
  const { resolvedTheme } = useTheme();
  const text = normalizeMarkdownLists(content);
  const isDarkTheme = resolvedTheme === 'dark';
  const syntaxTheme = useMemo(() => (isDarkTheme ? atomOneDark : github), [isDarkTheme]);

  return (
    <div className="h-full overflow-auto">
      <div className="px-5 py-4 text-[14px] leading-7 text-slate-700 dark:text-slate-200">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={{
            h1: ({ children }) => (
              <h1 className="mb-4 text-[2rem] font-semibold tracking-[-0.03em] text-slate-900 last:mb-0 dark:text-slate-50">
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 className="mb-4 mt-8 border-t border-slate-200 pt-8 text-[1.9rem] font-semibold tracking-[-0.03em] text-slate-900 first:mt-0 first:border-t-0 first:pt-0 last:mb-0 dark:border-slate-700 dark:text-slate-50">
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 className="mb-3 mt-6 text-[1.4rem] font-semibold tracking-[-0.02em] text-slate-900 first:mt-0 last:mb-0 dark:text-slate-50">
                {children}
              </h3>
            ),
            h4: ({ children }) => (
              <h4 className="mb-3 mt-5 text-[1.05rem] font-semibold text-slate-900 first:mt-0 last:mb-0 dark:text-slate-50">
                {children}
              </h4>
            ),
            p: ({ children }) => <p className="mb-4 text-[14px] leading-7 last:mb-0">{children}</p>,
            ul: ({ children }) => <ul className="mb-4 list-disc space-y-1.5 pl-6 marker:text-slate-400 last:mb-0">{children}</ul>,
            ol: ({ children }) => <ol className="mb-4 list-decimal space-y-1.5 pl-6 marker:text-slate-400 last:mb-0">{children}</ol>,
            li: ({ children }) => <li className="pl-1">{children}</li>,
            blockquote: ({ children }) => (
              <blockquote className="mb-4 border-l-2 border-slate-300 pl-4 italic text-slate-600 last:mb-0 dark:border-slate-600 dark:text-slate-300">
                {children}
              </blockquote>
            ),
            a: ({ href, children }) => (
              <a
                href={href}
                className="font-medium text-amber-700 underline underline-offset-2 hover:text-amber-800 dark:text-[var(--app-dark-accent)] dark:hover:text-[var(--app-dark-accent-hover)]"
                target={href?.startsWith('#') ? undefined : '_blank'}
                rel={href?.startsWith('#') ? undefined : 'noreferrer'}
              >
                {children}
              </a>
            ),
            img: ({ src, alt }) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src || ''}
                alt={alt || ''}
                className="my-4 max-w-full"
                loading="lazy"
              />
            ),
            table: ({ children }) => (
              <div className="mb-4 overflow-x-auto rounded-xl border border-slate-200 last:mb-0 dark:border-slate-700">
                <table className="min-w-full border-collapse text-left text-[13px] leading-6">{children}</table>
              </div>
            ),
            thead: ({ children }) => <thead className="bg-slate-50 text-slate-700 dark:bg-slate-900/60 dark:text-slate-200">{children}</thead>,
            th: ({ children }) => <th className="border-b border-slate-200 px-4 py-3 font-semibold dark:border-slate-700">{children}</th>,
            td: ({ children }) => <td className="border-b border-slate-200 px-4 py-3 align-top dark:border-slate-700">{children}</td>,
            hr: () => <hr className="my-6 border-slate-200 dark:border-slate-700" />,
            pre: ({ children }) => (
              <div className="mb-4 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-0 text-sm last:mb-0 app-dark-code">
                {children}
              </div>
            ),
            code: ({ className, children }) => {
              const textContent = String(children).replace(/\n$/, '');
              const language = /language-([\w-]+)/.exec(className || '')?.[1];
              const isBlock = Boolean(className) || textContent.includes('\n');

              if (isBlock) {
                return (
                  <SyntaxHighlighter
                    language={language}
                    style={syntaxTheme}
                    customStyle={{
                      margin: 0,
                      borderRadius: '0.75rem',
                      background: isDarkTheme ? '#201e1d' : '#f8fafc',
                      fontSize: '12px',
                      lineHeight: 1.65,
                      padding: '1rem',
                    }}
                  >
                    {textContent}
                  </SyntaxHighlighter>
                );
              }

              return (
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.9em] text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                  {textContent}
                </code>
              );
            },
          }}
        >
          {text}
        </ReactMarkdown>
      </div>
    </div>
  );
});

MarkdownFileContent.displayName = 'MarkdownFileContent';

const FileViewerPanel = memo(function FileViewerPanel({
  sessionId,
  filePath,
}: {
  sessionId: string;
  filePath: string;
}) {
  const { resolvedTheme } = useTheme();
  const normalizedPath = filePath.trim();
  const [state, setState] = useState<FileViewerState>(() => (
    normalizedPath ? { status: 'loading' } : { status: 'error', message: 'Open a file from the explorer to preview it here.' }
  ));
  const isDarkTheme = resolvedTheme === 'dark';
  const syntaxTheme = useMemo(() => (isDarkTheme ? atomOneDark : github), [isDarkTheme]);

  useEffect(() => {
    if (!normalizedPath) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const result = await readSessionCanvasFile(sessionId, normalizedPath);
      if (cancelled) return;

      if (!result.success) {
        setState({ status: 'error', message: result.error });
        return;
      }

      setState({
        status: 'ready',
        content: result.content,
        mode: result.mode,
        sizeBytes: result.sizeBytes,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [normalizedPath, sessionId]);

  if (!normalizedPath) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500 dark:text-slate-400">
        Open a file from the explorer to preview it here.
      </div>
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        <span className="loading loading-spinner loading-sm" />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500 dark:text-slate-400">
        {state.message}
      </div>
    );
  }

  if (state.mode === 'markdown') {
    return <MarkdownFileContent content={state.content} />;
  }

  return (
    <div className="h-full overflow-auto bg-slate-50 app-dark-root">
      <SyntaxHighlighter
        language={resolveFileLanguage(filePath)}
        style={syntaxTheme}
        customStyle={{
          margin: 0,
          minHeight: '100%',
          background: isDarkTheme ? '#201e1d' : '#f8fafc',
          fontSize: '12px',
          lineHeight: 1.65,
          padding: '1rem',
        }}
      >
        {state.content}
      </SyntaxHighlighter>
    </div>
  );
});

FileViewerPanel.displayName = 'FileViewerPanel';

function PreviewPanel({
  panel,
  isPageVisible,
  forceMount = false,
  onPanelChange,
}: {
  panel: SessionCanvasPreviewPanel;
  isPageVisible: boolean;
  forceMount?: boolean;
  onPanelChange: (updates: Partial<SessionCanvasPreviewPanel>) => void;
}) {
  const { containerRef, shouldMount } = usePanelIframeVisibility({
    enabled: isPageVisible,
    forceMount,
  });
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [inputUrl, setInputUrl] = useState(panel.payload.url || '');
  const [iframeEpoch, setIframeEpoch] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = useCallback(async (rawUrl: string) => {
    const normalized = normalizePreviewUrl(rawUrl);
    if (!normalized) {
      setError('Enter a valid http or https URL.');
      return;
    }

    setError(null);
    setInputUrl(normalized);
    setIframeEpoch((current) => current + 1);
    onPanelChange({
      title: buildPreviewPanelTitle(normalized),
      payload: {
        ...panel.payload,
        url: normalized,
      },
    });
  }, [onPanelChange, panel.payload]);

  useEffect(() => {
    const normalized = panel.payload.url?.trim() || '';
    setInputUrl((current) => (current === normalized ? current : normalized));

    if (!normalized) {
      setError(null);
      setIframeEpoch(0);
    }
  }, [panel.payload.url]);

  const postNavigationMessage = useCallback((action: 'back' | 'forward') => {
    const previewWindow = iframeRef.current?.contentWindow;
    if (!previewWindow) return;
    try {
      if (action === 'back') {
        previewWindow.history.back();
        return;
      }

      previewWindow.history.forward();
    } catch (navigationError) {
      console.error(`Failed to navigate preview ${action}:`, navigationError);
    }
  }, []);

  const handleReload = useCallback(() => {
    const nextUrl = panel.payload.url?.trim() || inputUrl.trim();
    if (!nextUrl) return;
    setIframeEpoch((current) => current + 1);
  }, [inputUrl, panel.payload.url]);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadPreview(inputUrl);
  }, [inputUrl, loadPreview]);

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col bg-white app-dark-root">
      <form
        className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2 app-dark-surface-raised"
        onSubmit={handleSubmit}
      >
        <button type="button" className="btn btn-ghost btn-xs btn-square" onClick={() => postNavigationMessage('back')}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button type="button" className="btn btn-ghost btn-xs btn-square" onClick={() => postNavigationMessage('forward')}>
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button type="button" className="btn btn-ghost btn-xs btn-square" onClick={handleReload}>
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <input
          type="text"
          className="input input-sm min-w-0 flex-1 border-slate-200 bg-slate-50 text-sm app-dark-input"
          placeholder="http://localhost:3000"
          value={inputUrl}
          onChange={(event) => setInputUrl(event.target.value)}
        />
        <button type="submit" className="btn btn-sm">
          Go
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-square"
          onClick={() => {
            const normalized = normalizePreviewUrl(inputUrl || panel.payload.url || '');
            if (!normalized) return;
            window.open(normalized, '_blank', 'noopener,noreferrer');
          }}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </form>

      {error ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-600 dark:text-red-300">
          {error}
        </div>
      ) : panel.payload.url && shouldMount ? (
        <iframe
          key={`${panel.payload.url}:${iframeEpoch}`}
          ref={iframeRef}
          src={panel.payload.url}
          className="h-full w-full border-0 bg-white app-dark-root"
          title={panel.title}
        />
      ) : panel.payload.url ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500 dark:text-slate-400">
          Preview is suspended while this panel is offscreen.
        </div>
      ) : (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500 dark:text-slate-400">
          Enter a preview URL to load a proxied iframe.
        </div>
      )}
    </div>
  );
}

function CommandPalette({
  query,
  loading,
  error,
  results,
  highlightedIndex,
  onQueryChange,
  onHighlight,
  onClose,
  onSelect,
}: {
  query: string;
  loading: boolean;
  error: string | null;
  results: SessionCanvasWorkspaceSearchResult[];
  highlightedIndex: number;
  onQueryChange: (value: string) => void;
  onHighlight: (index: number) => void;
  onClose: () => void;
  onSelect: (result: SessionCanvasWorkspaceSearchResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-slate-900/45 px-4 pb-8 pt-[12vh] backdrop-blur-sm app-dark-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white/95 shadow-2xl dark:border-slate-700 dark:bg-slate-950/95">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <Search className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search files by name or content..."
            className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
            spellCheck={false}
          />
          <button
            type="button"
            className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-500 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-900"
            onClick={onClose}
          >
            Esc
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-2 py-2">
          {query.trim().length < COMMAND_PALETTE_MIN_QUERY_LENGTH ? (
            <div className="px-3 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              Type at least {COMMAND_PALETTE_MIN_QUERY_LENGTH} characters to search the workspace.
            </div>
          ) : null}

          {query.trim().length >= COMMAND_PALETTE_MIN_QUERY_LENGTH && loading ? (
            <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-slate-500 dark:text-slate-400">
              <span className="loading loading-spinner loading-sm" />
              Searching workspace...
            </div>
          ) : null}

          {query.trim().length >= COMMAND_PALETTE_MIN_QUERY_LENGTH && !loading && error ? (
            <div className="px-3 py-8 text-center text-sm text-red-600 dark:text-red-300">
              {error}
            </div>
          ) : null}

          {query.trim().length >= COMMAND_PALETTE_MIN_QUERY_LENGTH && !loading && !error && results.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No workspace files matched &quot;{query.trim()}&quot;.
            </div>
          ) : null}

          {query.trim().length >= COMMAND_PALETTE_MIN_QUERY_LENGTH && !loading && !error ? (
            <div className="space-y-1">
              {results.map((result, index) => {
                const isHighlighted = index === highlightedIndex;
                return (
                  <button
                    key={result.path}
                    type="button"
                    className={`flex w-full flex-col rounded-2xl px-3 py-3 text-left transition ${
                      isHighlighted
                        ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-50'
                        : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900/80'
                    }`}
                    onMouseEnter={() => onHighlight(index)}
                    onClick={() => onSelect(result)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {renderHighlightedText(result.name, query)}
                      </span>
                      <span className="shrink-0 rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        {result.matchKinds.join(' + ')}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                      {renderHighlightedText(result.relativePath, query)}
                    </div>
                    {result.snippet ? (
                      <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
                        {renderHighlightedText(result.snippet, query)}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(function TerminalPanel({
  sessionId,
  panel,
  src,
  isDocumentDarkMode,
  isPageVisible,
  forceMount,
  terminalPersistenceMode,
  terminalServiceReady,
  terminalError,
  bootstrapCommand,
  shouldBootstrap,
  onBootstrapComplete,
  onOpenPreview,
  onRequireTerminalService,
}, ref) {
  const { containerRef, shouldMount } = usePanelIframeVisibility({
    enabled: isPageVisible,
    forceMount,
  });
  const { attachTerminalLinkHandler } = useTerminalLink({ onLoadPreview: onOpenPreview });
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const bootstrapStartedRef = useRef(false);
  const resetStartedRef = useRef(false);
  const themeApplyTimerRef = useRef<number | null>(null);
  const linkHandlerCleanupRef = useRef<(() => void) | null>(null);
  const linkHandlerTimerRef = useRef<number | null>(null);
  const touchScrollCleanupRef = useRef<(() => void) | null>(null);
  const touchScrollTimerRef = useRef<number | null>(null);
  const [iframeEpoch, setIframeEpoch] = useState(0);
  const [terminalReady, setTerminalReady] = useState(
    !shouldBootstrap || terminalPersistenceMode !== 'tmux',
  );
  const terminalTheme = useMemo(() => {
    return isDocumentDarkMode ? TERMINAL_THEME_DARK : TERMINAL_THEME_LIGHT;
  }, [isDocumentDarkMode]);

  useEffect(() => {
    if (!shouldMount || terminalServiceReady || terminalError) {
      return;
    }
    void onRequireTerminalService();
  }, [onRequireTerminalService, shouldMount, terminalError, terminalServiceReady]);

  const applyTerminalTheme = useCallback(function applyTerminalTheme(attempts = 0) {
    const applied = applyThemeToTerminalWindow(
      iframeRef.current?.contentWindow,
      terminalTheme,
    );

    if (applied || attempts >= 40) {
      themeApplyTimerRef.current = null;
      return;
    }

    themeApplyTimerRef.current = window.setTimeout(() => {
      applyTerminalTheme(attempts + 1);
    }, 200);
  }, [terminalTheme]);

  const attachTerminalLinks = useCallback(function attachTerminalLinks(attempts = 0) {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const runtime = getTerminalRuntime(iframe);
    if (runtime) {
      attachTerminalLinkHandler(iframe, linkHandlerCleanupRef, {
        directOpenBehavior: 'preview',
        modifierOpenBehavior: 'new_tab',
      });
      linkHandlerTimerRef.current = null;
      return;
    }

    if (attempts >= 40) {
      linkHandlerTimerRef.current = null;
      return;
    }

    linkHandlerTimerRef.current = window.setTimeout(() => {
      attachTerminalLinks(attempts + 1);
    }, 200);
  }, [attachTerminalLinkHandler]);

  const attachTerminalTouchScroll = useCallback(function attachTerminalTouchScroll(attempts = 0) {
    const runtime = getTerminalRuntime(iframeRef.current);
    if (runtime) {
      touchScrollCleanupRef.current?.();
      touchScrollCleanupRef.current = attachTerminalTouchScrollBridge(runtime);
      touchScrollTimerRef.current = null;
      return;
    }

    if (attempts >= 40) {
      touchScrollTimerRef.current = null;
      return;
    }

    touchScrollTimerRef.current = window.setTimeout(() => {
      attachTerminalTouchScroll(attempts + 1);
    }, 200);
  }, []);

  useEffect(() => {
    bootstrapStartedRef.current = false;
    resetStartedRef.current = false;
    setIframeEpoch(0);
    setTerminalReady(!shouldBootstrap || terminalPersistenceMode !== 'tmux');

    if (themeApplyTimerRef.current !== null) {
      window.clearTimeout(themeApplyTimerRef.current);
      themeApplyTimerRef.current = null;
    }

    if (linkHandlerTimerRef.current !== null) {
      window.clearTimeout(linkHandlerTimerRef.current);
      linkHandlerTimerRef.current = null;
    }
    linkHandlerCleanupRef.current?.();
    linkHandlerCleanupRef.current = null;

    if (touchScrollTimerRef.current !== null) {
      window.clearTimeout(touchScrollTimerRef.current);
      touchScrollTimerRef.current = null;
    }
    touchScrollCleanupRef.current?.();
    touchScrollCleanupRef.current = null;
  }, [panel.id, sessionId, shouldBootstrap, terminalPersistenceMode]);

  useEffect(() => () => {
    if (themeApplyTimerRef.current !== null) {
      window.clearTimeout(themeApplyTimerRef.current);
      themeApplyTimerRef.current = null;
    }

    if (linkHandlerTimerRef.current !== null) {
      window.clearTimeout(linkHandlerTimerRef.current);
      linkHandlerTimerRef.current = null;
    }
    linkHandlerCleanupRef.current?.();
    linkHandlerCleanupRef.current = null;

    if (touchScrollTimerRef.current !== null) {
      window.clearTimeout(touchScrollTimerRef.current);
      touchScrollTimerRef.current = null;
    }
    touchScrollCleanupRef.current?.();
    touchScrollCleanupRef.current = null;
  }, []);

  useEffect(() => {
    if (shouldMount) {
      return;
    }

    if (themeApplyTimerRef.current !== null) {
      window.clearTimeout(themeApplyTimerRef.current);
      themeApplyTimerRef.current = null;
    }
    if (linkHandlerTimerRef.current !== null) {
      window.clearTimeout(linkHandlerTimerRef.current);
      linkHandlerTimerRef.current = null;
    }
    if (touchScrollTimerRef.current !== null) {
      window.clearTimeout(touchScrollTimerRef.current);
      touchScrollTimerRef.current = null;
    }
    linkHandlerCleanupRef.current?.();
    linkHandlerCleanupRef.current = null;
    touchScrollCleanupRef.current?.();
    touchScrollCleanupRef.current = null;
  }, [shouldMount]);

  useImperativeHandle(ref, () => ({
    terminateSession() {
      const runtime = getTerminalRuntime(iframeRef.current);
      if (!runtime) {
        return false;
      }

      // Interrupt the foreground process before asking the shell to exit.
      const interrupted = sendTerminalDataEvent(runtime.term, '\u0003');
      const exited = sendTerminalDataEvent(runtime.term, 'exit\r');
      return interrupted || exited;
    },
  }), []);

  useEffect(() => {
    if (!shouldMount || !iframeRef.current) {
      return;
    }
    applyTerminalTheme();
  }, [applyTerminalTheme, iframeEpoch, shouldMount, terminalReady, terminalTheme]);

  useEffect(() => {
    if (!terminalServiceReady) {
      return;
    }

    if (!shouldBootstrap || terminalPersistenceMode !== 'tmux') {
      setTerminalReady(true);
      return;
    }

    if (resetStartedRef.current) {
      return;
    }

    resetStartedRef.current = true;
    setTerminalReady(false);

    let cancelled = false;

    void (async () => {
      try {
        await terminateTmuxSessionRole(sessionId, getSessionCanvasTerminalRole(panel));
      } catch (error) {
        console.error('Failed to reset canvas terminal tmux session:', error);
      }

      if (cancelled) return;

      setIframeEpoch((value) => value + 1);
      setTerminalReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [panel, sessionId, shouldBootstrap, terminalPersistenceMode, terminalServiceReady]);

  const handleLoad = useCallback(() => {
    applyTerminalTheme();
    attachTerminalLinks();
    attachTerminalTouchScroll();

    if (!terminalReady || !terminalServiceReady || !bootstrapCommand || !shouldBootstrap) {
      return;
    }
    if (bootstrapStartedRef.current) {
      return;
    }
    bootstrapStartedRef.current = true;

    let attempts = 0;
    const tick = () => {
      attempts += 1;
      const runtime = getTerminalRuntime(iframeRef.current);
      if (!runtime) {
        if (attempts < 30) {
          window.setTimeout(tick, 250);
        }
        return;
      }

      if (!isShellPromptReady(runtime.term)) {
        if (attempts < 40) {
          window.setTimeout(tick, 250);
        }
        return;
      }

      const submitted = submitTerminalBootstrapCommand(
        runtime.term,
        bootstrapCommand,
        () => sendTerminalEnter(runtime),
      );
      if (submitted) {
        onBootstrapComplete();
        return;
      }

      bootstrapStartedRef.current = false;
    };

    window.setTimeout(tick, 350);
  }, [applyTerminalTheme, attachTerminalLinks, attachTerminalTouchScroll, bootstrapCommand, onBootstrapComplete, shouldBootstrap, terminalReady, terminalServiceReady]);

  if (!shouldMount) {
    return (
      <div ref={containerRef} className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500 dark:text-slate-400">
        {isPageVisible ? 'Terminal is suspended while this panel is offscreen.' : 'Terminal is suspended while the page is hidden.'}
      </div>
    );
  }

  if (terminalError) {
    return (
      <div ref={containerRef} className="flex h-full items-center justify-center px-6 text-center text-sm text-red-600 dark:text-red-300">
        {terminalError}
      </div>
    );
  }

  if (!terminalServiceReady) {
    return (
      <div ref={containerRef} className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        Starting terminal service...
      </div>
    );
  }

  if (!terminalReady) {
    return (
      <div ref={containerRef} className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        Preparing terminal...
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full w-full">
      <iframe
        key={`${panel.id}:${iframeEpoch}`}
        ref={iframeRef}
        src={src}
        title={panel.title}
        className="h-full w-full border-0 bg-white"
        style={isDocumentDarkMode ? { backgroundColor: 'var(--app-dark-panel)' } : undefined}
        allow="clipboard-read; clipboard-write"
        onLoad={handleLoad}
      />
    </div>
  );
});

export function SessionCanvasWorkspace({
  sessionId,
  bootstrap,
}: SessionCanvasWorkspaceProps) {
  const { isPageVisible } = usePageVisibility();
  const isDocumentDarkMode = useDocumentDarkMode();
  const router = useRouter();
  const { confirm: confirmDialog, dialog } = useAppDialog();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const agentLocalFileInputRef = useRef<HTMLInputElement | null>(null);
  const agentFileTargetPanelIdRef = useRef<string | null>(null);
  const dragViewportRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const agentInputHandlesRef = useRef<Record<string, SessionCanvasAgentInputHandle | null>>({});
  const terminalPanelHandlesRef = useRef<Record<string, TerminalPanelHandle | null>>({});
  const [layout, setLayout] = useState<SessionCanvasLayout>(bootstrap.layout);
  const [activePanelId, setActivePanelId] = useState<string | null>(getDefaultSessionCanvasPanelId(bootstrap.layout.panels));
  const [agentHeaderMetaByPanelId, setAgentHeaderMetaByPanelId] = useState<Record<string, AgentSessionHeaderMeta>>({});
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [mobileExplorerCollapsed, setMobileExplorerCollapsed] = useState(true);
  const [terminalServiceReady, setTerminalServiceReady] = useState(false);
  const [terminalServiceError, setTerminalServiceError] = useState<string | null>(null);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [agentFileTargetPanelId, setAgentFileTargetPanelId] = useState<string | null>(null);
  const [isAgentFileBrowserOpen, setIsAgentFileBrowserOpen] = useState(false);
  const [isAgentFileInsertPending, setIsAgentFileInsertPending] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('');
  const [commandPaletteResults, setCommandPaletteResults] = useState<SessionCanvasWorkspaceSearchResult[]>([]);
  const [commandPaletteLoading, setCommandPaletteLoading] = useState(false);
  const [commandPaletteError, setCommandPaletteError] = useState<string | null>(null);
  const [commandPaletteHighlightedIndex, setCommandPaletteHighlightedIndex] = useState(0);
  const commandPaletteRequestIdRef = useRef(0);
  const terminalServiceStartingRef = useRef<Promise<void> | null>(null);
  const didHydrateLayoutRef = useRef(false);
  const didFitInitialLayoutRef = useRef(false);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  useEffect(() => {
    if (bootstrap.terminalPersistenceMode !== 'shell') {
      return;
    }

    if (!isWindowsPlatform(getShortcutPlatform())) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [bootstrap.terminalPersistenceMode]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(SESSION_MOBILE_VIEWPORT_QUERY);
    const updateMobileViewport = () => {
      setIsMobileViewport(mediaQuery.matches);
    };

    updateMobileViewport();
    mediaQuery.addEventListener('change', updateMobileViewport);

    return () => {
      mediaQuery.removeEventListener('change', updateMobileViewport);
    };
  }, []);

  useEffect(() => {
    if (!isMobileViewport) return;
    setMobileExplorerCollapsed(true);
  }, [isMobileViewport]);

  const closeCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen(false);
    setCommandPaletteQuery('');
    setCommandPaletteResults([]);
    setCommandPaletteLoading(false);
    setCommandPaletteError(null);
    setCommandPaletteHighlightedIndex(0);
    commandPaletteRequestIdRef.current += 1;
  }, []);

  const openCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen(true);
    setCommandPaletteLoading(false);
    setCommandPaletteError(null);
    setCommandPaletteHighlightedIndex(0);
  }, []);

  const toggleExplorer = useCallback(() => {
    if (isMobileViewport) {
      setMobileExplorerCollapsed((previous) => !previous);
      return;
    }

    setLayout((previous) => ({
      ...previous,
      explorer: {
        ...previous.explorer,
        collapsed: !previous.explorer.collapsed,
      },
    }));
  }, [isMobileViewport]);

  useEffect(() => {
    if (!isCommandPaletteOpen) {
      return;
    }

    const trimmedQuery = commandPaletteQuery.trim();
    if (trimmedQuery.length < COMMAND_PALETTE_MIN_QUERY_LENGTH) {
      setCommandPaletteResults([]);
      setCommandPaletteLoading(false);
      setCommandPaletteError(null);
      setCommandPaletteHighlightedIndex(0);
      commandPaletteRequestIdRef.current += 1;
      return;
    }

    const requestId = commandPaletteRequestIdRef.current + 1;
    commandPaletteRequestIdRef.current = requestId;
    setCommandPaletteLoading(true);
    setCommandPaletteError(null);

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        const result = await searchSessionCanvasWorkspace(sessionId, trimmedQuery);
        if (commandPaletteRequestIdRef.current !== requestId) {
          return;
        }

        if (!result.success) {
          setCommandPaletteResults([]);
          setCommandPaletteLoading(false);
          setCommandPaletteError(result.error);
          setCommandPaletteHighlightedIndex(0);
          return;
        }

        setCommandPaletteResults(result.results);
        setCommandPaletteLoading(false);
        setCommandPaletteError(null);
        setCommandPaletteHighlightedIndex(0);
      })();
    }, COMMAND_PALETTE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [commandPaletteQuery, isCommandPaletteOpen, sessionId]);

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcutPlatform = getShortcutPlatform();
      if (!isPrimaryShortcutModifierPressed(event, shortcutPlatform) || event.altKey || event.shiftKey) {
        return;
      }

      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openCommandPalette();
        return;
      }

      if (event.key.toLowerCase() === 'b' && !isEditableTarget(event.target)) {
        event.preventDefault();
        toggleExplorer();
        return;
      }

      if (event.key === '+' || event.key === '=' || event.key === '-' || event.key === '_' || event.key === '0') {
        event.preventDefault();
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener('wheel', handleWheel, { capture: true });
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [openCommandPalette, toggleExplorer]);

  useEffect(() => {
    setLayout(bootstrap.layout);
    setActivePanelId(getDefaultSessionCanvasPanelId(bootstrap.layout.panels));
    setMobileExplorerCollapsed(true);
    setAgentFileTargetPanelId(null);
    setIsAgentFileBrowserOpen(false);
    setIsAgentFileInsertPending(false);
    setIsCommandPaletteOpen(false);
    setCommandPaletteQuery('');
    setCommandPaletteResults([]);
    setCommandPaletteLoading(false);
    setCommandPaletteError(null);
    setCommandPaletteHighlightedIndex(0);
    setAgentHeaderMetaByPanelId({});
    commandPaletteRequestIdRef.current = 0;
    agentInputHandlesRef.current = {};
    didHydrateLayoutRef.current = false;
    didFitInitialLayoutRef.current = false;
  }, [bootstrap.layout, sessionId]);

  useEffect(() => {
    if (bootstrap.restoredFromSavedLayout || didFitInitialLayoutRef.current) {
      return;
    }

    const canvasElement = canvasRef.current;
    if (!canvasElement) return;

    const rect = canvasElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    didFitInitialLayoutRef.current = true;
    setLayout((previous) => {
      const fittedLayout = fitSessionCanvasLayoutToViewport(previous, rect.width, rect.height);

      return {
        ...fittedLayout,
        viewport: centerSessionCanvasViewportOnPanels(
          fittedLayout.panels,
          rect.width,
          rect.height,
          fittedLayout.viewport.scale,
        ),
      };
    });
  }, [bootstrap.restoredFromSavedLayout]);

  const ensureTerminalService = useCallback(async () => {
    if (terminalServiceReady) {
      return;
    }
    if (terminalServiceStartingRef.current) {
      await terminalServiceStartingRef.current;
      return;
    }

    terminalServiceStartingRef.current = (async () => {
      try {
        const result = await startTtydProcess();
        if (!result.success) {
          throw new Error(result.error || 'Failed to start terminal service');
        }
        setTerminalServiceReady(true);
        setTerminalServiceError(null);
      } catch (error) {
        console.error('Failed to start terminal service:', error);
        setTerminalServiceReady(false);
        setTerminalServiceError(error instanceof Error ? error.message : 'Failed to start terminal service');
      } finally {
        terminalServiceStartingRef.current = null;
      }
    })();

    await terminalServiceStartingRef.current;
  }, [terminalServiceReady]);

  useEffect(() => {
    if (!didHydrateLayoutRef.current) {
      didHydrateLayoutRef.current = true;
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void saveSessionCanvasLayout(sessionId, layout);
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [layout, sessionId]);

  useEffect(() => {
    const activePanelIds = new Set(layout.panels.map((panel) => panel.id));
    let shouldCloseAgentFileBrowser = false;
    for (const panelId of Object.keys(agentInputHandlesRef.current)) {
      if (!activePanelIds.has(panelId)) {
        delete agentInputHandlesRef.current[panelId];
      }
    }
    for (const panelId of Object.keys(terminalPanelHandlesRef.current)) {
      if (!activePanelIds.has(panelId)) {
        delete terminalPanelHandlesRef.current[panelId];
      }
    }
    setAgentHeaderMetaByPanelId((current) => {
      const nextEntries = Object.entries(current).filter(([panelId]) => activePanelIds.has(panelId));
      if (nextEntries.length === Object.keys(current).length) {
        return current;
      }
      return Object.fromEntries(nextEntries);
    });

    setAgentFileTargetPanelId((current) => {
      if (!current || activePanelIds.has(current)) {
        return current;
      }
      shouldCloseAgentFileBrowser = true;
      return null;
    });

    if (shouldCloseAgentFileBrowser) {
      setIsAgentFileBrowserOpen(false);
    }
  }, [layout.panels]);

  const focusPanel = useCallback((panelId: string) => {
    setActivePanelId(panelId);
    if (isMobileViewport) {
      return;
    }
    setLayout((previous) => focusPanelInLayout(previous, panelId));
  }, [isMobileViewport]);

  const updatePanelGeometry = useCallback((
    panelId: string,
    updates: Partial<Pick<SessionCanvasPanel, 'x' | 'y' | 'width' | 'height'>>,
  ) => {
    setLayout((previous) => {
      const nextLayout = updatePanelInLayout(previous, panelId, updates as Partial<SessionCanvasPanel>);
      const panel = previous.panels.find((item) => item.id === panelId);
      if (!panel || panel.type !== 'preview') {
        return nextLayout;
      }

      const nextWidth = typeof updates.width === 'number' && Number.isFinite(updates.width)
        ? updates.width
        : panel.width;
      const nextHeight = typeof updates.height === 'number' && Number.isFinite(updates.height)
        ? updates.height
        : panel.height;

      return {
        ...nextLayout,
        panelDefaults: {
          ...nextLayout.panelDefaults,
          preview: {
            width: nextWidth,
            height: nextHeight,
          },
        },
      };
    });
  }, []);

  const getMaximizedPanelBounds = useCallback((currentLayout: SessionCanvasLayout): PanelRestoreBounds | null => {
    const canvasElement = canvasRef.current;
    if (!canvasElement || isMobileViewport) {
      return null;
    }

    const rect = canvasElement.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return null;
    }

    const explorerOffset = currentLayout.explorer.collapsed
      ? 0
      : currentLayout.explorer.width || SESSION_CANVAS_DEFAULT_EXPLORER_WIDTH;
    const leftInsetPx = MAXIMIZED_PANEL_PADDING.left + explorerOffset;
    const topInsetPx = MAXIMIZED_PANEL_PADDING.top;
    const availableWidthPx = Math.max(320, rect.width - leftInsetPx - MAXIMIZED_PANEL_PADDING.right);
    const availableHeightPx = Math.max(220, rect.height - topInsetPx - MAXIMIZED_PANEL_PADDING.bottom);

    return {
      x: (leftInsetPx - currentLayout.viewport.x) / currentLayout.viewport.scale,
      y: (topInsetPx - currentLayout.viewport.y) / currentLayout.viewport.scale,
      width: availableWidthPx / currentLayout.viewport.scale,
      height: availableHeightPx / currentLayout.viewport.scale,
    };
  }, [isMobileViewport]);

  const maximizePanel = useCallback((panelId: string) => {
    setLayout((previous) => {
      const panel = previous.panels.find((item) => item.id === panelId);
      if (!panel || panel.state?.maximized) {
        return previous;
      }

      const nextBounds = getMaximizedPanelBounds(previous);
      if (!nextBounds) {
        return previous;
      }

      return updatePanelInLayout(
        focusPanelInLayout(previous, panelId),
        panelId,
        {
          x: nextBounds.x,
          y: nextBounds.y,
          width: nextBounds.width,
          height: nextBounds.height,
          state: {
            ...panel.state,
            maximized: true,
            minimized: false,
            restoreBounds: {
              x: panel.x,
              y: panel.y,
              width: panel.width,
              height: panel.height,
            },
          },
        } as Partial<SessionCanvasPanel>,
      );
    });
    setActivePanelId(panelId);
  }, [getMaximizedPanelBounds]);

  const restorePanel = useCallback((panelId: string) => {
    setLayout((previous) => {
      const panel = previous.panels.find((item) => item.id === panelId);
      if (!panel?.state?.maximized || !isValidRestoreBounds(panel.state.restoreBounds)) {
        return previous;
      }

      return updatePanelInLayout(
        focusPanelInLayout(previous, panelId),
        panelId,
        {
          x: panel.state.restoreBounds.x,
          y: panel.state.restoreBounds.y,
          width: panel.state.restoreBounds.width,
          height: panel.state.restoreBounds.height,
          state: {
            ...panel.state,
            maximized: false,
            minimized: false,
            restoreBounds: undefined,
          },
        } as Partial<SessionCanvasPanel>,
      );
    });
    setActivePanelId(panelId);
  }, []);

  const closePanel = useCallback((panelId: string) => {
    const closeResult = closeSessionCanvasPanel(layout, panelId, bootstrap.terminalPersistenceMode);
    const applyClose = () => {
      let nextActivePanelId = closeResult.nextActivePanelId;
      setLayout((previous) => {
        const nextCloseResult = closeSessionCanvasPanel(previous, panelId, bootstrap.terminalPersistenceMode);
        nextActivePanelId = nextCloseResult.nextActivePanelId;
        return nextCloseResult.layout;
      });
      setActivePanelId((current) => (current === panelId ? nextActivePanelId : current));
    };

    const shellShutdownRequested = closeResult.terminalShutdown?.requiresShellShutdown
      ? (terminalPanelHandlesRef.current[panelId]?.terminateSession() ?? false)
      : false;

    delete terminalPanelHandlesRef.current[panelId];

    if (shellShutdownRequested) {
      window.setTimeout(applyClose, 75);
    } else {
      applyClose();
    }

    if (closeResult.terminalShutdown && !closeResult.terminalShutdown.requiresShellShutdown) {
      void terminateTmuxSessionRole(sessionId, closeResult.terminalShutdown.role).catch((error) => {
        console.error('Failed to terminate terminal panel tmux session:', error);
      });
    }
  }, [bootstrap.terminalPersistenceMode, layout, sessionId]);

  const updatePanel = useCallback((panelId: string, updates: Partial<SessionCanvasPanel>) => {
    setLayout((previous) => updatePanelInLayout(previous, panelId, updates));
  }, []);

  const updateExplorerState = useCallback((updates: Partial<SessionCanvasLayout['explorer']>) => {
    setLayout((previous) => ({
      ...previous,
      explorer: {
        ...previous.explorer,
        ...updates,
      },
    }));
  }, []);

  const handleMobileExplorerStateChange = useCallback((updates: Partial<SessionCanvasLayout['explorer']>) => {
    if (typeof updates.collapsed === 'boolean') {
      setMobileExplorerCollapsed(updates.collapsed);
    }

    const persistedUpdates = { ...updates };
    delete persistedUpdates.collapsed;
    delete persistedUpdates.width;

    if (Object.keys(persistedUpdates).length === 0) {
      return;
    }

    updateExplorerState(persistedUpdates);
  }, [updateExplorerState]);

  const getCenteredPanelPosition = useCallback((width: number, height: number) => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) {
      return {
        x: 140,
        y: 120,
      };
    }

    const rect = canvasElement.getBoundingClientRect();
    const worldCenterX = (rect.width / 2 - layout.viewport.x) / layout.viewport.scale;
    const worldCenterY = (rect.height / 2 - layout.viewport.y) / layout.viewport.scale;

    return {
      x: worldCenterX - width / 2,
      y: worldCenterY - height / 2,
    };
  }, [layout.viewport.scale, layout.viewport.x, layout.viewport.y]);

  const getPreviewPanelSize = useCallback(() => {
    const lastPreviewPanel = [...layout.panels].reverse().find((panel) => panel.type === 'preview');
    if (lastPreviewPanel) {
      return {
        width: lastPreviewPanel.width,
        height: lastPreviewPanel.height,
      };
    }

    return {
      width: layout.panelDefaults?.preview?.width ?? 900,
      height: layout.panelDefaults?.preview?.height ?? 600,
    };
  }, [layout.panelDefaults?.preview?.height, layout.panelDefaults?.preview?.width, layout.panels]);

  const markStartupBootstrapComplete = useCallback(() => {
    setLayout((previous) => (
      previous.bootstrap.startupStarted
        && previous.bootstrap.startupLaunchVersion === SESSION_CANVAS_STARTUP_BOOTSTRAP_VERSION
        ? previous
        : {
            ...previous,
            bootstrap: {
              ...previous.bootstrap,
              startupStarted: true,
              startupLaunchVersion: SESSION_CANVAS_STARTUP_BOOTSTRAP_VERSION,
            },
          }
    ));
  }, []);

  const addPanel = useCallback((panel: SessionCanvasPanel) => {
    setLayout((previous) => ({
      ...previous,
      panels: [
        ...previous.panels,
        {
          ...panel,
          zIndex: nextPanelZIndex(previous.panels),
        },
      ],
    }));
    setActivePanelId(panel.id);
  }, []);

  const openFileViewer = useCallback((filePath: string) => {
    const normalizedPath = filePath.trim();
    if (!normalizedPath) return;

    setLayout((previous) => {
      const existingPanel = previous.panels.find((panel) => (
        panel.type === 'file-viewer' && panel.payload.filePath === normalizedPath
      )) as SessionCanvasFileViewerPanel | undefined;

      if (existingPanel) {
        setActivePanelId(existingPanel.id);
        if (isMobileViewport) {
          return previous;
        }
        return focusPanelInLayout(previous, existingPanel.id);
      }

      const panelSize = {
        width: 760,
        height: 560,
      };
      const position = getCenteredPanelPosition(panelSize.width, panelSize.height);
      const newPanel: SessionCanvasFileViewerPanel = {
        id: createSessionCanvasPanelId('file-viewer', normalizedPath),
        type: 'file-viewer',
        title: getBaseName(normalizedPath) || 'File Viewer',
        x: position.x,
        y: position.y,
        width: panelSize.width,
        height: panelSize.height,
        zIndex: nextPanelZIndex(previous.panels),
        payload: {
          filePath: normalizedPath,
        },
      };

      setActivePanelId(newPanel.id);
      return {
        ...previous,
        explorer: {
          ...previous.explorer,
          selectedPath: normalizedPath,
        },
        panels: [...previous.panels, newPanel],
      };
    });
    if (isMobileViewport) {
      setMobileExplorerCollapsed(true);
    }
  }, [getCenteredPanelPosition, isMobileViewport]);

  const handleSelectCommandPaletteResult = useCallback((result: SessionCanvasWorkspaceSearchResult) => {
    openFileViewer(result.path);
    closeCommandPalette();
  }, [closeCommandPalette, openFileViewer]);

  useEffect(() => {
    if (!isCommandPaletteOpen) {
      return;
    }

    const handlePaletteKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCommandPalette();
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setCommandPaletteHighlightedIndex((current) => (
          commandPaletteResults.length === 0 ? 0 : (current + 1) % commandPaletteResults.length
        ));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setCommandPaletteHighlightedIndex((current) => (
          commandPaletteResults.length === 0
            ? 0
            : (current - 1 + commandPaletteResults.length) % commandPaletteResults.length
        ));
        return;
      }

      if (
        event.key === 'Enter'
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
        && !event.shiftKey
        && commandPaletteResults[commandPaletteHighlightedIndex]
      ) {
        event.preventDefault();
        handleSelectCommandPaletteResult(commandPaletteResults[commandPaletteHighlightedIndex]!);
      }
    };

    window.addEventListener('keydown', handlePaletteKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handlePaletteKeyDown, { capture: true });
    };
  }, [
    closeCommandPalette,
    commandPaletteHighlightedIndex,
    commandPaletteResults,
    handleSelectCommandPaletteResult,
    isCommandPaletteOpen,
  ]);

  const registerAgentInputHandle = useCallback((panelId: string, handle: SessionCanvasAgentInputHandle | null) => {
    if (handle) {
      agentInputHandlesRef.current[panelId] = handle;
      return;
    }
    delete agentInputHandlesRef.current[panelId];
  }, []);

  const registerTerminalPanelHandle = useCallback((panelId: string, handle: TerminalPanelHandle | null) => {
    if (handle) {
      terminalPanelHandlesRef.current[panelId] = handle;
      return;
    }
    delete terminalPanelHandlesRef.current[panelId];
  }, []);

  const handleAgentHeaderMetaChange = useCallback((panelId: string, meta: AgentSessionHeaderMeta) => {
    setAgentHeaderMetaByPanelId((current) => {
      const previous = current[panelId];
      if (previous && JSON.stringify(previous) === JSON.stringify(meta)) {
        return current;
      }
      return {
        ...current,
        [panelId]: meta,
      };
    });
  }, []);

  const handleSetAgentReasoningEffort = useCallback((panelId: string, effort: string) => {
    const updated = agentInputHandlesRef.current[panelId]?.setReasoningEffort?.(effort) ?? false;
    if (!updated) {
      return;
    }
    focusPanel(panelId);
  }, [focusPanel]);

  const insertPathsIntoAgentPanel = useCallback(async (targetPanelId: string | null, paths: string[]) => {
    if (!targetPanelId) {
      setIsAgentFileBrowserOpen(false);
      return false;
    }

    const inserted = insertPathsIntoAgentInput(agentInputHandlesRef.current[targetPanelId], paths);
    if (!inserted) {
      await confirmDialog({
        title: 'Agent panel not ready',
        description: 'Wait for the agent panel to finish loading, then try Add Files again.',
        confirmLabel: 'OK',
        cancelLabel: 'Close',
      });
      return false;
    }

    setIsAgentFileBrowserOpen(false);
    return true;
  }, [confirmDialog]);

  const handleOpenAgentFileBrowser = useCallback((panelId: string) => {
    focusPanel(panelId);
    agentFileTargetPanelIdRef.current = panelId;
    setAgentFileTargetPanelId(panelId);

    const shouldUseNativePicker = typeof window !== 'undefined'
      && shouldUseDeviceFilePicker(window.location.hostname);
    if (shouldUseNativePicker) {
      setIsAgentFileBrowserOpen(false);
      agentLocalFileInputRef.current?.click();
      return;
    }

    setIsAgentFileBrowserOpen(true);
  }, [focusPanel]);

  const handleInsertFilesIntoAgent = useCallback(async (paths: string[]) => {
    if (isAgentFileInsertPending) {
      return;
    }
    setIsAgentFileInsertPending(true);
    try {
      await insertPathsIntoAgentPanel(agentFileTargetPanelId, paths);
    } finally {
      setIsAgentFileInsertPending(false);
    }
  }, [agentFileTargetPanelId, insertPathsIntoAgentPanel, isAgentFileInsertPending]);

  const handleAgentLocalFileSelection = useCallback(async (event: FormEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0 || isAgentFileInsertPending) {
      return;
    }

    const targetPanelId = agentFileTargetPanelIdRef.current;
    if (!targetPanelId) {
      return;
    }

    setIsAgentFileInsertPending(true);
    try {
      const formData = new FormData();
      files.forEach((file, index) => {
        const fileName = file.name.trim() || `attachment-${Date.now()}-${index + 1}`;
        formData.append(`attachment-${index}`, file, fileName);
      });

      const savedPaths = await uploadAttachments(bootstrap.workspaceRootPath, formData);
      if (savedPaths.length === 0) {
        throw new Error('Failed to upload selected files.');
      }

      await insertPathsIntoAgentPanel(targetPanelId, savedPaths);
    } catch (error) {
      const description = error instanceof Error ? error.message : 'Failed to upload selected files.';
      await confirmDialog({
        title: 'Failed to upload files',
        description,
        confirmLabel: 'OK',
        cancelLabel: 'Close',
      });
    } finally {
      setIsAgentFileInsertPending(false);
    }
  }, [
    bootstrap.workspaceRootPath,
    confirmDialog,
    insertPathsIntoAgentPanel,
    isAgentFileInsertPending,
  ]);

  const handleAddTerminal = useCallback(() => {
    const panelSize = {
      width: 720,
      height: 420,
    };
    const position = getCenteredPanelPosition(panelSize.width, panelSize.height);
    const id = createSessionCanvasPanelId('terminal');
    addPanel({
      id,
      type: 'terminal',
      title: 'Terminal',
      x: position.x,
      y: position.y,
      width: panelSize.width,
      height: panelSize.height,
      zIndex: 1,
      payload: {
        terminalKey: `terminal-${Date.now()}`,
        role: 'generic',
      },
    });
  }, [addPanel, getCenteredPanelPosition]);

  const handleAddPreview = useCallback(() => {
    const panelSize = getPreviewPanelSize();
    const position = getCenteredPanelPosition(panelSize.width, panelSize.height);
    addPanel({
      id: createSessionCanvasPanelId('preview'),
      type: 'preview',
      title: 'Preview',
      x: position.x,
      y: position.y,
      width: panelSize.width,
      height: panelSize.height,
      zIndex: 1,
      payload: {
        url: '',
      },
    });
  }, [addPanel, getCenteredPanelPosition, getPreviewPanelSize]);

  const handleOpenPreviewUrl = useCallback(async (rawUrl: string, openPreview: boolean) => {
    const normalized = normalizePreviewUrl(rawUrl);
    if (!normalized) return false;

    if (!openPreview) {
      window.open(normalized, '_blank', 'noopener,noreferrer');
      return true;
    }

    const panelSize = getPreviewPanelSize();
    const position = getCenteredPanelPosition(panelSize.width, panelSize.height);
    addPanel({
      id: createSessionCanvasPanelId('preview'),
      type: 'preview',
      title: buildPreviewPanelTitle(normalized),
      x: position.x,
      y: position.y,
      width: panelSize.width,
      height: panelSize.height,
      zIndex: 1,
      payload: {
        url: normalized,
      },
    });
    return true;
  }, [addPanel, getCenteredPanelPosition, getPreviewPanelSize]);

  const handleAddGitPanel = useCallback(() => {
    const panelSize = {
      width: SESSION_CANVAS_DEFAULT_GIT_PANEL_WIDTH,
      height: SESSION_CANVAS_DEFAULT_GIT_PANEL_HEIGHT,
    };
    const position = getCenteredPanelPosition(panelSize.width, panelSize.height);
    addPanel({
      id: createSessionCanvasPanelId('git-session'),
      type: 'git-session',
      title: 'Git Session',
      x: position.x,
      y: position.y,
      width: panelSize.width,
      height: panelSize.height,
      zIndex: 1,
      payload: {
        repoPath: bootstrap.metadata.activeRepoPath || bootstrap.metadata.gitRepos[0]?.sourceRepoPath || null,
      },
    });
  }, [
    addPanel,
    bootstrap.metadata.activeRepoPath,
    bootstrap.metadata.gitRepos,
    getCenteredPanelPosition,
  ]);

  const handleReturnHome = useCallback(() => {
    router.push('/');
  }, [router]);

  const handleDeleteCurrentSession = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: `Delete session "${sessionId}"?`,
      description: 'This will remove the worktree, branch, and session metadata.',
      confirmLabel: 'Delete session',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    setIsDeletingSession(true);

    try {
      const result = await deleteSessionInBackground(sessionId);
      if (!result.success) {
        window.alert(result.error || 'Failed to delete session.');
        return;
      }

      router.replace('/');
    } catch (error) {
      console.error('Failed to delete session:', error);
      window.alert('Failed to delete session.');
    } finally {
      setIsDeletingSession(false);
    }
  }, [confirmDialog, router, sessionId]);

  const handleFitPanels = useCallback(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;

    const rect = canvasElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    setLayout((previous) => ({
      ...previous,
      viewport: fitSessionCanvasViewportToPanels(
        previous.panels,
        rect.width,
        rect.height,
        CANVAS_FIT_PADDING,
      ),
    }));
  }, []);

  const handleCanvasWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!canvasRef.current) return;

    event.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const deltaUnit = event.deltaMode === 1
      ? CANVAS_WHEEL_LINE_PIXELS
      : (event.deltaMode === 2 ? CANVAS_WHEEL_PAGE_PIXELS : 1);
    const scaledDeltaY = event.deltaY * deltaUnit;

    setLayout((previous) => {
      const zoomFactor = Math.exp(-scaledDeltaY * CANVAS_ZOOM_SENSITIVITY);
      const nextScale = clampSessionCanvasScale(previous.viewport.scale * zoomFactor);
      if (nextScale === previous.viewport.scale) {
        return previous;
      }

      const worldX = (pointerX - previous.viewport.x) / previous.viewport.scale;
      const worldY = (pointerY - previous.viewport.y) / previous.viewport.scale;

      return {
        ...previous,
        viewport: {
          x: pointerX - worldX * nextScale,
          y: pointerY - worldY * nextScale,
          scale: nextScale,
        },
      };
    });
  }, []);

  const beginViewportDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('[data-session-canvas-panel="true"]')) return;

    event.preventDefault();

    dragViewportRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: layout.viewport.x,
      startY: layout.viewport.y,
    };

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      const dragState = dragViewportRef.current;
      if (!dragState || dragState.pointerId !== pointerEvent.pointerId) return;

      setLayout((previous) => ({
        ...previous,
        viewport: {
          ...previous.viewport,
          x: dragState.startX + (pointerEvent.clientX - dragState.startClientX),
          y: dragState.startY + (pointerEvent.clientY - dragState.startClientY),
        },
      }));
    };

    const handlePointerUp = (pointerEvent: PointerEvent) => {
      const dragState = dragViewportRef.current;
      if (!dragState || dragState.pointerId !== pointerEvent.pointerId) return;
      dragViewportRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  }, [layout.viewport.x, layout.viewport.y]);

  const scaledGridSize = CANVAS_GRID_SIZE * layout.viewport.scale;
  const backgroundPositionX = ((layout.viewport.x % scaledGridSize) + scaledGridSize) % scaledGridSize;
  const backgroundPositionY = ((layout.viewport.y % scaledGridSize) + scaledGridSize) % scaledGridSize;

  const renderPanel = useCallback((panel: SessionCanvasPanel) => {
    if (panel.type === 'agent-terminal') {
      return (
        <AgentSessionPane
          ref={(handle) => registerAgentInputHandle(panel.id, handle)}
          sessionId={sessionId}
          workspacePath={bootstrap.workspaceRootPath}
          initialSnapshot={bootstrap.initialAgentSnapshot}
          autoStartMessage={shouldAutoStartSessionCanvasAgentTurn({
            initialized: bootstrap.metadata.initialized,
            initialPrompt: bootstrap.initialAgentPrompt,
            runState: bootstrap.metadata.runState ?? null,
          }) ? bootstrap.initialAgentPrompt : null}
          onHeaderMetaChange={(meta) => handleAgentHeaderMetaChange(panel.id, meta)}
          onRequestAddFiles={() => handleOpenAgentFileBrowser(panel.id)}
          isAddingFiles={isAgentFileInsertPending && agentFileTargetPanelId === panel.id}
          isMobileViewport={isMobileViewport}
        />
      );
    }

    if (panel.type === 'terminal') {
      const terminalPanel = panel as SessionCanvasTerminalPanel;
      const forceMount = panel.state?.maximized === true;
      const src = buildSessionCanvasTerminalSrc({
        sessionName: sessionId,
        panel: terminalPanel,
        terminalEnvironments: bootstrap.terminalEnvironments,
        persistenceMode: bootstrap.terminalPersistenceMode,
        shellKind: bootstrap.terminalShellKind,
        workspaceRootPath: bootstrap.workspaceRootPath,
      });
      const panelBootstrapCommand = terminalPanel.payload.role === 'startup'
        ? bootstrap.initialCommands.startupCommand
        : null;
      const bootstrapCommand = buildSessionCanvasTerminalBootstrapCommand({
        src,
        persistenceMode: bootstrap.terminalPersistenceMode,
        shellKind: bootstrap.terminalShellKind,
        panelBootstrapCommand,
      });
      const shouldBootstrap = shouldBootstrapSessionCanvasTerminalPanel({
        panel: terminalPanel,
        persistenceMode: bootstrap.terminalPersistenceMode,
        bootstrapCommand,
        startupLaunchVersion: layout.bootstrap.startupLaunchVersion,
      });

      return (
        <TerminalPanel
          ref={(handle) => registerTerminalPanelHandle(panel.id, handle)}
          sessionId={sessionId}
          panel={panel}
          src={src}
          isDocumentDarkMode={isDocumentDarkMode}
          isPageVisible={isPageVisible}
          forceMount={forceMount}
          terminalPersistenceMode={bootstrap.terminalPersistenceMode}
          terminalServiceReady={terminalServiceReady}
          terminalError={terminalServiceError}
          bootstrapCommand={bootstrapCommand}
          shouldBootstrap={shouldBootstrap}
          onBootstrapComplete={
            terminalPanel.payload.role === 'startup'
              ? markStartupBootstrapComplete
              : () => {}
          }
          onOpenPreview={handleOpenPreviewUrl}
          onRequireTerminalService={ensureTerminalService}
        />
      );
    }

    if (panel.type === 'file-viewer') {
      return (
        <FileViewerPanel
          sessionId={sessionId}
          filePath={panel.payload.filePath}
        />
      );
    }

    if (panel.type === 'preview') {
      return (
        <PreviewPanel
          panel={panel}
          isPageVisible={isPageVisible}
          forceMount={panel.state?.maximized === true}
          onPanelChange={(updates) => updatePanel(panel.id, updates)}
        />
      );
    }

    return (
      <SessionCanvasGitPanel
        sessionId={sessionId}
        gitRepos={bootstrap.metadata.gitRepos}
        selectedSourceRepoPath={panel.payload.repoPath ?? undefined}
        onSelectedSourceRepoPathChange={(repoPath) => {
          updatePanel(panel.id, {
            payload: {
              ...panel.payload,
              repoPath,
            },
          });
        }}
      />
    );
  }, [
    bootstrap.initialCommands.startupCommand,
    bootstrap.metadata.gitRepos,
    bootstrap.terminalEnvironments,
    bootstrap.terminalPersistenceMode,
    bootstrap.terminalShellKind,
    bootstrap.workspaceRootPath,
    layout.bootstrap.startupLaunchVersion,
    markStartupBootstrapComplete,
    registerAgentInputHandle,
    handleOpenPreviewUrl,
    ensureTerminalService,
    sessionId,
    isDocumentDarkMode,
    isPageVisible,
    terminalServiceError,
    terminalServiceReady,
    updatePanel,
    handleOpenAgentFileBrowser,
    isAgentFileInsertPending,
    agentFileTargetPanelId,
    isMobileViewport,
    registerTerminalPanelHandle,
  ]);

  const explorerState = {
    collapsed: isMobileViewport ? mobileExplorerCollapsed : layout.explorer.collapsed,
    width: layout.explorer.width || SESSION_CANVAS_DEFAULT_EXPLORER_WIDTH,
    expandedPaths: layout.explorer.expandedPaths,
    selectedPath: layout.explorer.selectedPath,
  };
  const sessionProjectLabel = bootstrap.repoDisplayName
    || getBaseName(bootstrap.metadata.projectPath)
    || 'Project';
  const sessionWorkspaceLabel = sessionWorkspacePreferenceLabel(bootstrap.metadata.workspaceMode);
  const mobilePanels = useMemo(() => (
    [...layout.panels].sort((a, b) => (
      a.y - b.y
      || a.x - b.x
      || a.zIndex - b.zIndex
    ))
  ), [layout.panels]);
  const desktopToolbarButtonClass = 'btn btn-ghost btn-xs h-6 min-h-6 gap-1 px-2 text-[11px]';
  const mobileToolbarButtonClass = 'btn btn-ghost btn-sm btn-square h-10 min-h-10 w-10 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-50';
  const toolbarIconButtonClass = 'btn btn-ghost btn-xs btn-square h-6 min-h-6 w-6 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-50';
  const deleteButtonClass = isMobileViewport
    ? 'btn btn-ghost btn-sm btn-square h-10 min-h-10 w-10 text-slate-600 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300 dark:hover:bg-red-950/40 dark:hover:text-red-300'
    : 'btn btn-ghost btn-xs btn-square h-6 min-h-6 w-6 text-slate-600 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300 dark:hover:bg-red-950/40 dark:hover:text-red-300';
  const panelHeaderButtonClass = 'btn btn-ghost btn-xs h-6 min-h-6 gap-1 px-2 text-[11px] text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100';
  const agentFileBrowserInitialPath = useMemo(() => resolveBrowserInitialPath({
    selectedPath: layout.explorer.selectedPath,
    expandedPaths: layout.explorer.expandedPaths,
    rootPaths: bootstrap.explorerRoots.map((root) => root.path),
    fallbackPath: bootstrap.workspaceRootPath,
  }), [
    bootstrap.explorerRoots,
    bootstrap.workspaceRootPath,
    layout.explorer.expandedPaths,
    layout.explorer.selectedPath,
  ]);
  const renderPanelHeaderActions = useCallback((panel: SessionCanvasPanel) => {
    if (panel.type === 'agent-terminal') {
      const headerMeta = agentHeaderMetaByPanelId[panel.id];
      return (
        <div className="flex items-center gap-2" data-panel-interactive="true">
          {headerMeta?.reasoningEffortOptions?.length ? (
            <>
              <div className="relative" data-panel-interactive="true">
                <select
                  className="h-7 appearance-none rounded-md border border-slate-300 bg-white pl-2 pr-10 text-[11px] font-medium text-slate-700 shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 app-dark-input"
                  value={headerMeta.effectiveReasoningEffort || headerMeta.reasoningEffort || ''}
                  onChange={(event) => {
                    event.stopPropagation();
                    handleSetAgentReasoningEffort(panel.id, event.target.value);
                  }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                  }}
                  aria-label="Reasoning effort"
                  data-panel-interactive="true"
                >
                  {headerMeta.reasoningEffortOptions.map((effort) => (
                    <option key={effort} value={effort}>
                      {effort}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 dark:text-slate-400"
                  aria-hidden="true"
                />
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400" data-panel-interactive="true">
                {headerMeta.hasPendingReasoningChange
                  ? `Next: ${headerMeta.effectiveReasoningEffort} · Current: ${headerMeta.reasoningEffort || 'n/a'}`
                  : `Current: ${headerMeta.effectiveReasoningEffort || headerMeta.reasoningEffort || 'n/a'}`}
              </span>
            </>
          ) : null}
          <button
            type="button"
            className={panelHeaderButtonClass}
            onClick={(event) => {
              event.stopPropagation();
              handleOpenAgentFileBrowser(panel.id);
            }}
            disabled={isAgentFileInsertPending}
            title="Browse files and insert absolute paths into the agent input"
            aria-label="Add files"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span>Add Files</span>
          </button>
        </div>
      );
    }

    return null;
  }, [agentHeaderMetaByPanelId, handleOpenAgentFileBrowser, handleSetAgentReasoningEffort, isAgentFileInsertPending, panelHeaderButtonClass]);

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#f7f7f6] text-slate-900 app-dark-root">
      <input
        ref={agentLocalFileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleAgentLocalFileSelection}
      />
      {isMobileViewport ? (
        <div className="relative z-0 flex h-full flex-col">
          <div className="shrink-0 px-4 pb-2 pt-4">
            <div className="flex items-center justify-between rounded-[1.75rem] border border-white/70 bg-white/80 px-3 py-2 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-950/85">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <button
                  type="button"
                  className={mobileToolbarButtonClass}
                  onClick={handleReturnHome}
                  aria-label="Back to home"
                  title="Back to home"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50/90 px-3 py-1.5 dark:border-slate-700 dark:bg-slate-900/90">
                  <div className="truncate text-[11px] font-semibold text-slate-700 dark:text-slate-100">
                    {sessionProjectLabel}
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                    {sessionWorkspaceLabel}
                  </div>
                </div>
              </div>
              <div className="ml-2 flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  className={mobileToolbarButtonClass}
                  onClick={handleAddTerminal}
                  aria-label="Add terminal"
                  title="Add terminal"
                >
                  <TerminalSquare className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className={mobileToolbarButtonClass}
                  onClick={handleAddGitPanel}
                  disabled={bootstrap.metadata.gitRepos.length === 0}
                  aria-label="Add git panel"
                  title="Add git panel"
                >
                  <GitBranch className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className={deleteButtonClass}
                  onClick={() => { void handleDeleteCurrentSession(); }}
                  disabled={isDeletingSession}
                  aria-label="Delete session"
                  title="Delete session"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <div
            className="min-h-0 flex-1 overflow-y-auto px-4 pb-6"
            style={{
              backgroundImage: 'radial-gradient(circle, rgba(148,163,184,0.35) 1px, transparent 1px)',
              backgroundSize: '28px 28px',
            }}
          >
            {!mobileExplorerCollapsed ? (
              <div className="mb-4" style={{ height: MOBILE_STACKED_PANEL_HEIGHT }}>
                <SessionExplorerDock
                  sessionId={sessionId}
                  roots={bootstrap.explorerRoots}
                  state={explorerState}
                  mobile={true}
                  onStateChange={handleMobileExplorerStateChange}
                  onOpenFile={openFileViewer}
                />
              </div>
            ) : null}

            {mobilePanels.map((panel) => (
              <div key={panel.id} className="mb-4" style={{ height: MOBILE_STACKED_PANEL_HEIGHT }}>
                <CanvasPanelFrame
                  panel={panel}
                  scale={1}
                  interactionMode="stacked"
                  active={activePanelId === panel.id}
                  closable={panel.type !== 'agent-terminal'}
                  onFocus={focusPanel}
                  onUpdate={updatePanelGeometry}
                  onClose={closePanel}
                  onMaximize={maximizePanel}
                  onRestore={restorePanel}
                  headerActions={renderPanelHeaderActions(panel)}
                >
                  {renderPanel(panel)}
                </CanvasPanelFrame>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="absolute inset-y-0 left-0 z-40">
            <SessionExplorerDock
              sessionId={sessionId}
              roots={bootstrap.explorerRoots}
              state={explorerState}
              onStateChange={updateExplorerState}
              onOpenFile={openFileViewer}
            />
          </div>

          <div className="relative z-0 h-full w-full">
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center p-4">
              <div className="pointer-events-auto flex max-w-[calc(100%-2rem)] flex-wrap items-center justify-center gap-1.5 rounded-xl border border-white/70 bg-white/80 px-2.5 py-1.5 text-[11px] shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-950/85">
                <button
                  type="button"
                  className={toolbarIconButtonClass}
                  onClick={handleReturnHome}
                  aria-label="Back to home"
                  title="Back to home"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
                <div className="flex max-w-[240px] shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 dark:border-slate-700 dark:bg-slate-900">
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-semibold text-slate-700 dark:text-slate-100">
                      {sessionProjectLabel}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
                    {sessionWorkspaceLabel}
                  </span>
                </div>
                <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />
                <button type="button" className={desktopToolbarButtonClass} onClick={openCommandPalette}>
                  <Search className="h-3.5 w-3.5" />
                  Search
                </button>
                <button type="button" className={desktopToolbarButtonClass} onClick={handleAddTerminal}>
                  <TerminalSquare className="h-3.5 w-3.5" />
                  Terminal
                </button>
                <button type="button" className={desktopToolbarButtonClass} onClick={handleAddPreview}>
                  <Monitor className="h-3.5 w-3.5" />
                  Preview
                </button>
                <button
                  type="button"
                  className={desktopToolbarButtonClass}
                  onClick={handleAddGitPanel}
                  disabled={bootstrap.metadata.gitRepos.length === 0}
                >
                  <GitBranch className="h-3.5 w-3.5" />
                  Git
                </button>
                <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />
                <button
                  type="button"
                  className={desktopToolbarButtonClass}
                  onClick={toggleExplorer}
                >
                  <PanelLeft className="h-3.5 w-3.5" />
                  Explorer
                </button>
                <button
                  type="button"
                  className={desktopToolbarButtonClass}
                  onClick={handleFitPanels}
                >
                  <ScanSearch className="h-3.5 w-3.5" />
                  Fit
                </button>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  {Math.round(layout.viewport.scale * 100)}%
                </div>
                <button
                  type="button"
                  className={deleteButtonClass}
                  onClick={() => { void handleDeleteCurrentSession(); }}
                  disabled={isDeletingSession}
                  aria-label="Delete session"
                  title="Delete session"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div
              ref={canvasRef}
              className="h-full w-full overflow-hidden"
              onWheel={handleCanvasWheel}
              onPointerDown={beginViewportDrag}
              onDoubleClick={(event) => {
                if (!(event.target instanceof Element)) return;
                if (event.target.closest('[data-session-canvas-panel="true"]')) return;
                handleFitPanels();
              }}
              style={{
                backgroundImage: 'radial-gradient(circle, rgba(148,163,184,0.35) 1px, transparent 1px)',
                backgroundSize: `${scaledGridSize}px ${scaledGridSize}px`,
                backgroundPosition: `${backgroundPositionX}px ${backgroundPositionY}px`,
              }}
            >
              <div
                className="absolute inset-0"
                style={{
                  transform: `translate(${layout.viewport.x}px, ${layout.viewport.y}px) scale(${layout.viewport.scale})`,
                  transformOrigin: '0 0',
                }}
              >
                {layout.panels.map((panel) => (
                  <CanvasPanelFrame
                    key={panel.id}
                    panel={panel}
                    scale={layout.viewport.scale}
                    active={activePanelId === panel.id}
                    closable={panel.type !== 'agent-terminal'}
                    onFocus={focusPanel}
                    onUpdate={updatePanelGeometry}
                    onClose={closePanel}
                    onMaximize={maximizePanel}
                    onRestore={restorePanel}
                    headerActions={renderPanelHeaderActions(panel)}
                  >
                    {renderPanel(panel)}
                  </CanvasPanelFrame>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
      {isAgentFileBrowserOpen ? (
        <SessionFileBrowser
          initialPath={agentFileBrowserInitialPath}
          onConfirm={handleInsertFilesIntoAgent}
          onCancel={() => {
            if (isAgentFileInsertPending) return;
            setIsAgentFileBrowserOpen(false);
          }}
          confirmLabel={isAgentFileInsertPending ? 'Inserting...' : 'Insert'}
          zIndexClassName="z-[100]"
        />
      ) : null}
      {isCommandPaletteOpen ? (
        <CommandPalette
          query={commandPaletteQuery}
          loading={commandPaletteLoading}
          error={commandPaletteError}
          results={commandPaletteResults}
          highlightedIndex={commandPaletteHighlightedIndex}
          onQueryChange={setCommandPaletteQuery}
          onHighlight={setCommandPaletteHighlightedIndex}
          onClose={closeCommandPalette}
          onSelect={handleSelectCommandPaletteResult}
        />
      ) : null}
      {dialog}
    </div>
  );
}
