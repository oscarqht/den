'use client';

import { LoaderCircle, RefreshCw, Wrench } from 'lucide-react';

type RestartStatus =
  | 'queued'
  | 'stopping'
  | 'starting'
  | 'repairing'
  | 'ready'
  | 'failed';

export type AppRestartDialogProps = {
  isOpen: boolean;
  status: RestartStatus | null;
  mode: 'dev' | 'start' | null;
  attempts: number;
  repairAttempts: number;
  agentActive: boolean;
  connected: boolean;
  log: string;
  lastError: string | null;
  onClose: () => void;
};

function statusLabel(status: RestartStatus | null): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'stopping':
      return 'Stopping current service';
    case 'starting':
      return 'Starting service';
    case 'repairing':
      return 'Repairing startup issue';
    case 'ready':
      return 'Restart complete';
    case 'failed':
      return 'Restart failed';
    default:
      return 'Restarting';
  }
}

function modeLabel(mode: 'dev' | 'start' | null): string {
  if (mode === 'dev') return '`npm run dev`';
  if (mode === 'start') return '`npm run build && npm start`';
  return 'configured startup command';
}

export default function AppRestartDialog({
  isOpen,
  status,
  mode,
  attempts,
  repairAttempts,
  agentActive,
  connected,
  log,
  lastError,
  onClose,
}: AppRestartDialogProps) {
  if (!isOpen) return null;

  const inProgress = status === 'queued'
    || status === 'stopping'
    || status === 'starting'
    || status === 'repairing';
  const canClose = !inProgress;
  const showSpinner = inProgress || !connected;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-4xl rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-3">
              {showSpinner ? (
                <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
              ) : (
                <RefreshCw className="h-5 w-5 text-primary" />
              )}
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Restart Palx
              </h2>
            </div>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {statusLabel(status)} using {modeLabel(mode)}.
            </p>
            {!connected ? (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                Waiting for the app to come back online.
              </p>
            ) : null}
            {agentActive ? (
              <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 dark:bg-sky-500/10 dark:text-sky-200">
                <Wrench className="h-3.5 w-3.5" />
                Background Codex repair agent is active
              </p>
            ) : null}
          </div>
          {canClose ? (
            <button type="button" className="btn btn-sm" onClick={onClose}>
              Close
            </button>
          ) : null}
        </div>

        <div className="grid gap-4 px-6 py-5 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Startup attempts
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
              {attempts}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Repair attempts
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
              {repairAttempts}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Connectivity
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
              {connected ? 'Connected to Palx' : 'Reconnecting'}
            </div>
          </div>
        </div>

        {lastError ? (
          <div className="mx-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-200">
            {lastError}
          </div>
        ) : null}

        <div className="px-6 py-5">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Console output
          </div>
          <pre className="max-h-[45vh] overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">
            {log.trim() || 'Waiting for restart output...'}
          </pre>
        </div>
      </div>
    </div>
  );
}
