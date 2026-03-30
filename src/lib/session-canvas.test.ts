import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SESSION_CANVAS_DEFAULT_EXPLORER_WIDTH,
  buildSessionCanvasTerminalBootstrapCommand,
  buildSessionCanvasTerminalSrc,
  centerSessionCanvasViewportOnPanels,
  createDefaultSessionCanvasLayout,
  fitSessionCanvasLayoutToViewport,
  fitSessionCanvasViewportToPanels,
  normalizeSessionCanvasLayout,
} from './session-canvas.ts';

describe('session canvas layout helpers', () => {
  it('creates the default canvas layout with terminal-first panels', () => {
    const layout = createDefaultSessionCanvasLayout({
      workspacePath: '/tmp/workspace',
      activeRepoPath: '/tmp/workspace/repo',
      startupScript: 'npm run dev',
    });

    assert.equal(layout.version, 2);
    assert.equal(layout.explorer.width, SESSION_CANVAS_DEFAULT_EXPLORER_WIDTH);
    assert.equal(layout.explorer.collapsed, true);
    assert.deepEqual(
      layout.panels.map((panel) => panel.type),
      ['agent-terminal', 'terminal'],
    );
    assert.equal(layout.panels[0]?.y, layout.panels[1]?.y);
    assert.equal(layout.panels[1]!.x > layout.panels[0]!.x + layout.panels[0]!.width, true);
    assert.equal(layout.panels[1]?.height, 420);
    assert.equal(layout.panelDefaults?.preview?.width, 900);
    assert.equal(layout.panelDefaults?.preview?.height, 600);
    assert.equal(layout.bootstrap.agentStarted, false);
    assert.equal(layout.bootstrap.startupStarted, false);
  });

  it('normalizes malformed layouts against the default schema', () => {
    const fallbackLayout = createDefaultSessionCanvasLayout({
      workspacePath: '/tmp/workspace',
      startupScript: null,
    });

    const normalized = normalizeSessionCanvasLayout({
      version: 99,
      viewport: {
        x: Number.NaN,
        y: 120,
        scale: 99,
      },
      explorer: {
        collapsed: true,
        width: 40,
        expandedPaths: ['  /tmp/workspace  ', '', '/tmp/workspace'],
        selectedPath: '  /tmp/workspace/file.ts  ',
      },
      panels: [{
        id: '',
        type: 'terminal',
        title: '',
        x: Number.NaN,
        y: 20,
        width: 10,
        height: 20,
        zIndex: Number.NaN,
        state: {
          maximized: true,
          restoreBounds: {
            x: 10,
            y: 20,
            width: 300,
            height: 240,
          },
        },
        payload: {
          terminalKey: 'terminal',
        },
      }],
      bootstrap: {
        agentStarted: true,
        startupStarted: false,
      },
      panelDefaults: {
        preview: {
          width: 120,
          height: Number.NaN,
        },
      },
    }, fallbackLayout);

    assert.equal(normalized.viewport.x, fallbackLayout.viewport.x);
    assert.equal(normalized.viewport.y, 120);
    assert.equal(normalized.viewport.scale, 2.5);
    assert.equal(normalized.explorer.width, 220);
    assert.deepEqual(normalized.explorer.expandedPaths, ['/tmp/workspace']);
    assert.equal(normalized.explorer.selectedPath, '/tmp/workspace/file.ts');
    assert.equal(normalized.panels[0]?.id.startsWith('terminal:'), true);
    assert.equal(normalized.panels[0]?.width, 220);
    assert.equal(normalized.panels[0]?.height, 160);
    assert.equal(normalized.panels[0]?.state?.maximized, true);
    assert.deepEqual(normalized.panels[0]?.state?.restoreBounds, {
      x: 10,
      y: 20,
      width: 300,
      height: 240,
    });
    assert.equal(normalized.bootstrap.agentStarted, true);
    assert.equal(normalized.panelDefaults?.preview?.width, 320);
    assert.equal(normalized.panelDefaults?.preview?.height, 600);
  });

  it('clamps default panels into the visible canvas viewport', () => {
    const layout = createDefaultSessionCanvasLayout({
      workspacePath: '/tmp/workspace',
      startupScript: 'npm run dev',
    });

    const fitted = fitSessionCanvasLayoutToViewport(layout, 900, 720);
    for (const panel of fitted.panels) {
      assert.equal(panel.x + panel.width <= 900 - 24, true);
      assert.equal(panel.y >= 84, true);
    }
  });

  it('builds canvas terminal src values with the session workspace cwd', () => {
    const agentPanel = createDefaultSessionCanvasLayout({
      workspacePath: '/tmp/workspace',
      startupScript: null,
    }).panels[0];

    assert.ok(agentPanel);
    assert.equal(agentPanel.type, 'agent-terminal');

    const agentSrc = buildSessionCanvasTerminalSrc({
      sessionName: 'session-1',
      panel: agentPanel,
      terminalEnvironments: [{ name: 'FOO', value: 'bar' }],
      persistenceMode: 'tmux',
      shellKind: 'posix',
      workspaceRootPath: '/tmp/workspace',
    });

    const startupPanel = createDefaultSessionCanvasLayout({
      workspacePath: '/tmp/workspace',
      startupScript: 'npm run dev',
    }).panels[1];

    assert.ok(startupPanel);
    assert.equal(startupPanel.type, 'terminal');

    const terminalSrc = buildSessionCanvasTerminalSrc({
      sessionName: 'session-1',
      panel: startupPanel,
      terminalEnvironments: [{ name: 'FOO', value: 'bar' }],
      persistenceMode: 'tmux',
      shellKind: 'posix',
      workspaceRootPath: '/tmp/workspace',
    });

    assert.match(agentSrc, /arg=-c&arg=%2Ftmp%2Fworkspace/);
    assert.match(terminalSrc, /arg=-c&arg=%2Ftmp%2Fworkspace/);
  });

  it('prepends shell-mode src bootstrap before panel commands', () => {
    const startupPanel = createDefaultSessionCanvasLayout({
      workspacePath: 'C:\\workspace',
      startupScript: 'npm run dev',
    }).panels[1];

    assert.ok(startupPanel);
    assert.equal(startupPanel.type, 'terminal');

    const src = buildSessionCanvasTerminalSrc({
      sessionName: 'session-1',
      panel: startupPanel,
      terminalEnvironments: [{ name: 'OPENAI_API_KEY', value: 'sk-example' }],
      persistenceMode: 'shell',
      shellKind: 'powershell',
      workspaceRootPath: 'C:\\workspace',
    });

    assert.strictEqual(
      buildSessionCanvasTerminalBootstrapCommand({
        src,
        persistenceMode: 'shell',
        shellKind: 'powershell',
        panelBootstrapCommand: "Set-Location -LiteralPath 'C:\\workspace'; npm run dev",
      }),
      "$env:OPENAI_API_KEY = 'sk-example'; Set-Location -LiteralPath 'C:\\workspace'; Set-Location -LiteralPath 'C:\\workspace'; npm run dev",
    );
  });

  it('derives shell-mode bootstrap from src even without a panel command', () => {
    const startupPanel = createDefaultSessionCanvasLayout({
      workspacePath: 'C:\\workspace',
      startupScript: null,
    }).panels[1];

    assert.ok(startupPanel);
    assert.equal(startupPanel.type, 'terminal');

    const src = buildSessionCanvasTerminalSrc({
      sessionName: 'session-1',
      panel: startupPanel,
      terminalEnvironments: [{ name: 'OPENAI_API_KEY', value: 'sk-example' }],
      persistenceMode: 'shell',
      shellKind: 'powershell',
      workspaceRootPath: 'C:\\workspace',
    });

    assert.strictEqual(
      buildSessionCanvasTerminalBootstrapCommand({
        src,
        persistenceMode: 'shell',
        shellKind: 'powershell',
        panelBootstrapCommand: null,
      }),
      "$env:OPENAI_API_KEY = 'sk-example'; Set-Location -LiteralPath 'C:\\workspace'",
    );
  });

  it('fits the canvas viewport so all panels are visible', () => {
    const layout = createDefaultSessionCanvasLayout({
      workspacePath: '/tmp/workspace',
      startupScript: 'npm run dev',
    });

    const viewport = fitSessionCanvasViewportToPanels(layout.panels, 1200, 900, {
      top: 96,
      right: 40,
      bottom: 40,
      left: 40,
    });

    assert.equal(viewport.scale < 1, true);
    assert.equal(Number.isFinite(viewport.x), true);
    assert.equal(Number.isFinite(viewport.y), true);
  });

  it('centers default panels while preserving the requested zoom level', () => {
    const layout = createDefaultSessionCanvasLayout({
      workspacePath: '/tmp/workspace',
      startupScript: 'npm run dev',
    });

    const viewport = centerSessionCanvasViewportOnPanels(layout.panels, 1600, 900, layout.viewport.scale);
    const minX = Math.min(...layout.panels.map((panel) => panel.x));
    const minY = Math.min(...layout.panels.map((panel) => panel.y));
    const maxX = Math.max(...layout.panels.map((panel) => panel.x + panel.width));
    const maxY = Math.max(...layout.panels.map((panel) => panel.y + panel.height));
    const scaledCenterX = (minX + maxX) * viewport.scale / 2 + viewport.x;
    const scaledCenterY = (minY + maxY) * viewport.scale / 2 + viewport.y;

    assert.equal(viewport.scale, layout.viewport.scale);
    assert.equal(Math.round(scaledCenterX), 800);
    assert.equal(Math.round(scaledCenterY), 450);
  });
});
