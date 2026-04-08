'use client';

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AlertCircle, Clock3, FolderOpen, Loader2, Paperclip, PlayCircle, Send, Square, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import SyntaxHighlighter from 'react-syntax-highlighter';
import remarkGfm from 'remark-gfm';
import { listInstalledAgentSkills, listRepoFiles } from '@/app/actions/git';
import {
  createOptimisticUserMessage,
  reconcileOptimisticUserMessages,
  type OptimisticUserMessage,
} from '@/lib/optimistic-user-history';
import { parseAgentStartupHistoryEntry } from '@/lib/agent-startup-history';
import { normalizePlanStepStatus, parsePlanStepsFromText, parsePlanStepsFromToolInput } from '@/lib/agent/plan';
import {
  AGENT_SESSION_CODE_BLOCK_CLASSNAME,
  AGENT_SESSION_PANE_CLASSNAME,
  AGENT_SESSION_TIMELINE_CLASSNAME,
} from '@/lib/agent-session-pane-styles';
import { getCodexModelOptions } from '@/lib/agent/transports/codex-models';
import { projectSessionHistoryEvent } from '@/lib/agent/session-history-events';
import { normalizeProviderReasoningEffort } from '@/lib/agent/reasoning';
import { buildPendingAssistantItem } from '@/lib/agent/pending-assistant';
import { normalizeMarkdownLists } from '@/lib/markdown';
import { getBaseName } from '@/lib/path';
import { buildRepoMentionSuggestions } from '@/lib/repo-mention-suggestions';
import {
  buildSessionCanvasAutoStartKey,
  claimSessionCanvasAutoStart,
  releaseSessionCanvasAutoStart,
  shouldReleaseSessionCanvasAgentSendLock,
} from '@/lib/session-canvas-agent';
import { getModelReasoningEffortOptions, resolveReasoningEffortSelection } from '@/lib/session-reasoning';
import { buildSkillMentionSuggestions } from '@/lib/skill-mention-suggestions';
import {
  type ActiveMention,
  findActiveMention,
  replaceActiveMention,
} from '@/lib/task-description-mentions';
import { uploadAttachments } from '@/lib/upload-attachments';
import { usePageVisibility } from '@/hooks/usePageVisibility';
import type {
  AgentProvider,
  ChatStreamEvent,
  ReasoningEffort,
  PlanStep,
  SessionAgentHistoryItem,
  SessionAgentRunState,
  SessionAgentRuntimeState,
} from '@/lib/types';

type SessionSnapshotResponse = {
  metadata: {
    sessionName: string;
    projectPath: string;
    workspacePath: string;
    agentProvider?: AgentProvider;
    model: string;
    reasoningEffort?: string;
  };
  runtime: SessionAgentRuntimeState;
  history: SessionAgentHistoryItem[];
  historyPage?: {
    hasOlder: boolean;
    oldestLoadedOrdinal: number | null;
  };
};

type AgentSocketPayload = {
  type: 'session-agent-event';
  sessionId: string;
  snapshot: SessionAgentRuntimeState;
  event: ChatStreamEvent;
  timestamp: string;
};

type SendMessageResponse = {
  success: boolean;
  runtime?: SessionAgentRuntimeState | null;
  error?: string;
};

const DUPLICATE_TURN_ERROR = 'A turn is already running for this session.';

export type AgentSessionPaneHandle = {
  focusComposer: () => void;
  insertText: (text: string) => boolean;
  setReasoningEffort: (effort: string) => boolean;
  openAgentDetails: () => void;
  cancelActiveTurn: () => Promise<void>;
  refreshSnapshot: () => Promise<void>;
};

export type AgentSessionHeaderMeta = {
  providerId: AgentProvider | null;
  providerName: string;
  model: string;
  runState: SessionAgentRunState | 'idle';
  socketConnected: boolean;
  threadId: string | null;
  reasoningEffort: string | null;
  reasoningEffortOptions: ReasoningEffort[];
  effectiveReasoningEffort: string | null;
  hasPendingReasoningChange: boolean;
  workspacePath: string;
  canCancel: boolean;
  isCancelling: boolean;
  lastActivityAt: string | null;
  lastError: string | null;
};

type AgentSessionPaneProps = {
  sessionId: string;
  workspacePath: string;
  initialSnapshot?: SessionSnapshotResponse | null;
  autoStartMessage?: string | null;
  onFeedback?: (message: string) => void;
  onHeaderMetaChange?: (meta: AgentSessionHeaderMeta) => void;
  onRequestAddFiles?: () => void;
  isAddingFiles?: boolean;
  isMobileViewport?: boolean;
};

type PendingMessage = {
  id: string;
  text: string;
  attachmentPaths: string[];
  displayText: string;
};

const COMPOSER_MAX_HEIGHT = 112;
const INITIAL_HISTORY_PAGE_SIZE = 300;
const OLDER_HISTORY_PAGE_SIZE = 200;
const ACTIVE_TURN_REFRESH_INTERVAL_MS = 15_000;
const SOCKET_IDLE_REFRESH_THRESHOLD_MS = 90_000;
const POSSIBLE_STALE_THRESHOLD_MS = 5 * 60_000;
const TIMELINE_BOTTOM_STICK_THRESHOLD_PX = 48;

const PROVIDER_LABELS: Record<string, string> = {
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  cursor: 'Cursor Agent CLI',
};

function providerLabel(provider: string | null | undefined) {
  if (!provider) return 'Agent';
  return PROVIDER_LABELS[provider] || provider;
}

function runStateTone(runState: SessionAgentRunState | null | undefined) {
  switch (runState) {
    case 'running':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200';
    case 'queued':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200';
    case 'completed':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200';
    case 'cancelled':
      return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-200';
    case 'error':
      return 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200';
    case 'needs_auth':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-[color:var(--app-dark-border-subtle)] dark:bg-[color:var(--app-dark-panel)] dark:text-slate-300';
  }
}

function formatRunState(runState: SessionAgentRunState | null | undefined) {
  if (!runState) return 'idle';
  return runState.replace(/_/g, ' ');
}

function trimEmpty(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : '';
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function formatDuration(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '';
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 10_000) return `${(value / 1000).toFixed(1)}s`;
  if (value < 60_000) return `${Math.round(value / 1000)}s`;
  return `${(value / 60_000).toFixed(1)}m`;
}

function diagnosticStepTone(status: string) {
  switch (status) {
    case 'completed':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200';
    case 'failed':
      return 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200';
    case 'running':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300';
  }
}

function planStepTone(status: string) {
  switch (normalizePlanStepStatus(status)) {
    case 'completed':
      return 'border-emerald-200 bg-emerald-50/90 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200';
    case 'in_progress':
      return 'border-amber-200 bg-amber-50/90 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200';
    case 'failed':
      return 'border-red-200 bg-red-50/90 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200';
    case 'cancelled':
      return 'border-slate-200 bg-slate-50/90 text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300';
    default:
      return 'border-amber-200 bg-amber-50/90 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200';
  }
}

function planStepMarkerTone(status: string) {
  switch (normalizePlanStepStatus(status)) {
    case 'completed':
      return 'bg-emerald-500';
    case 'in_progress':
      return 'bg-primary';
    case 'failed':
      return 'bg-red-500';
    case 'cancelled':
      return 'bg-slate-400';
    default:
      return 'bg-amber-400';
  }
}

function formatPlanStepStatus(status: string) {
  return normalizePlanStepStatus(status).replace(/_/g, ' ');
}

function getPlanSteps(item: Extract<SessionAgentHistoryItem, { kind: 'plan' }>) {
  if (item.steps && item.steps.length > 0) {
    return item.steps;
  }

  return parsePlanStepsFromText(item.text);
}

function getRenderablePlanSteps(
  item: Extract<SessionAgentHistoryItem, { kind: 'plan' }>,
  fallbackSteps?: PlanStep[],
) {
  const steps = getPlanSteps(item);
  if (steps.length > 0) {
    return steps;
  }

  return fallbackSteps ?? [];
}

function codeBlock(value: string | null | undefined) {
  const text = trimEmpty(value);
  if (!text) return null;
  return (
    <pre className={AGENT_SESSION_CODE_BLOCK_CLASSNAME}>
      {text}
    </pre>
  );
}

function firstLinePreview(value: string | null | undefined) {
  const text = trimEmpty(value);
  if (!text) return '';

  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  return firstLine || '';
}

function formatToolDisplayName(value: string | null | undefined) {
  const text = trimEmpty(value);
  if (!text) return 'unknown';
  const normalized = text.replace(/\s*\{\s*$/, '').trim();
  return normalized || text;
}

function formatToolPreview(value: string | null | undefined) {
  const preview = firstLinePreview(value);
  if (!preview) return '';
  const normalized = preview.replace(/\s*\{\s*$/, '').trim();
  return normalized;
}

function stripMarkdownSyntax(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(/^\s{0,3}(#{1,6}|\d+\.\s|[-+*]\s|>\s)/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function plainTextPreview(value: string | null | undefined) {
  const preview = firstLinePreview(value);
  return preview ? stripMarkdownSyntax(preview) : '';
}

function formatAttachmentSummary(attachmentPaths: string[]) {
  if (attachmentPaths.length === 0) return '';
  return `Attached ${attachmentPaths.length} file${attachmentPaths.length === 1 ? '' : 's'}.`;
}

function buildDisplayMessage(message: string, attachmentPaths: string[]) {
  if (message) return message;
  return formatAttachmentSummary(attachmentPaths);
}

function buildPendingMessageDisplayText(message: string, attachmentPaths: string[]) {
  const attachmentSummary = formatAttachmentSummary(attachmentPaths);
  if (!message) return attachmentSummary;
  if (!attachmentSummary) return message;
  return `${message}\n\n${attachmentSummary}`;
}

function getClipboardImageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];

  const files: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) {
      files.push(file);
    }
  }
  return files;
}

function MarkdownMessage({ value }: { value: string | null | undefined }) {
  const text = normalizeMarkdownLists(trimEmpty(value));
  if (!text) return null;

  return (
    <div className="markdown-message min-w-0 max-w-full overflow-x-hidden break-words text-sm leading-7">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="mb-3 text-lg font-semibold last:mb-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-3 text-base font-semibold last:mb-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 text-sm font-semibold last:mb-0">{children}</h3>,
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="mb-3 border-l-2 border-slate-300 pl-4 italic text-slate-600 last:mb-0 dark:border-slate-600 dark:text-slate-300">
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
          table: ({ children }) => (
            <div className="mb-3 max-w-full overflow-x-hidden last:mb-0">
              <table className="w-full table-fixed border-collapse text-left text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="border-b border-slate-300 dark:border-slate-600">{children}</thead>,
          th: ({ children }) => <th className="break-words px-3 py-2 font-semibold">{children}</th>,
          td: ({ children }) => <td className="border-b border-slate-200 px-3 py-2 align-top break-words dark:border-slate-700">{children}</td>,
          hr: () => <hr className="my-4 border-slate-300 dark:border-slate-600" />,
          code: ({ className, children }) => {
            const textContent = String(children).replace(/\n$/, '');
            const isBlock = Boolean(className) || textContent.includes('\n');
            const language = /language-([\w-]+)/.exec(className || '')?.[1];

            if (isBlock) {
              return (
                <SyntaxHighlighter
                  language={language}
                  useInlineStyles={false}
                  customStyle={{
                    margin: 0,
                    borderRadius: '0.5rem',
                    fontSize: '11px',
                    lineHeight: 1.6,
                  }}
                >
                  {textContent}
                </SyntaxHighlighter>
              );
            }

            return (
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.9em] text-slate-800 app-dark-surface-raised app-dark-text">
                {textContent}
              </code>
            );
          },
          pre: ({ children }) => <div className="mb-3 last:mb-0">{children}</div>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

type CollapsibleHistoryItemProps = {
  itemId: string;
  label: string;
  title?: string;
  className: string;
  summaryClassName: string;
  labelClassName: string;
  titleClassName: string;
  timestamp?: string;
  timestampClassName: string;
  isOpen: boolean;
  onToggle: (itemId: string, open: boolean) => void;
  children: React.ReactNode;
};

function renderCollapsibleHistoryItem({
  itemId,
  label,
  title,
  className,
  summaryClassName,
  labelClassName,
  titleClassName,
  timestamp,
  timestampClassName,
  isOpen,
  onToggle,
  children,
}: CollapsibleHistoryItemProps) {
  const summaryTitle = title ? `${label}: ${title}` : label;

  return (
    <details
      open={isOpen}
      className={`min-w-0 overflow-hidden ${className}`}
      onToggle={(event) => {
        onToggle(itemId, event.currentTarget.open);
      }}
    >
      <summary className={summaryClassName} title={summaryTitle}>
        <span className={labelClassName}>{label}</span>
        {title ? <span className={titleClassName}>{title}</span> : null}
      </summary>
      <div className="mt-2 space-y-2.5">
        {children}
      </div>
      {timestamp ? <div className={timestampClassName}>{timestamp}</div> : null}
    </details>
  );
}

function renderHistoryItem(item: SessionAgentHistoryItem, options: RenderHistoryItemOptions = {}) {
  const timestamp = formatTimestamp(item.updatedAt || item.createdAt);
  const isExpanded = Boolean(options.expandedItems?.[item.id]);
  const handleToggleExpanded = options.onToggleExpanded ?? (() => {});

  switch (item.kind) {
    case 'user': {
      const startupPrompt = parseAgentStartupHistoryEntry(item.text);
      return (
        <div className="flex min-w-0 justify-end">
          <div className={`min-w-0 max-w-[85%] overflow-hidden rounded-2xl rounded-br-md bg-amber-100 px-4 py-3 text-sm text-amber-950 shadow-sm dark:bg-amber-500/14 dark:text-amber-50 ${options.pulse ? 'animate-pulse' : ''}`}>
            {options.status ? (
              <div className="mb-2 flex items-center justify-end">
                <span className="rounded-full border border-amber-300/80 bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:border-amber-300/20 dark:bg-amber-950/40 dark:text-amber-100">
                  {options.status}
                </span>
              </div>
            ) : null}
            {startupPrompt ? (
              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700/80 dark:text-amber-100/80">
                    Task
                  </div>
                  <div className="whitespace-pre-wrap break-words">{startupPrompt.task}</div>
                </div>
                <details
                  open={isExpanded}
                  className="rounded-xl border border-amber-300/70 bg-white/55 px-3 py-2 dark:border-amber-300/20 dark:bg-amber-950/30"
                  onToggle={(event) => {
                    handleToggleExpanded(item.id, event.currentTarget.open);
                  }}
                >
                  <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-100/85">
                    System instructions
                  </summary>
                  <div className="mt-2 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-amber-900/90 dark:text-amber-50/90">
                    {startupPrompt.instructions}
                  </div>
                </details>
              </div>
            ) : (
              <div className="whitespace-pre-wrap break-words">{item.text}</div>
            )}
            {timestamp ? <div className="mt-2 text-[10px] text-amber-700/80 dark:text-amber-100/70">{timestamp}</div> : null}
          </div>
        </div>
      );
    }
    case 'assistant':
      const assistantStatus = options.status ?? item.itemStatus ?? null;
      const assistantPulse = options.pulse || assistantStatus === 'pending';
      return (
        <div className={`min-w-0 overflow-hidden px-1 py-1 text-sm text-slate-800 dark:text-slate-100 ${assistantPulse ? 'animate-pulse' : ''}`}>
          {assistantStatus ? (
            <div className="mb-2 flex items-center">
              <span className="rounded-full border border-slate-200/80 bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300">
                {assistantStatus}
              </span>
            </div>
          ) : null}
          {item.phase ? (
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {item.phase}
            </div>
          ) : null}
          <MarkdownMessage value={item.text || ' '} />
          {timestamp ? <div className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">{timestamp}</div> : null}
        </div>
      );
    case 'reasoning':
      return renderCollapsibleHistoryItem({
        itemId: item.id,
        label: 'Reasoning',
        title: plainTextPreview(item.summary) || plainTextPreview(item.text) || undefined,
        className: 'rounded-xl border border-amber-200/70 bg-amber-50/55 px-3 py-2 text-sm text-amber-950 dark:border-[rgba(201,143,98,0.18)] dark:bg-[rgba(201,143,98,0.10)] dark:text-[var(--app-dark-text-primary)]',
        summaryClassName: 'flex min-w-0 items-baseline gap-2 cursor-pointer list-none',
        labelClassName: 'shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800 dark:text-[var(--app-dark-accent)]',
        titleClassName: 'min-w-0 truncate whitespace-nowrap text-[11px] font-normal text-amber-800/80 dark:text-[var(--app-dark-text-muted)]',
        timestamp,
        timestampClassName: 'mt-2 text-[10px] text-amber-800/70 dark:text-[var(--app-dark-text-muted)]',
        isOpen: isExpanded,
        onToggle: handleToggleExpanded,
        children: (
          <>
            {trimEmpty(item.summary) ? (
              <div className="font-medium">
                <MarkdownMessage value={item.summary} />
              </div>
            ) : null}
            {trimEmpty(item.text) ? (
              <div className="opacity-90">
                <MarkdownMessage value={item.text} />
              </div>
            ) : null}
          </>
        ),
      });
    case 'plan': {
      const steps = getRenderablePlanSteps(item, options.planFallbackStepsById?.[item.id]);
      const completedCount = steps.filter((step) => normalizePlanStepStatus(step.status) === 'completed').length;
      const inProgressCount = steps.filter((step) => normalizePlanStepStatus(step.status) === 'in_progress').length;
      const pendingCount = steps.filter((step) => normalizePlanStepStatus(step.status) === 'pending').length;
      return (
        <div className="rounded-2xl border border-amber-200/70 bg-amber-50/55 px-4 py-3 text-sm text-amber-950 shadow-sm dark:border-[rgba(201,143,98,0.18)] dark:bg-[rgba(201,143,98,0.08)] dark:text-[var(--app-dark-text-primary)]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-[var(--app-dark-accent)]">Plan</div>
            {steps.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-amber-800/80 dark:text-[var(--app-dark-text-muted)]">
                <span className="rounded-full border border-amber-200 bg-white/80 px-2 py-0.5 font-semibold dark:border-[rgba(201,143,98,0.18)] dark:bg-[rgba(42,39,38,0.92)] dark:text-[var(--app-dark-text-primary)]">
                  {completedCount}/{steps.length} completed
                </span>
                {inProgressCount > 0 ? <span>{inProgressCount} active</span> : null}
                {pendingCount > 0 ? <span>{pendingCount} pending</span> : null}
              </div>
            ) : null}
          </div>
          {steps.length > 0 ? (
            <div className="space-y-2">
              {steps.map((step, index) => {
                const normalizedStatus = normalizePlanStepStatus(step.status);
                const isCompleted = normalizedStatus === 'completed';
                return (
                  <div
                    key={`${item.id}-${index}-${step.title}`}
                    className="flex items-start gap-3 rounded-xl border border-amber-200/70 bg-white/80 px-3 py-2 dark:border-[rgba(201,143,98,0.16)] dark:bg-[rgba(42,39,38,0.92)]"
                  >
                    <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${planStepMarkerTone(normalizedStatus)}`} />
                    <div className="min-w-0 flex-1">
                      <div className={`break-words ${isCompleted ? 'text-amber-900/70 line-through dark:text-[var(--app-dark-text-muted)]' : 'text-amber-950 dark:text-[var(--app-dark-text-primary)]'}`}>
                        {step.title}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${planStepTone(normalizedStatus)}`}>
                      {formatPlanStepStatus(normalizedStatus)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="whitespace-pre-wrap break-words">{item.text}</div>
          )}
          {timestamp ? <div className="mt-3 text-[10px] text-amber-800/70 dark:text-[var(--app-dark-text-muted)]">{timestamp}</div> : null}
        </div>
      );
    }
    case 'command':
      return renderCollapsibleHistoryItem({
        itemId: item.id,
        label: 'Command',
        title: firstLinePreview(item.command) || undefined,
        className: 'rounded-xl bg-slate-50/65 px-3 py-2 text-sm app-dark-surface',
        summaryClassName: 'flex min-w-0 items-baseline gap-2 cursor-pointer list-none',
        labelClassName: 'shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-300',
        titleClassName: 'min-w-0 truncate whitespace-nowrap font-mono text-[11px] font-normal text-slate-500 dark:text-slate-400',
        timestamp,
        timestampClassName: 'mt-2 text-[10px] text-slate-400 dark:text-slate-500',
        isOpen: isExpanded,
        onToggle: handleToggleExpanded,
        children: (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${runStateTone(item.status)}`}>
                {formatRunState(item.status)}
              </span>
              {item.exitCode !== null ? (
                <span className="text-[10px] text-slate-500 dark:text-slate-400">exit {item.exitCode}</span>
              ) : null}
            </div>
            <div className="rounded-md bg-slate-100 px-2.5 py-1.5 font-mono text-[11px] text-slate-800 app-dark-surface-raised">
              {item.command}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">cwd: {item.cwd || '.'}</div>
            {codeBlock(item.output)}
          </>
        ),
      });
    case 'tool': {
      const toolName = formatToolDisplayName(item.tool);
      const toolTitle = formatToolPreview(item.message)
        || formatToolPreview(item.input)
        || formatToolPreview(item.result)
        || undefined;

      return renderCollapsibleHistoryItem({
        itemId: item.id,
        label: `Tool: ${toolName}`,
        title: toolTitle,
        className: 'rounded-xl bg-slate-50/65 px-3 py-2 text-sm app-dark-surface',
        summaryClassName: 'flex min-w-0 items-baseline gap-2 cursor-pointer list-none',
        labelClassName: 'shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-300',
        titleClassName: 'min-w-0 truncate whitespace-nowrap text-[11px] font-normal text-slate-500 dark:text-slate-400',
        timestamp,
        timestampClassName: 'mt-2 text-[10px] text-slate-400 dark:text-slate-500',
        isOpen: isExpanded,
        onToggle: handleToggleExpanded,
        children: (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${runStateTone(item.status)}`}>
                {formatRunState(item.status)}
              </span>
            </div>
            <div className="grid gap-2 text-[11px] text-slate-500 dark:text-slate-400 sm:grid-cols-2">
              <div>source: {item.source}</div>
              <div>{item.server ? `server: ${item.server}` : 'server: n/a'}</div>
            </div>
            {trimEmpty(item.message) ? <div className="whitespace-pre-wrap break-words">{item.message}</div> : null}
            {item.input ? <div><div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Input</div>{codeBlock(item.input)}</div> : null}
            {item.result ? <div><div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Result</div>{codeBlock(item.result)}</div> : null}
            {item.error ? <div><div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-red-500 dark:text-red-300">Error</div>{codeBlock(item.error)}</div> : null}
          </>
        ),
      });
    }
    case 'fileChange':
      return renderCollapsibleHistoryItem({
        itemId: item.id,
        label: 'File Changes',
        title: item.changes[0]?.path?.trim()
          ? (item.changes.length > 1
            ? `${item.changes[0].path.trim()} +${item.changes.length - 1} more`
            : item.changes[0].path.trim())
          : (item.changes.length > 0 ? `${item.changes.length} files` : undefined),
        className: 'rounded-xl bg-emerald-50/50 px-3 py-2 text-sm text-emerald-950 dark:bg-emerald-500/8 dark:text-emerald-100',
        summaryClassName: 'flex min-w-0 items-baseline gap-2 cursor-pointer list-none',
        labelClassName: 'shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-200',
        titleClassName: 'min-w-0 truncate whitespace-nowrap text-[11px] font-normal text-emerald-700/75 dark:text-emerald-200/75',
        timestamp,
        timestampClassName: 'mt-2 text-[10px] text-emerald-700/65 dark:text-emerald-200/65',
        isOpen: isExpanded,
        onToggle: handleToggleExpanded,
        children: (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${runStateTone(item.status)}`}>
                {formatRunState(item.status)}
              </span>
              <span className="text-[11px] opacity-80">
                {item.changes.length} file{item.changes.length === 1 ? '' : 's'}
              </span>
            </div>
            {item.changes.length > 0 ? (
              <div className="space-y-2">
                {item.changes.map((change) => (
                  <div key={`${item.id}-${change.path}`} className="rounded-md border border-emerald-200/80 bg-white/80 px-2.5 py-2 text-[11px] dark:border-emerald-500/20 dark:bg-emerald-950/20">
                    <div className="font-mono">{change.path}</div>
                    <div className="mt-1 uppercase tracking-wide opacity-70">{change.kind}</div>
                    {codeBlock(change.diff)}
                  </div>
                ))}
              </div>
            ) : null}
            {trimEmpty(item.output) ? codeBlock(item.output) : null}
          </>
        ),
      });
    default:
      return null;
  }
}

function createPendingMessage(text: string, attachmentPaths: string[]): PendingMessage {
  const normalizedAttachments = Array.from(new Set(attachmentPaths.map((entry) => entry.trim()).filter(Boolean)));
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    attachmentPaths: normalizedAttachments,
    displayText: buildPendingMessageDisplayText(text, normalizedAttachments),
  };
}

type MeasuredHistoryRowProps = {
  item: SessionAgentHistoryItem;
  expandedItems: Record<string, boolean>;
  onToggleExpanded: (itemId: string, open: boolean) => void;
  planFallbackStepsById: Record<string, PlanStep[]>;
};

type RenderHistoryItemOptions = {
  status?: string | null;
  pulse?: boolean;
  expandedItems?: Record<string, boolean>;
  onToggleExpanded?: (itemId: string, open: boolean) => void;
  planFallbackStepsById?: Record<string, PlanStep[]>;
};

function MeasuredHistoryRow({ item, expandedItems, onToggleExpanded, planFallbackStepsById }: MeasuredHistoryRowProps) {
  return (
    <div className="min-w-0 max-w-full">
      {renderHistoryItem(item, {
        ...(item.itemStatus === 'sending' ? { status: 'sending', pulse: true } : {}),
        expandedItems,
        onToggleExpanded,
        planFallbackStepsById,
      })}
    </div>
  );
}

const MemoizedMeasuredHistoryRow = React.memo(MeasuredHistoryRow, (previous, next) => {
  if (previous.item.id !== next.item.id) {
    return false;
  }

  const previousExpanded = Boolean(previous.expandedItems[previous.item.id]);
  const nextExpanded = Boolean(next.expandedItems[next.item.id]);
  if (previousExpanded !== nextExpanded) {
    return false;
  }

  return previous.item.updatedAt === next.item.updatedAt
    && previous.item.itemStatus === next.item.itemStatus
    && previous.planFallbackStepsById[previous.item.id] === next.planFallbackStepsById[next.item.id];
});

type HistoryPageState = {
  hasOlder: boolean;
  oldestLoadedOrdinal: number | null;
};

function buildHistoryPageState(payload?: SessionSnapshotResponse['historyPage']): HistoryPageState {
  return {
    hasOlder: payload?.hasOlder ?? false,
    oldestLoadedOrdinal: payload?.oldestLoadedOrdinal ?? null,
  };
}

function sortHistoryItemsForDisplay(items: SessionAgentHistoryItem[]): SessionAgentHistoryItem[] {
  return [...items].sort((left, right) => (
    left.ordinal - right.ordinal
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id)
  ));
}

function mergeHistoryWindow(
  current: SessionAgentHistoryItem[],
  incoming: SessionAgentHistoryItem[],
): SessionAgentHistoryItem[] {
  if (current.length === 0) {
    return incoming;
  }
  if (incoming.length === 0) {
    return current;
  }

  const oldestIncomingOrdinal = incoming[0]?.ordinal ?? 0;
  const preservedOlder = current.filter((item) => item.ordinal < oldestIncomingOrdinal);
  return sortHistoryItemsForDisplay([...preservedOlder, ...incoming]);
}

function prependOlderHistory(
  current: SessionAgentHistoryItem[],
  older: SessionAgentHistoryItem[],
): SessionAgentHistoryItem[] {
  if (older.length === 0) {
    return current;
  }

  const merged = new Map<string, SessionAgentHistoryItem>();
  for (const item of [...older, ...current]) {
    merged.set(item.id, item);
  }
  return sortHistoryItemsForDisplay([...merged.values()]);
}

function buildOptimisticHistoryItem(
  message: OptimisticUserMessage,
  sessionName: string,
  ordinal: number,
): SessionAgentHistoryItem {
  return {
    kind: 'user',
    id: message.id,
    text: message.text,
    sessionName,
    ordinal,
    itemStatus: 'sending',
    createdAt: message.createdAt,
    updatedAt: message.createdAt,
  };
}

function isTimelineNearBottom(element: HTMLDivElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < TIMELINE_BOTTOM_STICK_THRESHOLD_PX;
}

function areMentionsEqual(left: ActiveMention | null, right: ActiveMention | null): boolean {
  if (!left || !right) return left === right;
  return left.trigger === right.trigger
    && left.start === right.start
    && left.end === right.end
    && left.query === right.query;
}

const AgentSessionPane = forwardRef<AgentSessionPaneHandle, AgentSessionPaneProps>(function AgentSessionPane(
  {
    sessionId,
    workspacePath,
    initialSnapshot = null,
    autoStartMessage = null,
    onFeedback,
    onHeaderMetaChange,
    onRequestAddFiles,
    isAddingFiles = false,
    isMobileViewport = false,
  },
  ref,
) {
  const { isPageVisible, resumeVersion } = usePageVisibility();
  const [runtime, setRuntime] = useState<SessionAgentRuntimeState | null>(initialSnapshot?.runtime ?? null);
  const [history, setHistory] = useState<SessionAgentHistoryItem[]>(initialSnapshot?.history ?? []);
  const [historyPage, setHistoryPage] = useState<HistoryPageState>(() => buildHistoryPageState(initialSnapshot?.historyPage));
  const [loading, setLoading] = useState(() => !initialSnapshot && !(autoStartMessage?.trim()));
  const [loadingOlderHistory, setLoadingOlderHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composerValue, setComposerValue] = useState('');
  const [pendingAttachmentPaths, setPendingAttachmentPaths] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isPastingAttachments, setIsPastingAttachments] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticUserMessage[]>([]);
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState('');
  const [steerTargetId, setSteerTargetId] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionList, setSuggestionList] = useState<string[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [activeMention, setActiveMention] = useState<ActiveMention | null>(null);
  const [workspaceEntriesCache, setWorkspaceEntriesCache] = useState<string[]>([]);
  const [skillSuggestionsByProvider, setSkillSuggestionsByProvider] = useState<Partial<Record<AgentProvider, string[]>>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const timelineContentRef = useRef<HTMLDivElement>(null);
  const pendingSelectionRef = useRef<number | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const refreshTimerRef = useRef<number | null>(null);
  const [expandedHistoryItems, setExpandedHistoryItems] = useState<Record<string, boolean>>({});
  const [lastSocketMessageAt, setLastSocketMessageAt] = useState<number | null>(null);
  const [possibleStale, setPossibleStale] = useState(false);
  const latestComposerValueRef = useRef(composerValue);
  const latestCursorPositionRef = useRef(cursorPosition);
  const latestAgentProviderRef = useRef<AgentProvider | null>(null);
  const autoStartRequestKeyRef = useRef<string | null>(null);

  const fetchSnapshot = useCallback(async (options?: { limit?: number; beforeOrdinal?: number }) => {
    const params = new URLSearchParams({ sessionId });
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.beforeOrdinal !== undefined) {
      params.set('beforeOrdinal', String(options.beforeOrdinal));
    }

    const response = await fetch(`/api/agent/session?${params.toString()}`, {
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null) as SessionSnapshotResponse | { error?: string } | null;
    if (!response.ok || !payload || !('runtime' in payload) || !('history' in payload)) {
      throw new Error((payload && 'error' in payload && typeof payload.error === 'string')
        ? payload.error
        : 'Failed to load agent session.');
    }
    return payload;
  }, [sessionId]);

  const scheduleRefresh = useCallback((delay = 120) => {
    if (!isPageVisible) {
      return;
    }
    if (refreshTimerRef.current !== null) {
      return;
    }

    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void (async () => {
        try {
          const payload = await fetchSnapshot({ limit: INITIAL_HISTORY_PAGE_SIZE });
          setRuntime(payload.runtime);
          setHistory((current) => mergeHistoryWindow(current, payload.history));
          setHistoryPage(buildHistoryPageState(payload.historyPage));
          setError(null);
        } catch (refreshError) {
          setError(refreshError instanceof Error ? refreshError.message : 'Failed to refresh agent session.');
        }
      })();
    }, delay);
  }, [fetchSnapshot, isPageVisible]);

  const loadSnapshot = useCallback(async (options?: { showLoading?: boolean }) => {
    if (options?.showLoading ?? true) {
      setLoading(true);
    }
    try {
      const payload = await fetchSnapshot({ limit: INITIAL_HISTORY_PAGE_SIZE });
      setRuntime(payload.runtime);
      setHistory((current) => mergeHistoryWindow(current, payload.history));
      setHistoryPage(buildHistoryPageState(payload.historyPage));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load agent session.');
    } finally {
      setLoading(false);
    }
  }, [fetchSnapshot]);

  const loadOlderHistory = useCallback(async () => {
    if (loadingOlderHistory || !historyPage.hasOlder || historyPage.oldestLoadedOrdinal == null) {
      return;
    }

    setLoadingOlderHistory(true);
    try {
      const payload = await fetchSnapshot({
        limit: OLDER_HISTORY_PAGE_SIZE,
        beforeOrdinal: historyPage.oldestLoadedOrdinal,
      });
      setHistory((current) => prependOlderHistory(current, payload.history));
      setHistoryPage(buildHistoryPageState(payload.historyPage));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load older history.');
    } finally {
      setLoadingOlderHistory(false);
    }
  }, [fetchSnapshot, historyPage.hasOlder, historyPage.oldestLoadedOrdinal, loadingOlderHistory]);

  useEffect(() => {
    setRuntime(initialSnapshot?.runtime ?? null);
    setHistory(initialSnapshot?.history ?? []);
    setHistoryPage(buildHistoryPageState(initialSnapshot?.historyPage));
    setLoading(!initialSnapshot && !(autoStartMessage?.trim()));
    setLoadingOlderHistory(false);
    setError(null);
    setPendingMessages([]);
    setOptimisticMessages([]);
    setSelectedReasoningEffort(initialSnapshot?.runtime?.reasoningEffort ?? '');
    autoStartRequestKeyRef.current = null;
  }, [autoStartMessage, initialSnapshot, sessionId]);

  useEffect(() => {
    if (!isPageVisible) {
      return;
    }
    void loadSnapshot({ showLoading: !initialSnapshot && !(autoStartMessage?.trim()) });
  }, [autoStartMessage, initialSnapshot, isPageVisible, loadSnapshot]);

  useEffect(() => {
    const nextSelection = pendingSelectionRef.current;
    if (nextSelection === null) return;

    const textarea = textareaRef.current;
    if (!textarea) return;

    pendingSelectionRef.current = null;
    textarea.focus();
    textarea.setSelectionRange(nextSelection, nextSelection);
  }, [composerValue]);

  useEffect(() => {
    latestComposerValueRef.current = composerValue;
  }, [composerValue]);

  useEffect(() => {
    latestCursorPositionRef.current = cursorPosition;
  }, [cursorPosition]);

  useEffect(() => {
    latestAgentProviderRef.current = runtime?.agentProvider || null;
  }, [runtime?.agentProvider]);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let reconnectAttempt = 0;
    let isConnecting = false;

    if (!isPageVisible) {
      setSocketConnected(false);
      return () => {};
    }

    const clearReconnectTimer = () => {
      if (reconnectTimer === null) return;
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const closeSocket = (target: WebSocket | null = socket) => {
      if (!target) return;

      target.onopen = null;
      target.onerror = null;
      target.onclose = null;
      target.onmessage = null;
      target.close();

      if (socket === target) {
        socket = null;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer !== null) return;
      const delay = Math.min(10000, 1000 * (2 ** reconnectAttempt));
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (cancelled) return;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return;
      }
      if (isConnecting) return;

      isConnecting = true;
      try {
        const response = await fetch(`/api/agent/socket?sessionId=${encodeURIComponent(sessionId)}`, {
          cache: 'no-store',
        });
        const payload = await response.json().catch(() => null) as { wsUrl?: string; error?: string } | null;
        if (!response.ok || !payload?.wsUrl) {
          throw new Error(payload?.error || 'Failed to initialize agent socket.');
        }

        if (cancelled) return;

        closeSocket();

        const nextSocket = new WebSocket(payload.wsUrl);
        socket = nextSocket;
        nextSocket.onopen = () => {
          if (socket !== nextSocket) return;
          reconnectAttempt = 0;
          clearReconnectTimer();
          setSocketConnected(true);
          setLastSocketMessageAt(Date.now());
          setPossibleStale(false);
          setError(null);
          scheduleRefresh(0);
        };
        nextSocket.onerror = () => {
          nextSocket.close();
        };
        nextSocket.onclose = () => {
          if (socket !== nextSocket) return;

          socket = null;
          setSocketConnected(false);
          if (cancelled) return;

          scheduleReconnect();
        };
        nextSocket.onmessage = (event) => {
          if (socket !== nextSocket) return;

          try {
            const message = JSON.parse(event.data as string) as AgentSocketPayload;
            if (message.type !== 'session-agent-event' || message.sessionId !== sessionId) {
              return;
            }

            setLastSocketMessageAt(Date.now());
            setPossibleStale(false);
            setRuntime(message.snapshot);
            setError(null);
            setHistory((current) => {
              const projected = projectSessionHistoryEvent(current, sessionId, message.event, message.timestamp);
              if (!projected.handled) {
                scheduleRefresh();
                return current;
              }
              return projected.changed ? projected.history : current;
            });

            if (message.event.type === 'turn_completed' || message.event.type === 'error') {
              scheduleRefresh(250);
            }
          } catch {
            // Ignore malformed socket payloads.
          }
        };
      } catch (socketError) {
        setSocketConnected(false);
        if (!cancelled) {
          setError(socketError instanceof Error ? socketError.message : 'Failed to initialize agent socket.');
          scheduleReconnect();
        }
      } finally {
        isConnecting = false;
      }
    };

    void connect();

    return () => {
      cancelled = true;
      clearReconnectTimer();
      isConnecting = false;
      setSocketConnected(false);
      closeSocket();
    };
  }, [isPageVisible, scheduleRefresh, sessionId]);

  useEffect(() => {
    if (!isPageVisible || resumeVersion === 0) {
      return;
    }
    void loadSnapshot({ showLoading: false });
  }, [isPageVisible, loadSnapshot, resumeVersion]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (isPageVisible || refreshTimerRef.current === null) {
      return;
    }
    window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = null;
  }, [isPageVisible]);

  useEffect(() => {
    setWorkspaceEntriesCache([]);
  }, [workspacePath]);

  const activeRunState = runtime?.runState ?? 'idle';
  const isTurnActive = activeRunState === 'queued' || activeRunState === 'running';
  const reasoningEffortOptions = useMemo<ReasoningEffort[]>(() => {
    if (runtime?.agentProvider !== 'codex') {
      return [];
    }

    return getModelReasoningEffortOptions(
      getCodexModelOptions(runtime?.model || null),
      runtime?.model,
      runtime?.model,
    );
  }, [runtime?.agentProvider, runtime?.model]);
  const effectiveReasoningEffort = useMemo(
    () => resolveReasoningEffortSelection(
      reasoningEffortOptions,
      runtime?.reasoningEffort,
      selectedReasoningEffort,
    ),
    [reasoningEffortOptions, runtime?.reasoningEffort, selectedReasoningEffort],
  );
  const currentReasoningEffort = runtime?.reasoningEffort || '';
  const hasPendingReasoningChange = Boolean(
    effectiveReasoningEffort
    && effectiveReasoningEffort !== currentReasoningEffort,
  );

  useEffect(() => {
    setSelectedReasoningEffort((current) => resolveReasoningEffortSelection(
      reasoningEffortOptions,
      runtime?.reasoningEffort,
      current,
    ));
  }, [reasoningEffortOptions, runtime?.reasoningEffort]);

  useEffect(() => {
    if (!isPageVisible || !isTurnActive || socketConnected) {
      setPossibleStale(false);
      return;
    }

    const interval = window.setInterval(() => {
      scheduleRefresh(0);
    }, ACTIVE_TURN_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [isPageVisible, isTurnActive, scheduleRefresh, socketConnected]);

  useEffect(() => {
    if (!isPageVisible || !isTurnActive || socketConnected) {
      return;
    }

    const interval = window.setInterval(() => {
      const lastActivityMs = runtime?.lastActivityAt ? Date.parse(runtime.lastActivityAt) : NaN;
      const baseline = Number.isFinite(lastActivityMs)
        ? lastActivityMs
        : lastSocketMessageAt;
      if (baseline == null) {
        return;
      }

      const idleMs = Date.now() - baseline;
      if (idleMs >= SOCKET_IDLE_REFRESH_THRESHOLD_MS) {
        scheduleRefresh(0);
      }
      setPossibleStale(idleMs >= POSSIBLE_STALE_THRESHOLD_MS);
    }, 15_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [isPageVisible, isTurnActive, lastSocketMessageAt, runtime?.lastActivityAt, scheduleRefresh, socketConnected]);

  const canSend = !loading && !isSending && (composerValue.trim().length > 0 || pendingAttachmentPaths.length > 0);
  const optimisticHistory = useMemo(
    () => optimisticMessages.map((message, index) => buildOptimisticHistoryItem(
      message,
      runtime?.sessionName || sessionId,
      history.length + index,
    )),
    [history.length, optimisticMessages, runtime?.sessionName, sessionId],
  );
  const baseDisplayHistory = useMemo(
    () => [...history, ...optimisticHistory],
    [history, optimisticHistory],
  );
  const pendingAssistantItem = useMemo(
    () => buildPendingAssistantItem(sessionId, runtime, baseDisplayHistory),
    [baseDisplayHistory, runtime, sessionId],
  );
  const displayHistory = useMemo(
    () => pendingAssistantItem
      ? [...baseDisplayHistory, pendingAssistantItem]
      : baseDisplayHistory,
    [baseDisplayHistory, pendingAssistantItem],
  );
  const planFallbackStepsById = useMemo<Record<string, PlanStep[]>>(() => {
    const planToolStepsByTurnId = new Map<string, PlanStep[]>();
    const fallbackById: Record<string, PlanStep[]> = {};

    displayHistory.forEach((item) => {
      if (item.kind === 'tool' && item.tool === 'update_plan') {
        const steps = parsePlanStepsFromToolInput(item.input);
        if (steps.length > 0 && item.turnId) {
          planToolStepsByTurnId.set(item.turnId, steps);
        }
        return;
      }

      if (item.kind !== 'plan' || !item.turnId || getPlanSteps(item).length > 0) {
        return;
      }

      const fallbackSteps = planToolStepsByTurnId.get(item.turnId);
      if (fallbackSteps && fallbackSteps.length > 0) {
        fallbackById[item.id] = fallbackSteps;
      }
    });

    return fallbackById;
  }, [displayHistory]);

  useEffect(() => {
    if (!timelineRef.current) return;
    if (!shouldStickToBottomRef.current) return;

    timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
  }, [displayHistory, loading]);

  useEffect(() => {
    const element = timelineRef.current;
    const content = timelineContentRef.current;
    if (!element || !content) return;

    const observer = new ResizeObserver(() => {
      if (shouldStickToBottomRef.current) {
        element.scrollTop = element.scrollHeight;
      }
    });

    observer.observe(element);
    observer.observe(content);
    return () => {
      observer.disconnect();
    };
  }, [displayHistory.length]);

  useEffect(() => {
    const activeItemIds = new Set(displayHistory.map((item) => item.id));
    setExpandedHistoryItems((current) => {
      const nextEntries = Object.entries(current).filter(([itemId, isOpen]) => isOpen && activeItemIds.has(itemId));
      if (nextEntries.length === Object.keys(current).length) {
        return current;
      }
      return Object.fromEntries(nextEntries);
    });
  }, [displayHistory]);

  const handleToggleExpanded = useCallback((itemId: string, open: boolean) => {
    setExpandedHistoryItems((current) => {
      if (open) {
        if (current[itemId]) return current;
        return {
          ...current,
          [itemId]: true,
        };
      }

      if (!current[itemId]) return current;
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }, []);

  useEffect(() => {
    setOptimisticMessages((current) => reconcileOptimisticUserMessages(history, current));
  }, [history]);

  useEffect(() => {
    if (!shouldReleaseSessionCanvasAgentSendLock({
      isSending,
      optimisticMessageCount: optimisticMessages.length,
      runState: runtime?.runState ?? null,
    })) {
      return;
    }

    setIsSending(false);
  }, [isSending, optimisticMessages.length, runtime?.runState]);

  const providerName = providerLabel(runtime?.agentProvider || null);
  const turnDiagnostics = runtime?.turnDiagnostics ?? null;
  const [isAgentDetailsDialogOpen, setIsAgentDetailsDialogOpen] = useState(false);

  const submitMessageToAgent = useCallback(async (
    message: string,
    attachmentPaths: string[] = [],
    options?: { markInitialized?: boolean },
  ) => {
    const normalizedAttachmentPaths = Array.from(new Set(attachmentPaths.map((entry) => entry.trim()).filter(Boolean)));
    const displayMessage = buildDisplayMessage(message, normalizedAttachmentPaths);
    setError(null);
    try {
      const response = await fetch('/api/agent/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          message,
          displayMessage,
          attachmentPaths: normalizedAttachmentPaths,
          reasoningEffort: normalizeProviderReasoningEffort(
            runtime?.agentProvider ?? null,
            effectiveReasoningEffort,
          ) ?? null,
          ...(options?.markInitialized ? { markInitialized: true } : {}),
        }),
      });
      const payload = await response.json().catch(() => null) as SendMessageResponse | null;
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Failed to send message.');
      }
      if (payload.runtime) {
        setRuntime(payload.runtime);
        setPossibleStale(false);
      }
      shouldStickToBottomRef.current = true;
      scheduleRefresh(0);
      return { success: true as const };
    } catch (submitError) {
      const messageText = submitError instanceof Error ? submitError.message : 'Failed to send message.';
      setError(messageText);
      onFeedback?.(messageText);
      return { success: false as const, error: messageText };
    }
  }, [effectiveReasoningEffort, onFeedback, runtime?.agentProvider, scheduleRefresh, sessionId]);

  useEffect(() => {
    const normalizedAutoStartMessage = autoStartMessage?.trim();
    if (!normalizedAutoStartMessage) {
      return;
    }

    const requestKey = buildSessionCanvasAutoStartKey(sessionId, normalizedAutoStartMessage);
    if (!requestKey) {
      return;
    }

    if (autoStartRequestKeyRef.current === requestKey) {
      return;
    }

    if (history.some((item) => item.kind === 'user' && item.text === normalizedAutoStartMessage)) {
      autoStartRequestKeyRef.current = requestKey;
      releaseSessionCanvasAutoStart(requestKey);
      return;
    }

    if (!claimSessionCanvasAutoStart(requestKey)) {
      autoStartRequestKeyRef.current = requestKey;
      return;
    }

    autoStartRequestKeyRef.current = requestKey;
    const optimisticMessage = createOptimisticUserMessage(normalizedAutoStartMessage);
    setOptimisticMessages((current) => [...current, optimisticMessage]);
    shouldStickToBottomRef.current = true;
    setIsSending(true);

    void (async () => {
      const result = await submitMessageToAgent(normalizedAutoStartMessage, [], { markInitialized: true });
      if (autoStartRequestKeyRef.current !== requestKey) {
        return;
      }

      if (!result.success) {
        if (result.error === DUPLICATE_TURN_ERROR) {
          setOptimisticMessages((current) => current.filter((item) => item.id !== optimisticMessage.id));
          setError(null);
          scheduleRefresh(0);
          setIsSending(false);
          return;
        }

        setOptimisticMessages((current) => current.filter((item) => item.id !== optimisticMessage.id));
        autoStartRequestKeyRef.current = null;
        releaseSessionCanvasAutoStart(requestKey);
      }
      setIsSending(false);
    })();
  }, [autoStartMessage, history, sessionId, submitMessageToAgent]);

  const hideSuggestions = useCallback(() => {
    setShowSuggestions(false);
    setSuggestionList([]);
    setSelectedSuggestionIndex(0);
    setActiveMention(null);
  }, []);

  const applySuggestionList = useCallback((mention: ActiveMention, suggestions: string[]) => {
    setActiveMention(mention);
    setSuggestionList(suggestions);
    setSelectedSuggestionIndex(0);
    setShowSuggestions(suggestions.length > 0);
  }, []);

  const refreshComposerSuggestions = useCallback(async (value: string, position: number) => {
    const mention = findActiveMention(value, position);
    if (!mention) {
      hideSuggestions();
      return;
    }

    setActiveMention(mention);

    if (mention.trigger === '@') {
      let entries = workspaceEntriesCache;
      if (entries.length === 0) {
        entries = await listRepoFiles(workspacePath);
        setWorkspaceEntriesCache((previous) => (previous.length > 0 ? previous : entries));
      }

      const latestMention = findActiveMention(latestComposerValueRef.current, latestCursorPositionRef.current);
      if (!areMentionsEqual(latestMention, mention)) {
        return;
      }

      const suggestions = buildRepoMentionSuggestions({
        query: mention.query,
        repoEntries: entries,
        currentAttachments: pendingAttachmentPaths.map((attachmentPath) => getBaseName(attachmentPath)),
        carriedAttachments: [],
      });
      applySuggestionList(mention, suggestions);
      return;
    }

    const provider = runtime?.agentProvider || null;
    if (!provider) {
      applySuggestionList(mention, []);
      return;
    }

    let installedSkills = skillSuggestionsByProvider[provider];
    if (!Object.prototype.hasOwnProperty.call(skillSuggestionsByProvider, provider)) {
      installedSkills = await listInstalledAgentSkills(provider);
      setSkillSuggestionsByProvider((previous) => (
        Object.prototype.hasOwnProperty.call(previous, provider)
          ? previous
          : { ...previous, [provider]: installedSkills ?? [] }
      ));
    }

    const latestMention = findActiveMention(latestComposerValueRef.current, latestCursorPositionRef.current);
    if (!areMentionsEqual(latestMention, mention) || latestAgentProviderRef.current !== provider) {
      return;
    }

    const suggestions = buildSkillMentionSuggestions(mention.query, installedSkills ?? []);
    applySuggestionList(mention, suggestions);
  }, [
    applySuggestionList,
    hideSuggestions,
    pendingAttachmentPaths,
    runtime?.agentProvider,
    skillSuggestionsByProvider,
    workspaceEntriesCache,
    workspacePath,
  ]);

  const handleSelectSuggestion = useCallback((suggestion: string) => {
    if (!activeMention) return;

    const result = replaceActiveMention(composerValue, activeMention, suggestion);
    latestComposerValueRef.current = result.value;
    latestCursorPositionRef.current = result.cursorPosition;
    setComposerValue(result.value);
    setCursorPosition(result.cursorPosition);
    pendingSelectionRef.current = result.cursorPosition;
    hideSuggestions();
  }, [activeMention, composerValue, hideSuggestions]);

  const handleComposerChange = useCallback(async (nextValue: string, nextCursorPosition: number) => {
    latestComposerValueRef.current = nextValue;
    latestCursorPositionRef.current = nextCursorPosition;
    setComposerValue(nextValue);
    setCursorPosition(nextCursorPosition);
    await refreshComposerSuggestions(nextValue, nextCursorPosition);
  }, [refreshComposerSuggestions]);

  useEffect(() => {
    if (activeMention?.trigger !== '$') return;
    void refreshComposerSuggestions(latestComposerValueRef.current, latestCursorPositionRef.current);
  }, [activeMention?.trigger, refreshComposerSuggestions, runtime?.agentProvider]);

  const handleComposerPaste = useCallback(async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = getClipboardImageFiles(event.clipboardData);
    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    setError(null);
    setIsPastingAttachments(true);

    try {
      const formData = new FormData();
      const timestamp = Date.now();
      imageFiles.forEach((file, index) => {
        const defaultExtension = file.type.startsWith('image/')
          ? file.type.slice('image/'.length).replace(/[^a-zA-Z0-9]/g, '') || 'png'
          : 'png';
        const normalizedExtension = defaultExtension === 'jpeg' ? 'jpg' : defaultExtension;
        const trimmedName = file.name.trim();
        const hasExtension = trimmedName.includes('.');
        const fileName = trimmedName
          ? (hasExtension ? trimmedName : `${trimmedName}.${normalizedExtension}`)
          : `pasted-image-${timestamp}-${index + 1}.${normalizedExtension}`;
        formData.append(`image-${index}`, new File([file], fileName, { type: file.type || 'image/png' }));
      });

      const savedPaths = await uploadAttachments(workspacePath, formData);
      if (savedPaths.length === 0) {
        throw new Error('Failed to save pasted images.');
      }

      setPendingAttachmentPaths((current) => Array.from(new Set([...current, ...savedPaths])));
      onFeedback?.(`Attached ${savedPaths.length} image file${savedPaths.length === 1 ? '' : 's'} from clipboard`);
    } catch (pasteError) {
      const messageText = pasteError instanceof Error ? pasteError.message : 'Failed to paste image attachments.';
      setError(messageText);
      onFeedback?.(messageText);
    } finally {
      setIsPastingAttachments(false);
    }
  }, [onFeedback, workspacePath]);

  const removePendingAttachment = useCallback((targetPath: string) => {
    setPendingAttachmentPaths((current) => current.filter((entry) => entry !== targetPath));
  }, []);

  const handleSubmit = useCallback(async () => {
    const message = composerValue.trim();
    const attachmentPaths = pendingAttachmentPaths;
    if ((!message && attachmentPaths.length === 0) || isSending) return;

    setComposerValue('');
    setPendingAttachmentPaths([]);

    if (isTurnActive) {
      setPendingMessages((current) => [...current, createPendingMessage(message, attachmentPaths)]);
      onFeedback?.('Queued message for the next turn');
      return;
    }

    const optimisticMessage = createOptimisticUserMessage(buildDisplayMessage(message, attachmentPaths));
    setOptimisticMessages((current) => [...current, optimisticMessage]);
    shouldStickToBottomRef.current = true;
    setIsSending(true);
    const result = await submitMessageToAgent(message, attachmentPaths);
    if (result.success) {
      onFeedback?.('Sent message to agent');
    } else {
      setOptimisticMessages((current) => current.filter((item) => item.id !== optimisticMessage.id));
    }
    setIsSending(false);
  }, [composerValue, isSending, isTurnActive, onFeedback, pendingAttachmentPaths, submitMessageToAgent]);

  const handleCancel = useCallback(async () => {
    if (!runtime || !isTurnActive || isCancelling) return;

    setIsCancelling(true);
    setError(null);
    try {
      const response = await fetch('/api/agent/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
        }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to cancel turn.');
      }

      onFeedback?.('Cancelled active agent turn');
      scheduleRefresh(0);
    } catch (cancelError) {
      const messageText = cancelError instanceof Error ? cancelError.message : 'Failed to cancel turn.';
      setError(messageText);
      onFeedback?.(messageText);
    } finally {
      setIsCancelling(false);
    }
  }, [isCancelling, isTurnActive, onFeedback, runtime, scheduleRefresh, sessionId]);

  const dispatchQueuedMessage = useCallback(async (targetId?: string | null) => {
    if (isSending) return false;

    const queue = pendingMessages;
    if (queue.length === 0) return false;

    const nextIndex = targetId
      ? queue.findIndex((item) => item.id === targetId)
      : 0;
    if (nextIndex < 0) return false;

    const nextMessage = queue[nextIndex];
    setIsSending(true);
    setPendingMessages((current) => current.filter((item) => item.id !== nextMessage.id));
    const result = await submitMessageToAgent(nextMessage.text, nextMessage.attachmentPaths);
    setIsSending(false);

    if (result.success) {
      onFeedback?.(targetId ? 'Sent steer message to agent' : 'Sent queued message to agent');
      return true;
    }

    setPendingMessages((current) => [nextMessage, ...current]);
    return false;
  }, [isSending, onFeedback, pendingMessages, submitMessageToAgent]);

  const handleSteerMessage = useCallback(async (messageId: string) => {
    if (isSending || isCancelling) return;

    if (!isTurnActive) {
      void dispatchQueuedMessage(messageId);
      return;
    }

    setSteerTargetId(messageId);
    onFeedback?.('Steering agent with queued message...');
    await handleCancel();
  }, [dispatchQueuedMessage, handleCancel, isCancelling, isSending, isTurnActive, onFeedback]);

  const headerMeta = useMemo<AgentSessionHeaderMeta>(() => ({
    providerId: runtime?.agentProvider || null,
    providerName,
    model: runtime?.model || '',
    runState: activeRunState,
    socketConnected,
    threadId: runtime?.threadId || null,
    reasoningEffort: runtime?.reasoningEffort || null,
    reasoningEffortOptions,
    effectiveReasoningEffort: effectiveReasoningEffort || null,
    hasPendingReasoningChange,
    workspacePath,
    canCancel: Boolean(runtime) && (isTurnActive || isCancelling),
    isCancelling,
    lastActivityAt: runtime?.lastActivityAt || null,
    lastError: runtime?.lastError || null,
  }), [
    activeRunState,
    effectiveReasoningEffort,
    hasPendingReasoningChange,
    isCancelling,
    isTurnActive,
    providerName,
    reasoningEffortOptions,
    runtime,
    socketConnected,
    workspacePath,
  ]);

  useEffect(() => {
    onHeaderMetaChange?.(headerMeta);
  }, [headerMeta, onHeaderMetaChange]);

  useImperativeHandle(ref, () => ({
    focusComposer() {
      textareaRef.current?.focus();
    },
    insertText(text: string) {
      const value = text ?? '';
      if (!value) return true;

      setComposerValue((previous) => {
        const textarea = textareaRef.current;
        const start = textarea?.selectionStart ?? previous.length;
        const end = textarea?.selectionEnd ?? previous.length;
        const nextValue = `${previous.slice(0, start)}${value}${previous.slice(end)}`;
        pendingSelectionRef.current = start + value.length;
        return nextValue;
      });

      onFeedback?.('Inserted text into agent input');
      return true;
    },
    setReasoningEffort(effort: string) {
      const nextValue = resolveReasoningEffortSelection(
        reasoningEffortOptions,
        runtime?.reasoningEffort,
        effort,
      );
      if (!nextValue) {
        return false;
      }
      setSelectedReasoningEffort(nextValue);
      return true;
    },
    openAgentDetails() {
      setIsAgentDetailsDialogOpen(true);
    },
    async cancelActiveTurn() {
      await handleCancel();
    },
    async refreshSnapshot() {
      await loadSnapshot();
    },
  }), [effectiveReasoningEffort, handleCancel, loadSnapshot, onFeedback, reasoningEffortOptions, runtime?.reasoningEffort]);

  useEffect(() => {
    if (isTurnActive || isSending || pendingMessages.length === 0) return;

    const nextTargetId = steerTargetId ?? pendingMessages[0]?.id ?? null;
    if (!nextTargetId) return;

    let cancelled = false;
    void (async () => {
      const dispatched = await dispatchQueuedMessage(nextTargetId);
      if (!cancelled && steerTargetId === nextTargetId) {
        setSteerTargetId(null);
      }
      if (!dispatched && !cancelled && steerTargetId === nextTargetId) {
        setSteerTargetId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dispatchQueuedMessage, isSending, isTurnActive, pendingMessages, steerTargetId]);

  return (
    <div className={AGENT_SESSION_PANE_CLASSNAME}>
      {isAgentDetailsDialogOpen ? (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-2xl border border-slate-200 bg-white app-dark-modal">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Agent Details</h3>
            <div className="mt-3 grid gap-3 text-sm">
              <div className="grid gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 app-dark-surface sm:grid-cols-2">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Agent</div>
                  <div className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">{providerName}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</div>
                  <div className="mt-0.5">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${runStateTone(activeRunState)}`}>
                      {formatRunState(activeRunState)}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Model</div>
                  <div className="mt-0.5 break-all font-mono text-xs text-slate-700 dark:text-slate-200">{runtime?.model || 'n/a'}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Connection</div>
                  <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-700 dark:text-slate-200">
                    <Clock3 className="h-3 w-3" />
                    {socketConnected ? 'live' : 'offline'}
                  </div>
                  {possibleStale ? (
                    <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-300">
                      No recent agent activity detected. Refresh fallback is active.
                    </div>
                  ) : null}
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Thread</div>
                  <div className="mt-0.5 break-all font-mono text-xs text-slate-700 dark:text-slate-200">{runtime?.threadId || 'n/a'}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Reasoning</div>
                  <div className="mt-0.5 text-xs text-slate-700 dark:text-slate-200">
                    {effectiveReasoningEffort || runtime?.reasoningEffort || 'n/a'}
                  </div>
                  {hasPendingReasoningChange ? (
                    <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      Current: {currentReasoningEffort || 'n/a'}
                    </div>
                  ) : null}
                </div>
                <div className="sm:col-span-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">CWD</div>
                  <div className="mt-0.5 break-all font-mono text-xs text-slate-700 dark:text-slate-200">{workspacePath || '.'}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Last Activity</div>
                  <div className="mt-0.5 text-xs text-slate-700 dark:text-slate-200">{formatTimestamp(runtime?.lastActivityAt) || 'n/a'}</div>
                </div>
                {turnDiagnostics ? (
                  <div className="sm:col-span-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Startup Diagnostics</div>
                    <div className="mt-2 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2 app-dark-surface">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 app-dark-surface-raised">
                          {turnDiagnostics.transport}
                        </span>
                        {turnDiagnostics.timeToTurnStartMs != null ? (
                          <span>to running {formatDuration(turnDiagnostics.timeToTurnStartMs)}</span>
                        ) : (
                          <span>queued since {formatTimestamp(turnDiagnostics.queuedAt)}</span>
                        )}
                      </div>
                      {turnDiagnostics.steps.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {turnDiagnostics.steps.map((step) => {
                            const durationLabel = step.status === 'running'
                              ? 'in progress'
                              : formatDuration(step.durationMs);
                            return (
                              <span
                                key={step.key}
                                title={step.detail || undefined}
                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${diagnosticStepTone(step.status)}`}
                              >
                                <span>{step.label}</span>
                                {durationLabel ? <span>{durationLabel}</span> : null}
                              </span>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
              {runtime?.lastError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
                  <div className="mb-1 font-semibold uppercase tracking-wide">Last Error</div>
                  <div className="whitespace-pre-wrap break-words">{runtime.lastError}</div>
                </div>
              ) : null}
            </div>
            <div className="modal-action">
              <button
                type="button"
                className="btn"
                onClick={() => setIsAgentDetailsDialogOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setIsAgentDetailsDialogOpen(false)}>close</button>
          </form>
        </dialog>
      ) : null}

      <div
        ref={timelineRef}
        className={AGENT_SESSION_TIMELINE_CLASSNAME}
        onScroll={(event) => {
          const target = event.currentTarget;
          shouldStickToBottomRef.current = isTimelineNearBottom(target);
        }}
      >
        <div ref={timelineContentRef}>
          {loading ? (
            <div className="flex h-full min-h-[180px] items-center justify-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm app-dark-surface-raised">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading agent timeline...
              </div>
            </div>
          ) : displayHistory.length === 0 ? (
            <div className="flex h-full min-h-[180px] items-center justify-center">
              <div className="max-w-md rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-center text-sm text-slate-500 app-dark-surface">
                No agent activity yet. Send a task below to start a background turn.
              </div>
            </div>
          ) : (
            // Keep the timeline in normal document flow. This pane mixes markdown and
            // expandable cards, and absolute-position virtualization led to stale
            // height placement that could overlap adjacent rows.
            <div className="space-y-3">
              {historyPage.hasOlder ? (
                <div className="flex justify-center pb-1">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                    onClick={() => { void loadOlderHistory(); }}
                    disabled={loadingOlderHistory}
                  >
                    {loadingOlderHistory ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {loadingOlderHistory ? 'Loading older activity...' : 'Load older activity'}
                  </button>
                </div>
              ) : null}
              {displayHistory.map((item) => (
                <MemoizedMeasuredHistoryRow
                  key={item.id}
                  item={item}
                  expandedItems={expandedHistoryItems}
                  onToggleExpanded={handleToggleExpanded}
                  planFallbackStepsById={planFallbackStepsById}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-slate-200 px-4 py-3 dark:border-[color:var(--app-dark-border-subtle)]">
        {(error || runtime?.lastError) ? (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="whitespace-pre-wrap break-words">{error || runtime?.lastError}</span>
          </div>
        ) : null}
        {pendingMessages.length > 0 ? (
          <div className="mb-3 space-y-2">
            {pendingMessages.map((item, index) => {
              const isSteerTarget = item.id === steerTargetId;
              return (
                <div
                  key={item.id}
                  className="flex items-start gap-3 rounded-xl border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-sm text-amber-950 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100"
                >
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700/80 dark:text-amber-200/80">
                      {index === 0 ? 'Next in Queue' : `Queued ${index + 1}`}
                    </div>
                    <div className="whitespace-pre-wrap break-words">{item.displayText}</div>
                    {item.attachmentPaths.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {item.attachmentPaths.map((attachmentPath) => (
                          <span
                            key={`${item.id}-${attachmentPath}`}
                            className="inline-flex items-center gap-1 rounded-full border border-amber-300/80 bg-white/80 px-2 py-0.5 text-[10px] dark:border-amber-400/30 dark:bg-amber-950/30"
                            title={attachmentPath}
                          >
                            <Paperclip className="h-3 w-3" />
                            <span className="max-w-40 truncate">{getBaseName(attachmentPath)}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-950/50"
                    onClick={() => void handleSteerMessage(item.id)}
                    disabled={isSending || isCancelling || isSteerTarget}
                  >
                    {isSteerTarget ? 'Steering' : 'Steer'}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
        <div className="relative rounded-2xl border border-slate-200 bg-white p-3 shadow-sm app-dark-surface">
          {pendingAttachmentPaths.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {pendingAttachmentPaths.map((attachmentPath) => (
                <span
                  key={attachmentPath}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-300 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-700 app-dark-surface-raised"
                  title={attachmentPath}
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  <span className="max-w-52 truncate">{getBaseName(attachmentPath)}</span>
                  <button
                    type="button"
                    className="rounded text-slate-500 transition hover:text-red-500 dark:text-slate-400 dark:hover:text-red-300"
                    onClick={() => removePendingAttachment(attachmentPath)}
                    title="Remove attachment"
                    aria-label={`Remove ${getBaseName(attachmentPath)}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            className="max-h-28 min-h-20 w-full resize-y border-none bg-transparent font-mono text-sm leading-relaxed text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
            style={{ height: COMPOSER_MAX_HEIGHT / 1.4 }}
            placeholder={isTurnActive
              ? 'Queue a follow-up message, or add steering instructions...\nTip: Type @ for files and $ for skills.'
              : 'Send a follow-up task or ask the agent to continue...\nTip: Type @ for files and $ for skills.'}
            value={composerValue}
            onChange={(event) => {
              const nextValue = event.target.value;
              const nextCursorPosition = event.target.selectionStart;
              void handleComposerChange(nextValue, nextCursorPosition);
            }}
            onClick={(event) => {
              setCursorPosition(event.currentTarget.selectionStart);
              hideSuggestions();
            }}
            onKeyUp={(event) => {
              setCursorPosition(event.currentTarget.selectionStart);
            }}
            onPaste={(event) => {
              void handleComposerPaste(event);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                if (showSuggestions && suggestionList.length > 0) {
                  if (event.shiftKey) {
                    event.preventDefault();
                    setShowSuggestions(false);
                    const textarea = event.currentTarget;
                    const start = textarea.selectionStart;
                    const end = textarea.selectionEnd;
                    const val = composerValue;
                    const newVal = val.slice(0, start) + '\n' + val.slice(end);
                    void handleComposerChange(newVal, start + 1);
                    return;
                  }
                  event.preventDefault();
                  handleSelectSuggestion(suggestionList[selectedSuggestionIndex]);
                  return;
                }
                if (!event.shiftKey) {
                  event.preventDefault();
                  void handleSubmit();
                  return;
                }
                return;
              }

              if (showSuggestions && suggestionList.length > 0) {
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setSelectedSuggestionIndex((previous) => (
                    previous > 0 ? previous - 1 : suggestionList.length - 1
                  ));
                  return;
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setSelectedSuggestionIndex((previous) => (
                    previous < suggestionList.length - 1 ? previous + 1 : 0
                  ));
                  return;
                }
                if (event.key === 'Tab') {
                  event.preventDefault();
                  handleSelectSuggestion(suggestionList[selectedSuggestionIndex]);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  hideSuggestions();
                  return;
                }
              }
            }}
          />
          {showSuggestions && suggestionList.length > 0 ? (
            <div className="absolute bottom-20 left-6 right-6 z-20 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg app-dark-popover">
              {suggestionList.map((suggestion, index) => (
                <button
                  key={suggestion}
                  type="button"
                  className={`w-full truncate border-b border-slate-100 px-3 py-2 text-left text-xs last:border-0 ${
                    index === selectedSuggestionIndex
                      ? 'bg-primary text-white'
                      : 'text-slate-700 hover:bg-slate-50 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-800/60'
                  }`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    handleSelectSuggestion(suggestion);
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-2">
                {isPastingAttachments ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Saving pasted image...
                  </span>
                ) : isTurnActive ? (
                  <span className="inline-flex items-center gap-1">
                    <PlayCircle className="h-3.5 w-3.5" />
                    Turn in progress
                  </span>
                ) : (
                  <span>Paste images with Cmd/Ctrl+V · Press Enter to send, Shift+Enter for new line</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {onRequestAddFiles ? (
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white p-0 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 app-dark-input app-dark-hover"
                  onClick={onRequestAddFiles}
                  disabled={isAddingFiles}
                  title="Browse files and insert absolute paths into the agent input"
                  aria-label="Add files"
                >
                  {isAddingFiles ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
                </button>
              ) : null}
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary p-0 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700 dark:hover:bg-[var(--app-dark-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => void handleSubmit()}
                disabled={!canSend}
                title={isTurnActive ? 'Queue' : 'Send'}
                aria-label={isTurnActive ? 'Queue' : 'Send'}
              >
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
              {(isTurnActive || isCancelling) ? (
                <button
                  type="button"
                  className={`inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 app-dark-input app-dark-hover ${isMobileViewport ? 'w-9 justify-center p-0' : 'gap-2 px-4'}`}
                  onClick={() => void handleCancel()}
                  disabled={isCancelling}
                  title="Stop"
                  aria-label="Stop"
                >
                  {isCancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                  {!isMobileViewport ? 'Stop' : null}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default AgentSessionPane;
