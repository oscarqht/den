'use client';

import { useGitDiff } from '@/hooks/use-git';
import { useState, useEffect, useRef, useId } from 'react';
import { useTheme } from 'next-themes';
import { getChangedLineCountFromDiff, isFileBinary, isImageFile } from '@/lib/utils';
import { GroupedDiffViewer } from './grouped-diff-viewer';
import { ImageDiffView } from './image-diff-view';

type DiffViewProps = {
  repoPath: string;
  filePath: string;
  splitView?: boolean;
  onSplitViewChange?: (value: boolean) => void;
  showHeader?: boolean;
};

export function DiffView({
  repoPath,
  filePath,
  splitView: controlledSplitView,
  onSplitViewChange,
  showHeader = true,
}: DiffViewProps) {
  const { data, isLoading } = useGitDiff(repoPath, filePath);
  const diffScrollContainerRef = useRef<HTMLDivElement>(null);
  const splitViewToggleId = useId();
  
  // Storage key for split view preference
  const storageKey = 'git-web:diff-view-split';
  const isSplitViewControlled = typeof controlledSplitView === 'boolean';
  
  const [uncontrolledSplitView, setUncontrolledSplitView] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      const stored = localStorage.getItem(storageKey);
      return stored !== null ? JSON.parse(stored) : true;
    } catch (e) {
      console.error('Failed to load split view preference:', e);
      return true;
    }
  });

  const [renderAnywayFilePath, setRenderAnywayFilePath] = useState<string | null>(null);
  const renderAnyway = renderAnywayFilePath === filePath;
  
  const { resolvedTheme } = useTheme();
  const splitView = controlledSplitView ?? uncontrolledSplitView;
  const diffHeaderClass = 'border-b border-slate-200/70 bg-white/30 dark:border-slate-800 dark:bg-slate-950/30';

  // Save split view preference when it changes
  useEffect(() => {
    if (isSplitViewControlled) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(splitView));
    } catch (e) {
      console.error('Failed to save split view preference:', e);
    }
  }, [isSplitViewControlled, splitView]);

  const handleSplitViewChange = (value: boolean) => {
    if (!isSplitViewControlled) {
      setUncontrolledSplitView(value);
    }
    onSplitViewChange?.(value);
  };

  const header = showHeader ? (
    <div className={`flex h-[57px] shrink-0 items-center justify-between px-4 ${diffHeaderClass}`}>
      <span className="text-sm font-mono truncate max-w-[70%]" title={filePath}>{filePath}</span>
      <div className="flex items-center gap-2">
        <label htmlFor={splitViewToggleId} className="text-[10px] uppercase tracking-wider font-bold cursor-pointer opacity-70">Split View</label>
        <input
          type="checkbox"
          id={splitViewToggleId}
          checked={splitView}
          onChange={(e) => handleSplitViewChange(e.target.checked)}
          className="toggle toggle-sm toggle-primary"
        />
      </div>
    </div>
  ) : null;

  // Reset diff scroll position when switching files.
  useEffect(() => {
    if (isLoading) return;

    const frame = requestAnimationFrame(() => {
      diffScrollContainerRef.current?.scrollTo({ top: 0, left: 0 });
    });

    return () => cancelAnimationFrame(frame);
  }, [filePath, isLoading]);

  if (isLoading) {
    return <div className="flex items-center justify-center p-8 h-full"><span className="loading loading-spinner text-base-content/50"></span></div>;
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full opacity-50">
        No diff available
      </div>
    )
  }

  const isImage = isImageFile(filePath);
  if (isImage) {
    return (
      <div className="flex h-full flex-col bg-transparent">
        {showHeader ? (
          <div className={`flex h-[57px] shrink-0 items-center justify-between px-4 ${diffHeaderClass}`}>
            <span className="text-sm font-mono truncate max-w-[70%]" title={filePath}>{filePath}</span>
          </div>
        ) : null}
        <div className="flex-1 overflow-auto">
          <ImageDiffView filePath={filePath} imageDiff={data.imageDiff} />
        </div>
      </div>
    );
  }

  // Check if file is binary (first by extension, then by content if unknown)
  const isBinary = isFileBinary(filePath, data.left, data.right);

  if (isBinary) {
    return (
      <div className="flex h-full flex-col bg-transparent">
        {showHeader ? (
          <div className={`flex h-[57px] shrink-0 items-center justify-between px-4 ${diffHeaderClass}`}>
            <span className="text-sm font-mono truncate max-w-[70%]" title={filePath}>{filePath}</span>
          </div>
        ) : null}
        <div className="flex-1 flex items-center justify-center opacity-50">
          Binary file - diff not available
        </div>
      </div>
    );
  }

  // Large file protection
  const MAX_DIFF_SIZE = 100 * 1024; // 100KB
  const MAX_DIFF_LINES = 3000;

  const diffContent = data.diff || '';
  const contentSize = diffContent.length;
  const lineCount = getChangedLineCountFromDiff(diffContent);

  const isLargeDiff = (contentSize > MAX_DIFF_SIZE || lineCount > MAX_DIFF_LINES);

  return (
    <div className="flex h-full flex-col bg-transparent">
      {header}
      <div ref={diffScrollContainerRef} className="flex-1 overflow-auto diff-viewer-wrapper">
        {isLargeDiff && !renderAnyway ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-4">
            <i className="iconoir-warning-triangle text-[40px] text-warning" aria-hidden="true" />
            <div className="space-y-2">
              <h3 className="font-bold text-lg">Large Diff Detected</h3>
              <p className="opacity-70">
                This diff is large ({Math.round(contentSize / 1024)}KB, ~{lineCount} changed lines) and may freeze your browser if rendered.
              </p>
            </div>
            <button className="btn btn-outline" onClick={() => setRenderAnywayFilePath(filePath)}>
              Show Diff Anyway
            </button>
          </div>
        ) : (
          <GroupedDiffViewer
            oldValue={data.left || ''}
            newValue={data.right || ''}
            splitView={splitView}
            useDarkTheme={resolvedTheme === 'dark'}
          />
        )}
      </div>
    </div>
  );
}
