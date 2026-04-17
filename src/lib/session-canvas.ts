import type {
  SessionCanvasLayout,
  SessionCanvasPanel,
  SessionCanvasTerminalPanel,
  SessionCanvasPanelType,
  SessionCanvasAgentTerminalPanel,
  SessionCanvasViewport,
} from '@/lib/types';
import { joinShellStatements } from './shell.ts';
import {
  buildShellModeTerminalBootstrapCommand,
  buildTtydTerminalSrc,
  type TerminalPersistenceMode,
  type TerminalSessionEnvironment,
  type TerminalShellKind,
} from './terminal-session.ts';

export const SESSION_CANVAS_LAYOUT_VERSION = 2;
export const SESSION_CANVAS_MIN_SCALE = 0.35;
export const SESSION_CANVAS_MAX_SCALE = 2.5;
export const SESSION_CANVAS_DEFAULT_SCALE = 0.85;
export const SESSION_CANVAS_DEFAULT_EXPLORER_WIDTH = 280;
export const SESSION_CANVAS_AGENT_BOOTSTRAP_VERSION = 1;
export const SESSION_CANVAS_STARTUP_BOOTSTRAP_VERSION = 1;
const SESSION_CANVAS_DEFAULT_TERMINAL_GROUP_X = 120;
const SESSION_CANVAS_DEFAULT_TERMINAL_GROUP_Y = 96;
const SESSION_CANVAS_DEFAULT_TERMINAL_GAP = 36;
const SESSION_CANVAS_DEFAULT_AGENT_TERMINAL_WIDTH = 1000;
const SESSION_CANVAS_DEFAULT_AGENT_TERMINAL_HEIGHT = 1200;
export const SESSION_CANVAS_DEFAULT_GIT_PANEL_WIDTH = 1200;
export const SESSION_CANVAS_DEFAULT_GIT_PANEL_HEIGHT = 1000;
const SESSION_CANVAS_EDGE_MARGIN = 24;
const SESSION_CANVAS_TOP_MARGIN = 84;
const SESSION_CANVAS_MIN_PANEL_WIDTH = 320;
const SESSION_CANVAS_MIN_PANEL_HEIGHT = 220;
const SESSION_CANVAS_DEFAULT_PREVIEW_WIDTH = 900;
const SESSION_CANVAS_DEFAULT_PREVIEW_HEIGHT = 600;
const SESSION_CANVAS_DEFAULT_STARTUP_TERMINAL_HEIGHT = 420;

type CreateDefaultSessionCanvasLayoutOptions = {
  workspacePath: string;
  activeRepoPath?: string;
  startupScript?: string | null;
};

type SessionCanvasPanelDraft = Omit<SessionCanvasPanel, 'id' | 'zIndex'> & {
  id?: string;
  zIndex?: number;
};

export type SessionCanvasPanelCloseResult = {
  layout: SessionCanvasLayout;
  nextActivePanelId: string | null;
  terminalShutdown:
    | {
        role: string;
        requiresShellShutdown: boolean;
      }
    | null;
};

export function clampSessionCanvasScale(value: number): number {
  if (!Number.isFinite(value)) return SESSION_CANVAS_DEFAULT_SCALE;
  return Math.max(SESSION_CANVAS_MIN_SCALE, Math.min(SESSION_CANVAS_MAX_SCALE, value));
}

export function createSessionCanvasPanelId(
  type: SessionCanvasPanelType,
  suffix = '',
): string {
  const normalizedSuffix = suffix.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
  return normalizedSuffix ? `${type}:${normalizedSuffix}` : `${type}:${Date.now()}`;
}

function normalizePanelNumber(value: number, fallback: number, min: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.round(value));
}

function withPanelDefaults(
  panel: SessionCanvasPanelDraft,
  index: number,
): SessionCanvasPanel {
  const normalizedTitle = panel.title?.trim() || panel.type;
  const title = panel.type === 'agent-terminal' && normalizedTitle === 'Agent (Classic Only)'
    ? 'Coding Agent'
    : normalizedTitle;

  return {
    ...panel,
    id: panel.id?.trim() || createSessionCanvasPanelId(panel.type, String(index + 1)),
    title,
    x: normalizePanelNumber(panel.x, 80 + (index * 24), -20_000),
    y: normalizePanelNumber(panel.y, 80 + (index * 24), -20_000),
    width: normalizePanelNumber(panel.width, 640, 220),
    height: normalizePanelNumber(panel.height, 420, 160),
    zIndex: typeof panel.zIndex === 'number' && Number.isFinite(panel.zIndex)
      ? Math.max(1, Math.round(panel.zIndex))
      : (index + 1),
    state: panel.state ?? {},
  } as SessionCanvasPanel;
}

export function createDefaultSessionCanvasLayout({
  workspacePath,
  activeRepoPath: _activeRepoPath,
  startupScript,
}: CreateDefaultSessionCanvasLayoutOptions): SessionCanvasLayout {
  const startupTerminalX = SESSION_CANVAS_DEFAULT_TERMINAL_GROUP_X
    + SESSION_CANVAS_DEFAULT_AGENT_TERMINAL_WIDTH
    + SESSION_CANVAS_DEFAULT_TERMINAL_GAP;
  const normalizedStartupScript = startupScript?.trim() || '';
  const drafts: SessionCanvasPanelDraft[] = [
    {
      type: 'agent-terminal',
      title: 'Coding Agent',
      x: SESSION_CANVAS_DEFAULT_TERMINAL_GROUP_X,
      y: SESSION_CANVAS_DEFAULT_TERMINAL_GROUP_Y,
      width: SESSION_CANVAS_DEFAULT_AGENT_TERMINAL_WIDTH,
      height: SESSION_CANVAS_DEFAULT_AGENT_TERMINAL_HEIGHT,
      payload: {
        terminalKey: 'agent',
      },
    },
  ];

  if (normalizedStartupScript) {
    drafts.push({
      type: 'terminal',
      title: 'Startup Terminal',
      x: startupTerminalX,
      y: SESSION_CANVAS_DEFAULT_TERMINAL_GROUP_Y,
      width: 760,
      height: SESSION_CANVAS_DEFAULT_STARTUP_TERMINAL_HEIGHT,
      payload: {
        terminalKey: 'terminal',
        role: 'startup',
      },
    });
  }

  return {
    version: SESSION_CANVAS_LAYOUT_VERSION,
    viewport: {
      x: 0,
      y: 0,
      scale: SESSION_CANVAS_DEFAULT_SCALE,
    },
    explorer: {
      collapsed: true,
      width: SESSION_CANVAS_DEFAULT_EXPLORER_WIDTH,
      expandedPaths: [workspacePath],
      selectedPath: null,
    },
    panels: drafts.map(withPanelDefaults),
    bootstrap: {
      agentStarted: false,
      startupStarted: false,
      agentLaunchVersion: 0,
      startupLaunchVersion: 0,
    },
    panelDefaults: {
      preview: {
        width: SESSION_CANVAS_DEFAULT_PREVIEW_WIDTH,
        height: SESSION_CANVAS_DEFAULT_PREVIEW_HEIGHT,
      },
    },
  };
}

export function getDefaultSessionCanvasPanelId(
  panels: SessionCanvasPanel[],
): string | null {
  for (let index = panels.length - 1; index >= 0; index -= 1) {
    const panel = panels[index];
    if (panel?.type === 'agent-terminal') {
      return panel.id;
    }
  }

  return panels.at(-1)?.id ?? null;
}

export function closeSessionCanvasPanel(
  layout: SessionCanvasLayout,
  panelId: string,
  terminalPersistenceMode: TerminalPersistenceMode,
): SessionCanvasPanelCloseResult {
  const targetPanel = layout.panels.find((panel) => panel.id === panelId) ?? null;
  const nextPanels = layout.panels.filter((panel) => panel.id !== panelId);

  return {
    layout: {
      ...layout,
      panels: nextPanels,
    },
    nextActivePanelId: getDefaultSessionCanvasPanelId(nextPanels),
    terminalShutdown: targetPanel?.type === 'terminal'
      ? {
          role: getSessionCanvasTerminalRole(targetPanel),
          requiresShellShutdown: terminalPersistenceMode === 'shell',
        }
      : null,
  };
}

export function normalizeSessionCanvasLayout(
  layout: SessionCanvasLayout | null | undefined,
  fallbackLayout: SessionCanvasLayout,
): SessionCanvasLayout {
  if (!layout) {
    return fallbackLayout;
  }

  const normalizedPanels = Array.isArray(layout.panels)
    ? layout.panels.map((panel, index) => withPanelDefaults(panel, index))
    : fallbackLayout.panels;

  const normalized = {
    version: SESSION_CANVAS_LAYOUT_VERSION,
    viewport: {
      x: Number.isFinite(layout.viewport?.x) ? layout.viewport.x : fallbackLayout.viewport.x,
      y: Number.isFinite(layout.viewport?.y) ? layout.viewport.y : fallbackLayout.viewport.y,
      scale: clampSessionCanvasScale(layout.viewport?.scale ?? fallbackLayout.viewport.scale),
    },
    explorer: {
      collapsed: Boolean(layout.explorer?.collapsed),
      width: normalizePanelNumber(
        layout.explorer?.width ?? fallbackLayout.explorer.width,
        fallbackLayout.explorer.width,
        220,
      ),
      expandedPaths: Array.isArray(layout.explorer?.expandedPaths)
        ? Array.from(new Set(layout.explorer.expandedPaths.map((value) => value.trim()).filter(Boolean)))
        : fallbackLayout.explorer.expandedPaths,
      selectedPath: layout.explorer?.selectedPath?.trim() || null,
    },
    panels: normalizedPanels.length > 0 ? normalizedPanels : fallbackLayout.panels,
    bootstrap: {
      agentStarted: Boolean(layout.bootstrap?.agentStarted),
      startupStarted: Boolean(layout.bootstrap?.startupStarted),
      agentLaunchVersion: Number.isFinite(layout.bootstrap?.agentLaunchVersion)
        ? Math.max(0, Math.trunc(layout.bootstrap?.agentLaunchVersion ?? 0))
        : 0,
      startupLaunchVersion: Number.isFinite(layout.bootstrap?.startupLaunchVersion)
        ? Math.max(0, Math.trunc(layout.bootstrap?.startupLaunchVersion ?? 0))
        : 0,
    },
    panelDefaults: {
      preview: {
        width: normalizePanelNumber(
          layout.panelDefaults?.preview?.width ?? fallbackLayout.panelDefaults?.preview?.width ?? SESSION_CANVAS_DEFAULT_PREVIEW_WIDTH,
          fallbackLayout.panelDefaults?.preview?.width ?? SESSION_CANVAS_DEFAULT_PREVIEW_WIDTH,
          SESSION_CANVAS_MIN_PANEL_WIDTH,
        ),
        height: normalizePanelNumber(
          layout.panelDefaults?.preview?.height ?? fallbackLayout.panelDefaults?.preview?.height ?? SESSION_CANVAS_DEFAULT_PREVIEW_HEIGHT,
          fallbackLayout.panelDefaults?.preview?.height ?? SESSION_CANVAS_DEFAULT_PREVIEW_HEIGHT,
          SESSION_CANVAS_MIN_PANEL_HEIGHT,
        ),
      },
    },
  } satisfies SessionCanvasLayout;

  return normalized;
}

export function fitSessionCanvasLayoutToViewport(
  layout: SessionCanvasLayout,
  canvasWidth: number,
  canvasHeight: number,
): SessionCanvasLayout {
  if (!Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight)) {
    return layout;
  }

  const maxWidth = Math.max(
    SESSION_CANVAS_MIN_PANEL_WIDTH,
    Math.floor(canvasWidth - SESSION_CANVAS_EDGE_MARGIN * 2),
  );
  const maxHeight = Math.max(
    SESSION_CANVAS_MIN_PANEL_HEIGHT,
    Math.floor(canvasHeight - SESSION_CANVAS_TOP_MARGIN - SESSION_CANVAS_EDGE_MARGIN),
  );

  return {
    ...layout,
    panels: layout.panels.map((panel) => {
      const width = Math.min(panel.width, maxWidth);
      const height = Math.min(panel.height, maxHeight);
      const maxX = Math.max(
        SESSION_CANVAS_EDGE_MARGIN,
        Math.floor(canvasWidth - width - SESSION_CANVAS_EDGE_MARGIN),
      );
      const maxY = Math.max(
        SESSION_CANVAS_TOP_MARGIN,
        Math.floor(canvasHeight - height - SESSION_CANVAS_EDGE_MARGIN),
      );

      return {
        ...panel,
        width,
        height,
        x: Math.min(Math.max(panel.x, SESSION_CANVAS_EDGE_MARGIN), maxX),
        y: Math.min(Math.max(panel.y, SESSION_CANVAS_TOP_MARGIN), maxY),
      };
    }),
  };
}

export function fitSessionCanvasViewportToPanels(
  panels: SessionCanvasPanel[],
  canvasWidth: number,
  canvasHeight: number,
  padding: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  } = {},
): SessionCanvasViewport {
  if (!Array.isArray(panels) || panels.length === 0) {
    return {
      x: 0,
      y: 0,
      scale: SESSION_CANVAS_DEFAULT_SCALE,
    };
  }

  if (!Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight) || canvasWidth <= 0 || canvasHeight <= 0) {
    return {
      x: 0,
      y: 0,
      scale: SESSION_CANVAS_DEFAULT_SCALE,
    };
  }

  const paddingTop = Math.max(0, padding.top ?? 0);
  const paddingRight = Math.max(0, padding.right ?? 0);
  const paddingBottom = Math.max(0, padding.bottom ?? 0);
  const paddingLeft = Math.max(0, padding.left ?? 0);

  const minX = Math.min(...panels.map((panel) => panel.x));
  const minY = Math.min(...panels.map((panel) => panel.y));
  const maxX = Math.max(...panels.map((panel) => panel.x + panel.width));
  const maxY = Math.max(...panels.map((panel) => panel.y + panel.height));

  const boundsWidth = Math.max(1, maxX - minX);
  const boundsHeight = Math.max(1, maxY - minY);
  const availableWidth = Math.max(1, canvasWidth - paddingLeft - paddingRight);
  const availableHeight = Math.max(1, canvasHeight - paddingTop - paddingBottom);
  const fittedScale = clampSessionCanvasScale(
    Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight),
  );

  return {
    x: paddingLeft + (availableWidth - boundsWidth * fittedScale) / 2 - minX * fittedScale,
    y: paddingTop + (availableHeight - boundsHeight * fittedScale) / 2 - minY * fittedScale,
    scale: fittedScale,
  };
}

export function centerSessionCanvasViewportOnPanels(
  panels: SessionCanvasPanel[],
  canvasWidth: number,
  canvasHeight: number,
  scale = SESSION_CANVAS_DEFAULT_SCALE,
): SessionCanvasViewport {
  const normalizedScale = clampSessionCanvasScale(scale);

  if (!Array.isArray(panels) || panels.length === 0) {
    return {
      x: 0,
      y: 0,
      scale: normalizedScale,
    };
  }

  if (!Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight) || canvasWidth <= 0 || canvasHeight <= 0) {
    return {
      x: 0,
      y: 0,
      scale: normalizedScale,
    };
  }

  const minX = Math.min(...panels.map((panel) => panel.x));
  const minY = Math.min(...panels.map((panel) => panel.y));
  const maxX = Math.max(...panels.map((panel) => panel.x + panel.width));
  const maxY = Math.max(...panels.map((panel) => panel.y + panel.height));
  const boundsWidth = Math.max(1, maxX - minX);
  const boundsHeight = Math.max(1, maxY - minY);

  return {
    x: (canvasWidth - boundsWidth * normalizedScale) / 2 - minX * normalizedScale,
    y: (canvasHeight - boundsHeight * normalizedScale) / 2 - minY * normalizedScale,
    scale: normalizedScale,
  };
}

export function buildSessionCanvasTerminalSrc({
  sessionName,
  panel,
  terminalEnvironments,
  persistenceMode,
  shellKind,
  workspaceRootPath,
}: {
  sessionName: string;
  panel: SessionCanvasAgentTerminalPanel | SessionCanvasTerminalPanel;
  terminalEnvironments: TerminalSessionEnvironment[];
  persistenceMode: TerminalPersistenceMode;
  shellKind: TerminalShellKind;
  workspaceRootPath: string;
}): string {
  const role = getSessionCanvasTerminalRole(panel);

  return buildTtydTerminalSrc(sessionName, role, terminalEnvironments, {
    persistenceMode,
    shellKind,
    workingDirectory: workspaceRootPath,
  });
}

export function buildSessionCanvasTerminalBootstrapCommand({
  src,
  persistenceMode,
  shellKind,
  panelBootstrapCommand,
}: {
  src: string;
  persistenceMode: TerminalPersistenceMode;
  shellKind: TerminalShellKind;
  panelBootstrapCommand?: string | null;
}): string | null {
  const normalizedPanelBootstrapCommand = panelBootstrapCommand?.trim() || '';
  if (persistenceMode !== 'shell') {
    return normalizedPanelBootstrapCommand || null;
  }

  const bootstrapCommand = joinShellStatements(
    [
      buildShellModeTerminalBootstrapCommand(src, shellKind),
      normalizedPanelBootstrapCommand,
    ],
    shellKind,
  );

  return bootstrapCommand || null;
}

export function shouldBootstrapSessionCanvasTerminalPanel(args: {
  panel: SessionCanvasAgentTerminalPanel | SessionCanvasTerminalPanel;
  persistenceMode: TerminalPersistenceMode;
  bootstrapCommand?: string | null;
  startupLaunchVersion?: number;
}): boolean {
  if (args.panel.type === 'agent-terminal') {
    return false;
  }

  if (args.panel.payload.role === 'startup') {
    return args.persistenceMode === 'shell'
      ? Boolean(args.bootstrapCommand)
      : args.startupLaunchVersion !== SESSION_CANVAS_STARTUP_BOOTSTRAP_VERSION;
  }

  return args.persistenceMode === 'shell' && Boolean(args.bootstrapCommand);
}

export function getSessionCanvasTerminalRole(
  panel: SessionCanvasAgentTerminalPanel | SessionCanvasTerminalPanel,
): string {
  if (panel.type === 'agent-terminal') {
    return 'agent';
  }

  return panel.payload.terminalKey === 'terminal' ? 'terminal' : panel.payload.terminalKey;
}
