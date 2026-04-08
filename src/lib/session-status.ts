import type { SessionAgentRunState, SessionStatus } from './types.ts';

export function deriveSessionStatus(runState: SessionAgentRunState | null | undefined): SessionStatus {
  switch (runState) {
    case 'queued':
    case 'running':
      return 'in_progress';
    case 'completed':
      return 'done';
    case 'error':
    case 'needs_auth':
      return 'need_attention';
    case 'cancelled':
      return 'cancelled';
    case 'idle':
    case null:
    case undefined:
      return 'idle';
    default:
      return 'in_progress';
  }
}

export function formatSessionStatus(status: SessionStatus): string {
  switch (status) {
    case 'in_progress':
      return 'In Progress';
    case 'done':
      return 'Done';
    case 'need_attention':
      return 'Need Attention';
    case 'cancelled':
      return 'Cancelled';
    case 'idle':
      return 'Idle';
  }
}

export function getSessionStatusBadgeTone(status: SessionStatus): string {
  switch (status) {
    case 'in_progress':
      return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200';
    case 'done':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200';
    case 'need_attention':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200';
    case 'cancelled':
      return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-200';
    case 'idle':
      return 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300';
  }
}

export function getSessionStatusDotTone(status: SessionStatus): string {
  switch (status) {
    case 'in_progress':
      return 'bg-sky-500';
    case 'done':
      return 'bg-emerald-500';
    case 'need_attention':
      return 'bg-amber-500';
    case 'cancelled':
      return 'bg-slate-400 dark:bg-slate-500';
    case 'idle':
      return 'bg-slate-300 dark:bg-slate-600';
  }
}
