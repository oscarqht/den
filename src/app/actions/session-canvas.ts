'use server';

import fs from 'node:fs/promises';
import path from 'node:path';

import { getProjectAlias } from './config';
import {
  getSessionTerminalEnvironments,
  getSessionTerminalSources,
  listPathEntries,
  type FileSystemItem,
} from './git';
import { discoverProjectGitRepos } from './project';
import {
  getSessionMetadata,
  readSessionLaunchContext,
  terminateSessionStartupScript,
  writeSessionPromptFile,
  type SessionLaunchContext,
  type SessionMetadata,
} from './session';
import { buildSessionAgentTerminalCommand } from '@/lib/ad-hoc-agent';
import { buildAgentStartupPrompt } from '@/lib/agent-startup-prompt';
import { getErrorMessage } from '@/lib/error-utils';
import { getLocalDb } from '@/lib/local-db';
import {
  clampSessionCanvasScale,
  createDefaultSessionCanvasLayout,
  normalizeSessionCanvasLayout,
} from '@/lib/session-canvas';
import { isPathWithinDirectory } from '@/lib/session-canvas-files';
import {
  searchSessionCanvasWorkspaceEntries,
  type SessionCanvasWorkspaceSearchResult,
} from '@/lib/session-canvas-search';
import { resolveSessionTerminalRepoPaths } from '@/lib/session-terminal-repos';
import { buildShellBootstrapCommand } from '@/lib/shell';
import { getProjectById } from '@/lib/store';
import {
  getFileTypeByExtension,
  isBinaryContent,
} from '@/lib/utils';
import type {
  AgentProvider,
  ReasoningEffort,
  SessionCanvasLayout,
  SessionCanvasPanel,
  SessionWorkspaceFolder,
} from '@/lib/types';

const MAX_SESSION_CANVAS_FILE_BYTES = 512 * 1024;

type SessionCanvasLayoutRow = {
  session_name: string;
  layout_json: string;
  updated_at: string;
};

export type SessionCanvasExplorerRoot = {
  path: string;
  label: string;
  relativePath: string;
};

export type SessionCanvasLaunchContext = {
  initialMessage?: string;
  rawInitialMessage?: string;
  startupScript?: string;
  title?: string;
  agentProvider?: AgentProvider;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  sessionMode?: 'fast' | 'plan';
  attachmentPaths: string[];
};

export type SessionCanvasBootstrapResult =
  | {
      success: true;
      metadata: SessionMetadata;
      layout: SessionCanvasLayout;
      terminalPersistenceMode: 'tmux' | 'shell';
      terminalShellKind: 'posix' | 'powershell';
      terminalSources: {
        agentTerminalSrc: string;
        defaultTerminalSrc: string;
      };
      terminalEnvironments: Array<{ name: string; value: string }>;
      repoDisplayName: string | null;
      sessionIconPath: string | null;
      launchContext: SessionCanvasLaunchContext | null;
      projectGitRepoRelativePaths: string[];
      explorerRoots: SessionCanvasExplorerRoot[];
      workspaceRootPath: string;
      restoredFromSavedLayout: boolean;
      savedLayoutVersion: number | null;
      initialCommands: {
        agentCommand: string | null;
        startupCommand: string | null;
      };
    }
  | {
      success: false;
      error: string;
    };

export type SessionCanvasFileReadResult =
  | {
      success: true;
      filePath: string;
      content: string;
      mode: 'markdown' | 'text';
      sizeBytes: number;
    }
  | {
      success: false;
      error: string;
      code:
        | 'not-found'
        | 'not-file'
        | 'forbidden'
        | 'binary'
        | 'too-large'
        | 'read-failed';
    };

export type SessionCanvasWorkspaceSearchActionResult =
  | {
      success: true;
      results: SessionCanvasWorkspaceSearchResult[];
    }
  | {
      success: false;
      error: string;
    };

type ParsedLaunchContext = {
  launchContext: SessionCanvasLaunchContext | null;
  projectRepoPaths: string[];
  projectRepoRelativePaths: string[];
};

function normalizeAttachmentPaths(
  metadata: SessionMetadata,
  launchContext: SessionLaunchContext,
): string[] {
  const launchAttachmentPaths = (launchContext.attachmentPaths || [])
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (launchAttachmentPaths.length > 0) {
    return Array.from(new Set(launchAttachmentPaths));
  }

  return Array.from(
    new Set(
      (launchContext.attachmentNames || [])
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => `${metadata.workspacePath}-attachments/${name}`),
    ),
  );
}

function parseLaunchContext(
  metadata: SessionMetadata,
  launchContext: SessionLaunchContext | undefined,
): ParsedLaunchContext {
  if (!launchContext) {
    return {
      launchContext: null,
      projectRepoPaths: [],
      projectRepoRelativePaths: [],
    };
  }

  const projectRepoPaths = (launchContext.projectRepoPaths || [])
    .map((entry) => entry.trim())
    .filter(Boolean);
  const projectRepoRelativePaths = (launchContext.projectRepoRelativePaths || [])
    .map((entry) => entry.trim())
    .filter(Boolean);

  return {
    launchContext: {
      initialMessage: launchContext.initialMessage,
      rawInitialMessage: launchContext.rawInitialMessage,
      startupScript: launchContext.startupScript,
      title: launchContext.title,
      agentProvider: launchContext.agentProvider,
      model: launchContext.model,
      reasoningEffort: launchContext.reasoningEffort,
      sessionMode: launchContext.sessionMode,
      attachmentPaths: normalizeAttachmentPaths(metadata, launchContext),
    },
    projectRepoPaths,
    projectRepoRelativePaths,
  };
}

function workspaceFolderLabel(folder: SessionWorkspaceFolder, workspaceRootPath: string): string {
  const relativePath = folder.workspaceRelativePath?.trim() || '.';
  if (relativePath === '.') {
    return path.basename(workspaceRootPath) || workspaceRootPath;
  }
  return relativePath;
}

function toExplorerRoots(metadata: SessionMetadata): SessionCanvasExplorerRoot[] {
  if (metadata.workspaceFolders.length > 0) {
    return metadata.workspaceFolders.map((folder) => ({
      path: folder.workspacePath,
      label: workspaceFolderLabel(folder, metadata.workspacePath),
      relativePath: folder.workspaceRelativePath,
    }));
  }

  return [{
    path: metadata.workspacePath,
    label: path.basename(metadata.workspacePath) || metadata.workspacePath,
    relativePath: '.',
  }];
}

function readSavedSessionCanvasLayout(sessionName: string): SessionCanvasLayout | null {
  const db = getLocalDb();
  const row = db.prepare(`
    SELECT session_name, layout_json, updated_at
    FROM session_canvas_layouts
    WHERE session_name = ?
  `).get(sessionName) as SessionCanvasLayoutRow | undefined;

  if (!row?.layout_json) {
    return null;
  }

  try {
    return JSON.parse(row.layout_json) as SessionCanvasLayout;
  } catch (error) {
    console.warn(`Failed to parse session canvas layout for "${sessionName}":`, error);
    return null;
  }
}

function sanitizeLayoutForPersistence(
  layout: SessionCanvasLayout,
  terminalPersistenceMode: 'tmux' | 'shell',
): SessionCanvasLayout {
  if (terminalPersistenceMode === 'tmux') {
    return layout;
  }

  return {
    ...layout,
    bootstrap: {
      agentStarted: false,
      startupStarted: false,
      agentLaunchVersion: 0,
      startupLaunchVersion: 0,
    },
  };
}

function inferFileViewerMode(filePath: string): 'markdown' | 'text' {
  const extension = path.extname(filePath).toLowerCase();
  return extension === '.md' || extension === '.mdx' || extension === '.markdown'
    ? 'markdown'
    : 'text';
}

function normalizeCanvasPanels(panels: SessionCanvasPanel[]): SessionCanvasPanel[] {
  return panels
    .map((panel, index) => ({
      ...panel,
      zIndex: Number.isFinite(panel.zIndex) ? panel.zIndex : index + 1,
      x: Number.isFinite(panel.x) ? panel.x : 0,
      y: Number.isFinite(panel.y) ? panel.y : 0,
      width: Number.isFinite(panel.width) ? panel.width : 640,
      height: Number.isFinite(panel.height) ? panel.height : 420,
      title: panel.title?.trim() || panel.type,
    }))
    .sort((left, right) => left.zIndex - right.zIndex);
}

export async function saveSessionCanvasLayout(
  sessionId: string,
  layout: SessionCanvasLayout,
): Promise<{ success: boolean; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionId);
    if (!metadata) {
      return { success: false, error: 'Session not found' };
    }

    const launchContextResult = await readSessionLaunchContext(sessionId);
    if (!launchContextResult.success) {
      return { success: false, error: launchContextResult.error || 'Failed to read session launch context' };
    }

    const parsedLaunch = parseLaunchContext(metadata, launchContextResult.context);
    const fallbackLayout = createDefaultSessionCanvasLayout({
      workspacePath: metadata.workspacePath,
      activeRepoPath: metadata.activeRepoPath,
      startupScript: parsedLaunch.launchContext?.startupScript ?? null,
    });

    const normalizedLayout = normalizeSessionCanvasLayout(layout, fallbackLayout);
    const sanitizedLayout: SessionCanvasLayout = {
      ...normalizedLayout,
      viewport: {
        ...normalizedLayout.viewport,
        scale: clampSessionCanvasScale(normalizedLayout.viewport.scale),
      },
      panels: normalizeCanvasPanels(normalizedLayout.panels),
    };

    const db = getLocalDb();
    db.prepare(`
      INSERT INTO session_canvas_layouts (session_name, layout_json, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(session_name) DO UPDATE SET
        layout_json = excluded.layout_json,
        updated_at = excluded.updated_at
    `).run(sessionId, JSON.stringify(sanitizedLayout));

    return { success: true };
  } catch (error) {
    console.error('Failed to save session canvas layout:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function getSessionCanvasBootstrap(sessionId: string): Promise<SessionCanvasBootstrapResult> {
  try {
    const metadata = await getSessionMetadata(sessionId);
    if (!metadata) {
      return { success: false, error: 'Session not found' };
    }

    const [resolvedProject, launchContextResult] = await Promise.all([
      Promise.resolve(metadata.projectId ? getProjectById(metadata.projectId) : null),
      readSessionLaunchContext(sessionId),
    ]);

    if (!launchContextResult.success) {
      return { success: false, error: launchContextResult.error || 'Failed to load session context' };
    }

    const parsedLaunch = parseLaunchContext(metadata, launchContextResult.context);
    const repoDisplayName = (
      resolvedProject?.name?.trim()
      || await getProjectAlias(metadata.projectId ?? metadata.projectPath)
      || null
    );

    const discoveryResult = parsedLaunch.projectRepoPaths.length > 0
      ? null
      : await discoverProjectGitRepos(metadata.projectPath).catch(() => null);
    const discoveredProjectRepoPaths = parsedLaunch.projectRepoPaths.length > 0
      ? parsedLaunch.projectRepoPaths
      : (discoveryResult?.repos.map((repo) => repo.repoPath) ?? null);

    const terminalRepoPaths = resolveSessionTerminalRepoPaths({
      sessionRepoPaths: metadata.gitRepos.map((repo) => repo.sourceRepoPath),
      discoveredProjectRepoPaths,
      activeRepoPath: metadata.activeRepoPath,
      projectPath: metadata.projectPath,
    });

    const [terminalSources, terminalEnvironments] = await Promise.all([
      getSessionTerminalSources(sessionId, terminalRepoPaths, metadata.agent),
      getSessionTerminalEnvironments(terminalRepoPaths, metadata.agent).catch((error) => {
        console.error('Failed to resolve canvas terminal environments:', error);
        return [];
      }),
    ]);

    if (
      terminalSources.persistenceMode === 'shell'
      && parsedLaunch.launchContext?.startupScript?.trim()
    ) {
      const stopResult = await terminateSessionStartupScript(sessionId);
      if (!stopResult.success) {
        console.warn('Failed to stop hidden startup-script process before terminal bootstrap:', stopResult.error);
      }
    }

    const savedLayout = readSavedSessionCanvasLayout(sessionId);
    const savedLayoutVersion = savedLayout && Number.isFinite(savedLayout.version)
      ? savedLayout.version
      : null;

    const fallbackLayout = createDefaultSessionCanvasLayout({
      workspacePath: metadata.workspacePath,
      activeRepoPath: metadata.activeRepoPath,
      startupScript: parsedLaunch.launchContext?.startupScript ?? null,
    });
    const normalizedLayout = sanitizeLayoutForPersistence(
      normalizeSessionCanvasLayout(savedLayout, fallbackLayout),
      terminalSources.persistenceMode,
    );

    const projectGitRepoRelativePaths = parsedLaunch.projectRepoRelativePaths.length > 0
      ? parsedLaunch.projectRepoRelativePaths
      : (discoveryResult
          ? discoveryResult.repos.map((repo) => repo.relativePath)
          : metadata.gitRepos.map((repo) => repo.relativeRepoPath));

    const initialPrompt = buildAgentStartupPrompt({
      taskDescription: parsedLaunch.launchContext?.rawInitialMessage || parsedLaunch.launchContext?.initialMessage,
      attachmentPaths: parsedLaunch.launchContext?.attachmentPaths || [],
      sessionMode: parsedLaunch.launchContext?.sessionMode,
      workspaceMode: metadata.workspaceMode,
      workspaceFolders: metadata.workspaceFolders,
      gitRepos: metadata.gitRepos,
      discoveredRepoRelativePaths: projectGitRepoRelativePaths,
    });
    let initialPromptFilePath: string | null = null;
    if (initialPrompt) {
      const promptFileResult = await writeSessionPromptFile(sessionId, initialPrompt);
      if (promptFileResult.success) {
        initialPromptFilePath = promptFileResult.filePath ?? null;
      } else {
        console.warn('Failed to persist initial session prompt file; falling back to inline terminal bootstrap.', promptFileResult.error);
      }
    }

    const agentProvider = (
      parsedLaunch.launchContext?.agentProvider
      || metadata.agentProvider
      || metadata.agent
      || 'codex'
    );
    const agentModel = parsedLaunch.launchContext?.model || metadata.model || '';
    const agentReasoningEffort = parsedLaunch.launchContext?.reasoningEffort || metadata.reasoningEffort;
    const agentCommand = buildSessionAgentTerminalCommand({
      provider: agentProvider,
      model: agentModel,
      reasoningEffort: agentReasoningEffort,
      shellKind: terminalSources.shellKind,
      workingDirectory: metadata.workspacePath,
      prompt: initialPrompt,
      promptFilePath: initialPromptFilePath,
    });

    return {
      success: true,
      metadata,
      layout: normalizedLayout,
      terminalPersistenceMode: terminalSources.persistenceMode,
      terminalShellKind: terminalSources.shellKind,
      terminalSources: {
        agentTerminalSrc: terminalSources.agentTerminalSrc,
        defaultTerminalSrc: terminalSources.floatingTerminalSrc,
      },
      terminalEnvironments,
      repoDisplayName,
      sessionIconPath: resolvedProject?.iconPath?.trim() || null,
      launchContext: parsedLaunch.launchContext,
      projectGitRepoRelativePaths,
      explorerRoots: toExplorerRoots(metadata),
      workspaceRootPath: metadata.workspacePath,
      restoredFromSavedLayout: Boolean(savedLayout),
      savedLayoutVersion,
      initialCommands: {
        agentCommand,
        startupCommand: buildShellBootstrapCommand(
          metadata.workspacePath,
          parsedLaunch.launchContext?.startupScript?.trim(),
          terminalSources.shellKind,
        ),
      },
    };
  } catch (error) {
    console.error('Failed to build session canvas bootstrap:', error);
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
}

export async function listSessionCanvasPathEntries(
  sessionId: string,
  dirPath: string,
): Promise<{ success: true; entries: FileSystemItem[] } | { success: false; error: string }> {
  try {
    const metadata = await getSessionMetadata(sessionId);
    if (!metadata) {
      return { success: false, error: 'Session not found' };
    }

    const normalizedPath = path.resolve(dirPath);
    if (!isPathWithinDirectory(metadata.workspacePath, normalizedPath)) {
      return { success: false, error: 'Path is outside the session workspace' };
    }

    const stats = await fs.stat(normalizedPath);
    if (!stats.isDirectory()) {
      return { success: false, error: 'Requested path is not a directory' };
    }

    const entries = await listPathEntries(normalizedPath);
    return { success: true, entries };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function readSessionCanvasFile(
  sessionId: string,
  filePath: string,
): Promise<SessionCanvasFileReadResult> {
  try {
    const metadata = await getSessionMetadata(sessionId);
    if (!metadata) {
      return { success: false, error: 'Session not found', code: 'not-found' };
    }

    const normalizedPath = path.resolve(filePath);
    if (!isPathWithinDirectory(metadata.workspacePath, normalizedPath)) {
      return { success: false, error: 'File is outside the session workspace', code: 'forbidden' };
    }

    const stats = await fs.stat(normalizedPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });

    if (!stats) {
      return { success: false, error: 'File not found', code: 'not-found' };
    }

    if (!stats.isFile()) {
      return { success: false, error: 'Requested path is not a file', code: 'not-file' };
    }

    if (stats.size > MAX_SESSION_CANVAS_FILE_BYTES) {
      return {
        success: false,
        error: `File exceeds the ${Math.round(MAX_SESSION_CANVAS_FILE_BYTES / 1024)} KB viewer limit`,
        code: 'too-large',
      };
    }

    const content = await fs.readFile(normalizedPath, 'utf8');
    const fileType = getFileTypeByExtension(normalizedPath);
    if (fileType === 'binary' || isBinaryContent(content)) {
      return { success: false, error: 'Binary files are not supported in the file viewer', code: 'binary' };
    }

    return {
      success: true,
      filePath: normalizedPath,
      content,
      mode: inferFileViewerMode(normalizedPath),
      sizeBytes: stats.size,
    };
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
      code: 'read-failed',
    };
  }
}

export async function searchSessionCanvasWorkspace(
  sessionId: string,
  query: string,
): Promise<SessionCanvasWorkspaceSearchActionResult> {
  try {
    const metadata = await getSessionMetadata(sessionId);
    if (!metadata) {
      return { success: false, error: 'Session not found' };
    }

    const results = await searchSessionCanvasWorkspaceEntries(metadata.workspacePath, query);
    return { success: true, results };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}
