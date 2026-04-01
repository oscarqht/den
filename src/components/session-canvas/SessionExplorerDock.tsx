'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronRight, FileCode2, Folder, FolderOpen } from 'lucide-react';

import type { FileSystemItem } from '@/app/actions/git';
import { listSessionCanvasPathEntries } from '@/app/actions/session-canvas';
import { getBaseName } from '@/lib/path';

type SessionExplorerRoot = {
  path: string;
  label: string;
  relativePath: string;
};

type SessionExplorerState = {
  collapsed: boolean;
  width: number;
  expandedPaths: string[];
  selectedPath: string | null;
};

type SessionExplorerDockProps = {
  sessionId: string;
  roots: SessionExplorerRoot[];
  state: SessionExplorerState;
  mobile?: boolean;
  onStateChange: (updates: Partial<SessionExplorerState>) => void;
  onOpenFile: (filePath: string) => void;
};

type TreeNodeProps = {
  depth: number;
  item: FileSystemItem;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  entriesByPath: Record<string, FileSystemItem[]>;
  loadingPaths: Record<string, boolean>;
  onToggleDirectory: (dirPath: string) => void;
  onSelectPath: (path: string) => void;
  onOpenFile: (filePath: string) => void;
};

const MIN_EXPLORER_WIDTH = 220;
const MAX_EXPLORER_WIDTH = 420;
const EDGE_TOGGLE_CLASS_NAME = 'absolute top-1/2 z-40 h-16 w-2 -translate-y-1/2 bg-slate-300/70 shadow-[0_8px_18px_-10px_rgba(15,23,42,0.5)] transition hover:w-2.5 hover:bg-slate-500/80 dark:bg-[color:var(--app-dark-border-subtle)] dark:shadow-[0_10px_20px_-12px_rgba(12,9,8,0.88)] dark:hover:bg-[color:var(--app-dark-accent-hover)]';
const RESIZE_HANDLE_CLASS_NAME = 'absolute inset-y-0 right-0 w-1 cursor-col-resize bg-transparent transition hover:bg-slate-300/60 dark:hover:bg-[color:color-mix(in_srgb,var(--app-dark-accent)_34%,transparent)]';

function joinClassNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function itemIcon(item: FileSystemItem, expanded: boolean) {
  if (item.isDirectory) {
    return expanded
      ? <FolderOpen className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
      : <Folder className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />;
  }

  return <FileCode2 className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />;
}

function TreeNode({
  depth,
  item,
  expandedPaths,
  selectedPath,
  entriesByPath,
  loadingPaths,
  onToggleDirectory,
  onSelectPath,
  onOpenFile,
}: TreeNodeProps) {
  const isExpanded = item.isDirectory && expandedPaths.has(item.path);
  const childEntries = entriesByPath[item.path] || [];

  return (
    <div>
      <button
        type="button"
        className={joinClassNames(
          'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] leading-4 transition',
          selectedPath === item.path
            ? 'bg-slate-200/80 text-slate-900 dark:bg-[color:var(--app-dark-elevated)] dark:text-slate-100'
            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-[color:var(--app-dark-input)]',
        )}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
        onClick={() => {
          if (item.isDirectory) {
            onToggleDirectory(item.path);
            return;
          }
          onSelectPath(item.path);
        }}
        onDoubleClick={() => {
          if (item.isDirectory) {
            return;
          }
          onOpenFile(item.path);
        }}
      >
        {item.isDirectory ? (
          <ChevronRight
            className={joinClassNames(
              'h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform',
              isExpanded && 'rotate-90',
            )}
          />
        ) : (
          <span className="h-3.5 w-3.5 shrink-0" />
        )}
        {itemIcon(item, isExpanded)}
        <span className="min-w-0 flex-1 truncate">{item.name}</span>
      </button>

      {item.isDirectory && isExpanded ? (
        <div>
          {loadingPaths[item.path] ? (
            <div
              className="px-2 py-1 text-[11px] text-slate-400"
              style={{ paddingLeft: `${24 + depth * 14}px` }}
            >
              Loading...
            </div>
          ) : null}
          {childEntries.map((childEntry) => (
            <TreeNode
              key={childEntry.path}
              depth={depth + 1}
              item={childEntry}
              expandedPaths={expandedPaths}
              selectedPath={selectedPath}
              entriesByPath={entriesByPath}
              loadingPaths={loadingPaths}
              onToggleDirectory={onToggleDirectory}
              onSelectPath={onSelectPath}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SessionExplorerDock({
  sessionId,
  roots,
  state,
  mobile = false,
  onStateChange,
  onOpenFile,
}: SessionExplorerDockProps) {
  const [entriesByPath, setEntriesByPath] = useState<Record<string, FileSystemItem[]>>({});
  const [loadingPaths, setLoadingPaths] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const resizeStateRef = useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);

  const expandedPathSet = useMemo(() => new Set(state.expandedPaths), [state.expandedPaths]);

  const loadDirectory = useCallback(async (dirPath: string) => {
    setLoadingPaths((previous) => ({ ...previous, [dirPath]: true }));
    try {
      const result = await listSessionCanvasPathEntries(sessionId, dirPath);
      if (!result.success) {
        throw new Error(result.error);
      }
      setEntriesByPath((previous) => ({ ...previous, [dirPath]: result.entries }));
      setError(null);
    } catch (loadError) {
      console.error('Failed to load explorer directory:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load directory');
    } finally {
      setLoadingPaths((previous) => ({ ...previous, [dirPath]: false }));
    }
  }, [sessionId]);

  useEffect(() => {
    for (const root of roots) {
      if (!(root.path in entriesByPath) && !loadingPaths[root.path]) {
        void loadDirectory(root.path);
      }
    }
  }, [entriesByPath, loadDirectory, loadingPaths, roots]);

  useEffect(() => {
    for (const expandedPath of state.expandedPaths) {
      if (!(expandedPath in entriesByPath) && !loadingPaths[expandedPath]) {
        void loadDirectory(expandedPath);
      }
    }
  }, [entriesByPath, loadDirectory, loadingPaths, state.expandedPaths]);

  const toggleDirectory = useCallback((dirPath: string) => {
    const nextExpandedPaths = expandedPathSet.has(dirPath)
      ? state.expandedPaths.filter((entry) => entry !== dirPath)
      : [...state.expandedPaths, dirPath];

    onStateChange({
      expandedPaths: nextExpandedPaths,
      selectedPath: dirPath,
    });

    if (!(dirPath in entriesByPath) && !expandedPathSet.has(dirPath)) {
      void loadDirectory(dirPath);
    }
  }, [entriesByPath, expandedPathSet, loadDirectory, onStateChange, state.expandedPaths]);

  const beginResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: state.width,
    };

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;
      const delta = pointerEvent.clientX - resizeState.startX;
      onStateChange({
        width: Math.max(MIN_EXPLORER_WIDTH, Math.min(MAX_EXPLORER_WIDTH, resizeState.startWidth + delta)),
      });
    };

    const handlePointerUp = () => {
      resizeStateRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  }, [onStateChange, state.width]);

  if (state.collapsed) {
    if (mobile) {
      return null;
    }

    return (
      <div className="relative z-30 h-full w-0 shrink-0 overflow-visible">
        <button
          type="button"
          className={joinClassNames(EDGE_TOGGLE_CLASS_NAME, 'left-0 rounded-r-full')}
          onClick={() => onStateChange({ collapsed: false })}
          aria-label="Expand explorer"
          title="Expand explorer"
        >
          <span className="sr-only">Expand explorer</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className={mobile ? 'relative h-full w-full' : 'relative z-30 h-full shrink-0 px-4 py-4 pr-2'}
      style={mobile ? undefined : { width: state.width + 24 }}
    >
      <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_36px_-24px_rgba(15,23,42,0.42)] app-dark-panel">
        {error ? (
          <div className="border-b border-slate-200 px-3 py-2 text-[11px] text-red-600 dark:border-slate-800 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {roots.map((root) => (
            <div key={root.path} className="mb-2">
              <button
                type="button"
                className={joinClassNames(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] font-medium leading-4 transition',
                  state.selectedPath === root.path
                    ? 'bg-slate-200/80 text-slate-900 dark:bg-[color:var(--app-dark-elevated)] dark:text-slate-100'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-[color:var(--app-dark-input)]',
                )}
                onClick={() => toggleDirectory(root.path)}
              >
                <ChevronRight
                  className={joinClassNames(
                    'h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform',
                    expandedPathSet.has(root.path) && 'rotate-90',
                  )}
                />
                {expandedPathSet.has(root.path)
                  ? <FolderOpen className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
                  : <Folder className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />}
                <span className="min-w-0 flex-1 truncate" title={root.path}>
                  {root.label || getBaseName(root.path)}
                </span>
              </button>

              {expandedPathSet.has(root.path) ? (
                <div className="mt-1">
                  {(entriesByPath[root.path] || []).map((entry) => (
                    <TreeNode
                      key={entry.path}
                      depth={1}
                      item={entry}
                      expandedPaths={expandedPathSet}
                      selectedPath={state.selectedPath}
                      entriesByPath={entriesByPath}
                      loadingPaths={loadingPaths}
                      onToggleDirectory={toggleDirectory}
                      onSelectPath={(selectedPath) => onStateChange({ selectedPath })}
                      onOpenFile={onOpenFile}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {!mobile ? (
          <div
            className={RESIZE_HANDLE_CLASS_NAME}
            onPointerDown={beginResize}
          />
        ) : null}
      </div>

      {!mobile ? (
        <button
          type="button"
          className={joinClassNames(EDGE_TOGGLE_CLASS_NAME, 'right-0 translate-x-1/2 rounded-full')}
          onClick={() => onStateChange({ collapsed: true })}
          aria-label="Collapse explorer"
          title="Collapse explorer"
        >
          <span className="sr-only">Collapse explorer</span>
        </button>
      ) : null}
    </div>
  );
}
