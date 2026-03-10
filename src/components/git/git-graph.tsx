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
  type UIEvent,
} from 'react';
import type { BranchTrackingInfo, Commit } from '@/lib/types';
import { type GraphNode, generateGraphData } from '@/lib/graph-utils';
import { cn } from '@/lib/utils';
import { ContextMenu, type ContextMenuItem } from '@/components/context-menu';
import { getBranchTagColors } from '@/lib/branch-colors';
import { SessionAssociationDot } from './session-association-dot';

const ROW_HEIGHT = 24;
const LANE_WIDTH = 12;
const DOT_SIZE = 3;
const STROKE_WIDTH = 2;
const OVERSCAN_ROWS = 16;
const EMPTY_HIDDEN_BRANCHES = new Set<string>();

type CommitSelectModifiers = {
  isMultiSelect: boolean;
  isRangeSelect: boolean;
};

type ProcessedRefTag = {
  displayName: string;
  primaryRef: string;
  secondaryRef?: string;
  isHead: boolean;
  isCurrent: boolean;
  isGitTag: boolean;
  hasAssociatedSession: boolean;
  textColor: string;
  backgroundColor: string;
};

type PreparedGraphRow = {
  node: GraphNode;
  shortHash: string;
  formattedDate: string;
  processedTags: ProcessedRefTag[];
  rewordTargetBranch: string | null;
};

function normalizeDecoratedRef(ref: string): string {
  if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length);
  if (ref.startsWith('refs/remotes/')) return ref.slice('refs/remotes/'.length);
  if (ref.startsWith('remotes/')) return ref.slice('remotes/'.length);
  return ref;
}

function getRefDisplayName(ref: string): string {
  if (ref.startsWith('tag:')) return ref.replace(/^tag:\s*/, '').trim();
  return ref;
}

function parseDecoratedRefs(refs?: string): Array<{ raw: string; name: string; isHead: boolean }> {
  if (!refs) return [];

  return refs
    .replace(/^\s*\((.*)\)\s*$/, '$1')
    .split(',')
    .map((ref) => ref.trim())
    .filter(Boolean)
    .map((ref) => {
      const isHead = ref.startsWith('HEAD -> ');
      return {
        raw: ref,
        name: normalizeDecoratedRef(ref.replace(/^HEAD\s*->\s*/, '').trim()),
        isHead,
      };
    });
}

function resolveRewordTargetBranch(
  node: GraphNode,
  localBranchSet: Set<string>,
  currentBranch?: string,
): string | null {
  const refs = parseDecoratedRefs(node.refs);
  let targetBranch: string | null = null;

  for (const ref of refs) {
    if (!localBranchSet.has(ref.name)) continue;
    targetBranch = ref.name;
    if (currentBranch && ref.name === currentBranch) {
      break;
    }
  }

  return targetBranch;
}

function buildProcessedTags(
  node: GraphNode,
  hiddenBranches: Set<string>,
  localBranchSet: Set<string>,
  trackingInfo?: Record<string, BranchTrackingInfo>,
  currentBranch?: string,
  isBranchSessionAssociated?: (displayRef: string) => boolean,
): ProcessedRefTag[] {
  const rawRefs = parseDecoratedRefs(node.refs);
  if (rawRefs.length === 0) return [];

  const processedIndices = new Set<number>();
  const tags: ProcessedRefTag[] = [];
  const isHidden = (name: string) => hiddenBranches.has(name) || hiddenBranches.has(`remotes/${name}`);

  rawRefs.forEach((ref, index) => {
    if (processedIndices.has(index)) return;
    if (!localBranchSet.has(ref.name) || isHidden(ref.name)) return;

    const tracking = trackingInfo?.[ref.name];
    if (!tracking?.upstream) return;

    const normalizedUpstream = normalizeDecoratedRef(tracking.upstream.trim());
    const upstreamCandidates = new Set([
      normalizedUpstream,
      normalizeDecoratedRef(`remotes/${normalizedUpstream}`),
      normalizeDecoratedRef(`refs/remotes/${normalizedUpstream}`),
    ]);
    const upstreamIndex = rawRefs.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex !== index
        && !processedIndices.has(candidateIndex)
        && upstreamCandidates.has(candidate.name),
    );

    if (upstreamIndex === -1) return;

    const remoteName = normalizedUpstream.split('/')[0];
    const tagColors = getBranchTagColors(ref.name);
    tags.push({
      displayName: `${ref.name} (${remoteName})`,
      primaryRef: ref.name,
      secondaryRef: rawRefs[upstreamIndex]?.name,
      isHead: ref.isHead,
      isCurrent: currentBranch === ref.name,
      isGitTag: false,
      hasAssociatedSession: !!isBranchSessionAssociated?.(ref.name),
      textColor: tagColors.textColor,
      backgroundColor: tagColors.backgroundColor,
    });

    processedIndices.add(index);
    processedIndices.add(upstreamIndex);
  });

  rawRefs.forEach((ref, index) => {
    if (processedIndices.has(index) || isHidden(ref.name)) return;

    const isGitTag = ref.name.startsWith('tag:');
    const tagColors = isGitTag
      ? { textColor: '#374151', backgroundColor: '#e5e7eb' }
      : getBranchTagColors(ref.name);

    tags.push({
      displayName: getRefDisplayName(ref.name),
      primaryRef: ref.name,
      isHead: ref.isHead,
      isCurrent: currentBranch === ref.name,
      isGitTag,
      hasAssociatedSession: !isGitTag && !!isBranchSessionAssociated?.(ref.name),
      textColor: tagColors.textColor,
      backgroundColor: tagColors.backgroundColor,
    });
  });

  return tags;
}

function HighlightedText({
  text,
  searchQuery,
}: {
  text: string;
  searchQuery: string;
}) {
  if (!searchQuery || !text) return <>{text}</>;

  const query = searchQuery.toLowerCase();
  const lowerText = text.toLowerCase();
  const parts: Array<{ text: string; highlighted: boolean }> = [];

  let lastIndex = 0;
  let index = lowerText.indexOf(query);

  while (index !== -1) {
    if (index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, index), highlighted: false });
    }
    parts.push({ text: text.slice(index, index + query.length), highlighted: true });
    lastIndex = index + query.length;
    index = lowerText.indexOf(query, lastIndex);
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), highlighted: false });
  }

  if (parts.length === 0) return <>{text}</>;

  return (
    <>
      {parts.map((part, indexPart) => (
        part.highlighted ? (
          <mark
            key={`${part.text}-${indexPart}`}
            className="bg-warning text-warning-content rounded-sm px-0.5"
          >
            {part.text}
          </mark>
        ) : (
          <span key={`${part.text}-${indexPart}`}>{part.text}</span>
        )
      ))}
    </>
  );
}

export interface GitGraphHandle {
  scrollToCommit: (hash: string) => boolean;
}

type GitGraphProps = {
  commits: Commit[];
  onSelectCommit?: (hash: string, modifiers?: CommitSelectModifiers) => void;
  onResetToCommit?: (hash: string) => void;
  onRevertCommit?: (hash: string, message: string) => void;
  onCreateTag?: (hash: string) => void;
  onCherryPickCommit?: (hash: string, message: string) => void;
  onCherryPickSelectedCommits?: () => void;
  onRewordCommit?: (hash: string, subject: string, body: string, branch: string) => void;
  selectedHash?: string;
  selectedHashes?: Set<string>;
  onEndReached?: () => void;
  isLoadingMore?: boolean;
  currentBranch?: string;
  hiddenBranches?: Set<string>;
  localBranches?: string[];
  trackingInfo?: Record<string, BranchTrackingInfo>;
  getBranchTagContextMenuItems?: (displayRef: string) => ContextMenuItem[] | null;
  isBranchSessionAssociated?: (displayRef: string) => boolean;
};

type GitGraphRowProps = {
  row: PreparedGraphRow;
  graphWidth: number;
  isSelected: boolean;
  selectedCount: number;
  searchQuery: string;
  onSelectCommit?: (hash: string, modifiers?: CommitSelectModifiers) => void;
  onResetToCommit?: (hash: string) => void;
  onRevertCommit?: (hash: string, message: string) => void;
  onCreateTag?: (hash: string) => void;
  onCherryPickCommit?: (hash: string, message: string) => void;
  onCherryPickSelectedCommits?: () => void;
  onRewordCommit?: (hash: string, subject: string, body: string, branch: string) => void;
  getBranchTagContextMenuItems?: (displayRef: string) => ContextMenuItem[] | null;
};

const GitGraphRow = memo(function GitGraphRow({
  row,
  graphWidth,
  isSelected,
  selectedCount,
  searchQuery,
  onSelectCommit,
  onResetToCommit,
  onRevertCommit,
  onCreateTag,
  onCherryPickCommit,
  onCherryPickSelectedCommits,
  onRewordCommit,
  getBranchTagContextMenuItems,
}: GitGraphRowProps) {
  const { node, processedTags, shortHash, formattedDate, rewordTargetBranch } = row;
  const menuItems = useMemo(() => {
    const nextItems: ContextMenuItem[] = [
      {
        label: 'Reset to here',
        icon: <i className="iconoir-refresh-circle text-[14px]" aria-hidden="true" />,
        onClick: () => onResetToCommit?.(node.hash),
      },
    ];

    if (onRevertCommit) {
      nextItems.push({
        label: 'Revert commit',
        icon: <i className="iconoir-u-turn-arrow-left text-[14px]" aria-hidden="true" />,
        onClick: () => onRevertCommit(node.hash, node.message),
      });
    }
    if (onCreateTag) {
      nextItems.push({
        label: 'Create tag',
        icon: <i className="iconoir-bookmark text-[14px]" aria-hidden="true" />,
        onClick: () => onCreateTag(node.hash),
      });
    }
    if (onCherryPickCommit) {
      nextItems.push({
        label: 'Cherry-pick commit',
        icon: <i className="iconoir-git-fork text-[14px]" aria-hidden="true" />,
        onClick: () => onCherryPickCommit(node.hash, node.message),
      });
    }
    if (onCherryPickSelectedCommits && selectedCount > 1 && isSelected) {
      nextItems.push({
        label: `Cherry-pick ${selectedCount} selected commits`,
        icon: <i className="iconoir-git-fork text-[14px]" aria-hidden="true" />,
        onClick: onCherryPickSelectedCommits,
      });
    }
    if (onRewordCommit && rewordTargetBranch) {
      nextItems.push({
        label: 'Reword commit',
        icon: <i className="iconoir-edit-pencil text-[14px]" aria-hidden="true" />,
        onClick: () => onRewordCommit(node.hash, node.message, node.body ?? '', rewordTargetBranch),
      });
    }

    return nextItems;
  }, [
    isSelected,
    node.body,
    node.hash,
    node.message,
    onCherryPickCommit,
    onCherryPickSelectedCommits,
    onCreateTag,
    onResetToCommit,
    onRevertCommit,
    onRewordCommit,
    rewordTargetBranch,
    selectedCount,
  ]);

  return (
    <ContextMenu items={menuItems}>
      <div
        className={cn(
          'flex items-center hover:bg-base-200 border-b border-base-200 last:border-0 cursor-pointer transition-colors text-xs',
          isSelected && 'bg-primary/10',
        )}
        style={{ height: ROW_HEIGHT }}
        onClick={(event) => onSelectCommit?.(node.hash, {
          isMultiSelect: event.metaKey || event.ctrlKey,
          isRangeSelect: event.shiftKey,
        })}
      >
        <div style={{ width: graphWidth, flexShrink: 0 }} />
        <div className="flex flex-1 items-center gap-4 overflow-hidden pr-4">
          <div className="flex flex-1 items-center gap-2 truncate">
            {processedTags.map((tag) => {
              const tagElement = (
                <span className="relative inline-flex shrink-0">
                  <span
                    className={cn(
                      'text-[10px] px-1.5 rounded-full whitespace-nowrap shrink-0',
                      tag.isCurrent && 'font-bold',
                      tag.hasAssociatedSession && 'pr-4',
                    )}
                    style={{
                      color: tag.textColor,
                      backgroundColor: tag.backgroundColor,
                    }}
                    title={tag.displayName}
                  >
                    <HighlightedText text={tag.displayName} searchQuery={searchQuery} />
                  </span>
                  {tag.hasAssociatedSession && (
                    <SessionAssociationDot className="top-0 right-0.5 z-10" />
                  )}
                </span>
              );

              const branchMenuItems = getBranchTagContextMenuItems?.(tag.primaryRef) || [];
              if (branchMenuItems.length === 0) {
                return <span key={tag.primaryRef} className="shrink-0">{tagElement}</span>;
              }

              return (
                <ContextMenu
                  key={tag.primaryRef}
                  items={branchMenuItems}
                  containerClassName="inline-flex shrink-0"
                >
                  {tagElement}
                </ContextMenu>
              );
            })}
            <span
              className={cn('truncate min-w-0 max-w-[600px]', isSelected && 'font-semibold')}
              title={node.message}
            >
              <HighlightedText text={node.message} searchQuery={searchQuery} />
            </span>
          </div>
          <div className="w-32 truncate opacity-70 text-right">
            <HighlightedText text={node.author_name} searchQuery={searchQuery} />
          </div>
          <div className="w-20 truncate opacity-50 font-mono text-right">
            <HighlightedText text={shortHash} searchQuery={searchQuery} />
          </div>
          <div className="w-32 truncate opacity-70 text-right">
            {formattedDate}
          </div>
        </div>
      </div>
    </ContextMenu>
  );
}, (previousProps, nextProps) => (
  previousProps.row === nextProps.row
  && previousProps.graphWidth === nextProps.graphWidth
  && previousProps.isSelected === nextProps.isSelected
  && previousProps.selectedCount === nextProps.selectedCount
  && previousProps.searchQuery === nextProps.searchQuery
  && previousProps.getBranchTagContextMenuItems === nextProps.getBranchTagContextMenuItems
  && previousProps.onSelectCommit === nextProps.onSelectCommit
  && previousProps.onResetToCommit === nextProps.onResetToCommit
  && previousProps.onRevertCommit === nextProps.onRevertCommit
  && previousProps.onCreateTag === nextProps.onCreateTag
  && previousProps.onCherryPickCommit === nextProps.onCherryPickCommit
  && previousProps.onCherryPickSelectedCommits === nextProps.onCherryPickSelectedCommits
  && previousProps.onRewordCommit === nextProps.onRewordCommit
));

export const GitGraph = forwardRef<GitGraphHandle, GitGraphProps>(function GitGraph({
  commits,
  onSelectCommit,
  onResetToCommit,
  onRevertCommit,
  onCreateTag,
  onCherryPickCommit,
  onCherryPickSelectedCommits,
  onRewordCommit,
  selectedHash,
  selectedHashes,
  onEndReached,
  isLoadingMore,
  currentBranch,
  hiddenBranches,
  localBranches = [],
  trackingInfo,
  getBranchTagContextMenuItems,
  isBranchSessionAssociated,
}, ref) {
  const nodes = useMemo(
    () => generateGraphData(commits, { localBranches }),
    [commits, localBranches],
  );
  const localBranchSet = useMemo(() => new Set(localBranches), [localBranches]);
  const hiddenBranchSet = hiddenBranches ?? EMPTY_HIDDEN_BRANCHES;
  const preparedRows = useMemo<PreparedGraphRow[]>(() => (
    nodes.map((node) => ({
      node,
      shortHash: node.hash.slice(0, 7),
      formattedDate: new Date(node.date).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
      processedTags: buildProcessedTags(
        node,
        hiddenBranchSet,
        localBranchSet,
        trackingInfo,
        currentBranch,
        isBranchSessionAssociated,
      ),
      rewordTargetBranch: resolveRewordTargetBranch(node, localBranchSet, currentBranch),
    }))
  ), [
    currentBranch,
    hiddenBranchSet,
    isBranchSessionAssociated,
    localBranchSet,
    nodes,
    trackingInfo,
  ]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
        event.preventDefault();
        setIsSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      if (event.key === 'Escape' && isSearchOpen) {
        setIsSearchOpen(false);
        setSearchQuery('');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchOpen]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const updateViewport = () => {
      setViewportHeight(container.clientHeight);
    };

    updateViewport();

    const resizeObserver = new ResizeObserver(updateViewport);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const handleCloseSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery('');
  }, []);

  useImperativeHandle(ref, () => ({
    scrollToCommit: (hash: string) => {
      const index = preparedRows.findIndex((row) => row.node.hash === hash);
      if (index === -1 || !scrollRef.current) return false;

      const nextScrollTop =
        index * ROW_HEIGHT - (scrollRef.current.clientHeight / 2) + ROW_HEIGHT / 2;
      scrollRef.current.scrollTop = Math.max(0, nextScrollTop);
      return true;
    },
  }), [preparedRows]);

  const selectedCount = selectedHashes?.size ?? (selectedHash ? 1 : 0);
  const maxLane = useMemo(() => Math.max(...preparedRows.map((row) => row.node.x), 0), [preparedRows]);
  const graphWidth = (maxLane + 1) * LANE_WIDTH + 20;
  const totalHeight = preparedRows.length * ROW_HEIGHT;
  const visibleStartIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  const visibleEndIndex = Math.min(
    preparedRows.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN_ROWS,
  );
  const visibleRows = preparedRows.slice(visibleStartIndex, visibleEndIndex);
  const visibleSvgRows = preparedRows.slice(
    Math.max(0, visibleStartIndex - 1),
    Math.min(preparedRows.length, visibleEndIndex + 1),
  );

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const { scrollTop: nextScrollTop, clientHeight, scrollHeight } = event.currentTarget;
    setScrollTop(nextScrollTop);

    if (scrollHeight - nextScrollTop - clientHeight < 100) {
      onEndReached?.();
    }
  }, [onEndReached]);

  if (preparedRows.length === 0) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white dark:bg-[#161b22] font-mono text-sm select-none">
      {isSearchOpen && (
        <div className="sticky top-0 z-30 bg-white dark:bg-[#161b22] border-b border-base-300 px-2 py-2 flex items-center gap-2">
          <span className="opacity-50">Search</span>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search in commits..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="input input-bordered input-sm flex-1 text-sm"
            autoFocus
          />
          <div className="tooltip tooltip-left z-50" data-tip="Close search (Esc)">
            <button
              onClick={handleCloseSearch}
              className="btn btn-ghost btn-sm btn-square"
            >
              x
            </button>
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex-1 overflow-auto h-full max-w-full px-2"
        onScroll={handleScroll}
      >
        <div className="relative min-w-full" style={{ height: totalHeight }}>
          <svg
            width={graphWidth}
            height={totalHeight}
            className="absolute top-0 left-0 pointer-events-none z-10"
          >
            {visibleSvgRows.map(({ node }) => (
              <g key={node.hash}>
                {node.paths.map((path, pathIndex) => {
                  const x1 = path.x1 * LANE_WIDTH + LANE_WIDTH / 2;
                  const y1 = path.y1 * ROW_HEIGHT + ROW_HEIGHT / 2;
                  const x2 = path.x2 * LANE_WIDTH + LANE_WIDTH / 2;
                  const y2 = path.y2 * ROW_HEIGHT + ROW_HEIGHT / 2;

                  let d = '';
                  if (path.type === 'straight') {
                    d = `M ${x1} ${y1} L ${x2} ${y2}`;
                  } else {
                    const cy1 = y1 + ROW_HEIGHT * 0.5;
                    const cy2 = y2 - ROW_HEIGHT * 0.5;
                    d = `M ${x1} ${y1} C ${x1} ${cy1}, ${x2} ${cy2}, ${x2} ${y2}`;
                  }

                  return (
                    <path
                      key={`${node.hash}-${pathIndex}`}
                      d={d}
                      stroke={path.color}
                      strokeWidth={STROKE_WIDTH}
                      fill="none"
                      strokeLinecap="round"
                    />
                  );
                })}
              </g>
            ))}

            {visibleSvgRows.map(({ node }) => (
              <circle
                key={`dot-${node.hash}`}
                cx={node.x * LANE_WIDTH + LANE_WIDTH / 2}
                cy={node.y * ROW_HEIGHT + ROW_HEIGHT / 2}
                r={DOT_SIZE}
                fill={node.color}
                stroke={node.color}
                strokeWidth={STROKE_WIDTH}
              />
            ))}
          </svg>

          <div
            className="absolute inset-x-0 top-0"
            style={{ transform: `translateY(${visibleStartIndex * ROW_HEIGHT}px)` }}
          >
            {visibleRows.map((row) => (
              <GitGraphRow
                key={row.node.hash}
                row={row}
                graphWidth={graphWidth}
                isSelected={selectedHashes ? selectedHashes.has(row.node.hash) : selectedHash === row.node.hash}
                selectedCount={selectedCount}
                searchQuery={searchQuery}
                onSelectCommit={onSelectCommit}
                onResetToCommit={onResetToCommit}
                onRevertCommit={onRevertCommit}
                onCreateTag={onCreateTag}
                onCherryPickCommit={onCherryPickCommit}
                onCherryPickSelectedCommits={onCherryPickSelectedCommits}
                onRewordCommit={onRewordCommit}
                getBranchTagContextMenuItems={getBranchTagContextMenuItems}
              />
            ))}

            {isLoadingMore && (
              <div className="flex items-center justify-center py-8 border-b border-base-300">
                <span className="loading loading-spinner text-base-content/50"></span>
                <span className="ml-2 text-sm opacity-70">Loading more commits...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
