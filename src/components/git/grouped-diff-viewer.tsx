'use client';

import { cn } from '@/lib/utils';
import ReactDiffViewer from '@alexbruf/react-diff-viewer';
import { computeLineInformation, DiffType, LineInformation } from '@alexbruf/react-diff-viewer/compute-lines';
import '@alexbruf/react-diff-viewer/index.css';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

interface GroupedDiffViewerProps {
  oldValue: string;
  newValue: string;
  splitView: boolean;
  useDarkTheme?: boolean;
  linesOffset?: number;
  showDiffOnly?: boolean;
  extraLinesSurroundingDiff?: number;
}

type InlineEntry =
  | { type: 'line'; line: LineInformation; sourceIndex: number }
  | { type: 'fold'; foldStartIndex: number; totalLines: number };

interface InlineRow {
  key: string;
  type: DiffType;
  leftLineNumber: number | null;
  rightLineNumber: number | null;
  value: string;
}

const NO_EXPANDED_BLOCKS: number[] = [];

function isPairedReplacement(line: LineInformation): boolean {
  return line.left?.type === DiffType.REMOVED && line.right?.type === DiffType.ADDED;
}

function getLineText(value: unknown): string {
  if (typeof value === 'string') {
    return value.length > 0 ? value : ' ';
  }
  return ' ';
}

function toInlineRow(line: LineInformation, sourceIndex: number): InlineRow {
  const left = line.left ?? {};
  const right = line.right ?? {};

  if (left.type === DiffType.REMOVED) {
    return {
      key: `line-${sourceIndex}-removed`,
      type: DiffType.REMOVED,
      leftLineNumber: left.lineNumber ?? null,
      rightLineNumber: null,
      value: getLineText(left.value),
    };
  }

  if (right.type === DiffType.ADDED) {
    return {
      key: `line-${sourceIndex}-added`,
      type: DiffType.ADDED,
      leftLineNumber: null,
      rightLineNumber: right.lineNumber ?? null,
      value: getLineText(right.value),
    };
  }

  return {
    key: `line-${sourceIndex}-default`,
    type: DiffType.DEFAULT,
    leftLineNumber: left.lineNumber ?? null,
    rightLineNumber: right.lineNumber ?? null,
    value: getLineText(left.value ?? right.value),
  };
}

function renderInlineRow(row: InlineRow) {
  const isAdded = row.type === DiffType.ADDED;
  const isRemoved = row.type === DiffType.REMOVED;

  return (
    <tr key={row.key} className="line">
      <td
        className={cn('gutter', {
          'empty-gutter': row.leftLineNumber === null,
          'diff-added': isAdded,
          'diff-removed': isRemoved,
        })}
      >
        <pre className="line-number">{row.leftLineNumber ?? ''}</pre>
      </td>
      <td
        className={cn('gutter', {
          'empty-gutter': row.rightLineNumber === null,
          'diff-added': isAdded,
          'diff-removed': isRemoved,
        })}
      >
        <pre className="line-number">{row.rightLineNumber ?? ''}</pre>
      </td>
      <td
        className={cn('marker', {
          'diff-added': isAdded,
          'diff-removed': isRemoved,
        })}
      >
        <pre>{isAdded ? '+' : isRemoved ? '-' : ''}</pre>
      </td>
      <td
        className={cn('content', {
          'diff-added': isAdded,
          'diff-removed': isRemoved,
        })}
      >
        <pre className="content-text">{row.value}</pre>
      </td>
    </tr>
  );
}

function GroupedInlineDiff({
  oldValue,
  newValue,
  useDarkTheme = false,
  linesOffset = 0,
  showDiffOnly = true,
  extraLinesSurroundingDiff = 3,
}: Omit<GroupedDiffViewerProps, 'splitView'>) {
  const [expandedByDiff, setExpandedByDiff] = useState<{ signature: string; blocks: number[] }>({
    signature: '',
    blocks: [],
  });

  const diffSignature = useMemo(
    () => `${linesOffset}:${showDiffOnly ? 1 : 0}:${extraLinesSurroundingDiff}:${oldValue}\0${newValue}`,
    [oldValue, newValue, linesOffset, showDiffOnly, extraLinesSurroundingDiff]
  );

  const expandedBlocks = useMemo(
    () =>
      expandedByDiff.signature === diffSignature
        ? expandedByDiff.blocks
        : NO_EXPANDED_BLOCKS,
    [expandedByDiff, diffSignature]
  );

  const { lineInformation } = useMemo(
    () => computeLineInformation(oldValue, newValue, true, undefined, linesOffset),
    [oldValue, newValue, linesOffset]
  );

  // Compute changed-row indexes from rendered line data because upstream diffLines
  // counters can drift for paired removed+added rows.
  const changedLineIndexes = useMemo(() => {
    const changedIndexes: number[] = [];
    lineInformation.forEach((line: LineInformation, sourceIndex: number) => {
      if (line.left?.type !== DiffType.DEFAULT || line.right?.type !== DiffType.DEFAULT) {
        changedIndexes.push(sourceIndex);
      }
    });
    return changedIndexes;
  }, [lineInformation]);

  const entries = useMemo<InlineEntry[]>(() => {
    if (lineInformation.length === 0) return [];

    if (!showDiffOnly || changedLineIndexes.length === 0) {
      return lineInformation.map((line: LineInformation, sourceIndex: number) => ({ type: 'line', line, sourceIndex }));
    }

    const contextSize = Math.max(0, extraLinesSurroundingDiff);
    const visible = Array.from({ length: lineInformation.length }, () => false);

    changedLineIndexes.forEach((changedIndex) => {
      const start = Math.max(0, changedIndex - contextSize);
      const end = Math.min(lineInformation.length - 1, changedIndex + contextSize);
      for (let index = start; index <= end; index += 1) {
        visible[index] = true;
      }
    });

    for (let index = 0; index < visible.length; index += 1) {
      if (visible[index]) continue;
      const foldStartIndex = index;
      while (index < visible.length && !visible[index]) {
        index += 1;
      }
      if (expandedBlocks.includes(foldStartIndex)) {
        for (let expandedIndex = foldStartIndex; expandedIndex < index; expandedIndex += 1) {
          visible[expandedIndex] = true;
        }
      }
      index -= 1;
    }

    const nextEntries: InlineEntry[] = [];
    for (let index = 0; index < visible.length; index += 1) {
      if (visible[index]) {
        nextEntries.push({
          type: 'line',
          line: lineInformation[index],
          sourceIndex: index,
        });
        continue;
      }

      const foldStartIndex = index;
      while (index < visible.length && !visible[index]) {
        index += 1;
      }
      nextEntries.push({
        type: 'fold',
        foldStartIndex,
        totalLines: index - foldStartIndex,
      });
      index -= 1;
    }

    return nextEntries;
  }, [lineInformation, changedLineIndexes, showDiffOnly, extraLinesSurroundingDiff, expandedBlocks]);

  const rows = useMemo(() => {
    const renderedRows: ReactNode[] = [];

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry.type === 'fold') {
        renderedRows.push(
          <tr key={`fold-${entry.foldStartIndex}`} className="code-fold">
            <td className="code-fold-gutter" />
            <td className="code-fold-gutter" />
            <td />
            <td>
              <button
                type="button"
                className="cursor-pointer underline"
                onClick={() => {
                  setExpandedByDiff((previous) => {
                    const currentBlocks =
                      previous.signature === diffSignature ? previous.blocks : [];
                    if (currentBlocks.includes(entry.foldStartIndex)) {
                      return previous.signature === diffSignature
                        ? previous
                        : { signature: diffSignature, blocks: currentBlocks };
                    }
                    return {
                      signature: diffSignature,
                      blocks: [...currentBlocks, entry.foldStartIndex],
                    };
                  });
                }}
              >
                <pre className="code-fold-content">Expand {entry.totalLines} lines ...</pre>
              </button>
            </td>
          </tr>
        );
        continue;
      }

      if (isPairedReplacement(entry.line)) {
        const removedRows: InlineRow[] = [];
        const addedRows: InlineRow[] = [];
        let pairedIndex = index;

        while (pairedIndex < entries.length) {
          const candidate = entries[pairedIndex];
          if (candidate.type !== 'line' || !isPairedReplacement(candidate.line)) {
            break;
          }
          removedRows.push({
            key: `line-${candidate.sourceIndex}-paired-removed`,
            type: DiffType.REMOVED,
            leftLineNumber: candidate.line.left?.lineNumber ?? null,
            rightLineNumber: null,
            value: getLineText(candidate.line.left?.value),
          });
          addedRows.push({
            key: `line-${candidate.sourceIndex}-paired-added`,
            type: DiffType.ADDED,
            leftLineNumber: null,
            rightLineNumber: candidate.line.right?.lineNumber ?? null,
            value: getLineText(candidate.line.right?.value),
          });
          pairedIndex += 1;
        }

        removedRows.forEach((row) => {
          renderedRows.push(renderInlineRow(row));
        });
        addedRows.forEach((row) => {
          renderedRows.push(renderInlineRow(row));
        });

        index = pairedIndex - 1;
        continue;
      }

      renderedRows.push(renderInlineRow(toInlineRow(entry.line, entry.sourceIndex)));
    }

    return renderedRows;
  }, [entries, diffSignature]);

  return (
    <table className={cn('diff-container', useDarkTheme ? 'dark-theme' : 'light-theme')}>
      <tbody>{rows}</tbody>
    </table>
  );
}

export function GroupedDiffViewer({
  oldValue,
  newValue,
  splitView,
  useDarkTheme = false,
  linesOffset = 0,
  showDiffOnly = true,
  extraLinesSurroundingDiff = 3,
}: GroupedDiffViewerProps) {
  if (splitView) {
    return (
      <div className="diff-viewer-wrapper">
        <ReactDiffViewer
          oldValue={oldValue}
          newValue={newValue}
          splitView={true}
          useDarkTheme={useDarkTheme}
          disableWordDiff={true}
        />
      </div>
    );
  }

  return (
    <div className="diff-viewer-wrapper">
      <GroupedInlineDiff
        oldValue={oldValue}
        newValue={newValue}
        useDarkTheme={useDarkTheme}
        linesOffset={linesOffset}
        showDiffOnly={showDiffOnly}
        extraLinesSurroundingDiff={extraLinesSurroundingDiff}
      />
    </div>
  );
}
