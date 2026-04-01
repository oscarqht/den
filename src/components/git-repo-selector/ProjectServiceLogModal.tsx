'use client';

import { X } from 'lucide-react';
import { useDialogKeyboardShortcuts } from '@/hooks/useDialogKeyboardShortcuts';

export type ProjectServiceLogModalProps = {
  isOpen: boolean;
  projectName: string;
  command?: string;
  output: string;
  running: boolean;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
};

export function ProjectServiceLogModal({
  isOpen,
  projectName,
  command,
  output,
  running,
  isLoading,
  error,
  onClose,
}: ProjectServiceLogModalProps) {
  useDialogKeyboardShortcuts({
    enabled: isOpen,
    onConfirm: undefined,
    onDismiss: onClose,
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1002] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-sm app-dark-overlay">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl app-dark-modal">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-5 py-4 md:px-6 app-dark-modal-header">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{projectName} Service Log</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {running ? 'Service is running.' : 'Service is stopped.'}
            </p>
          </div>
          <button
            className="app-ui-icon-button"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5 md:p-6">
          {command ? (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Managed Command
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 app-dark-surface-raised dark:text-slate-200">
                {command}
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          ) : null}

          <div className="rounded-xl border border-slate-200 bg-slate-950 app-dark-code dark:border-slate-700">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2 text-xs text-slate-400 dark:border-[color:var(--app-dark-border-subtle)]">
              <span>Terminal Output</span>
              {isLoading ? <span className="loading loading-spinner loading-xs" /> : null}
            </div>
            <pre className="max-h-[55vh] overflow-auto px-4 py-3 font-mono text-xs leading-5 text-slate-100">
              {output || 'No output yet.'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
