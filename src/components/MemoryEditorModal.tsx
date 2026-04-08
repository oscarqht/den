'use client';

import { Trash2, X } from 'lucide-react';

type MemoryEditorModalProps = {
  isOpen: boolean;
  title: string;
  description: string;
  pathLabel: string;
  value: string;
  error: string | null;
  isSaving: boolean;
  isResetting: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onReset: () => void;
  onClose: () => void;
};

export default function MemoryEditorModal({
  isOpen,
  title,
  description,
  pathLabel,
  value,
  error,
  isSaving,
  isResetting,
  onChange,
  onSave,
  onReset,
  onClose,
}: MemoryEditorModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1002] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-sm app-dark-overlay">
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl app-dark-modal">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-5 py-4 md:px-6 app-dark-modal-header">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
          </div>
          <button className="app-ui-icon-button" onClick={onClose} disabled={isSaving || isResetting}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto p-5 md:p-6">
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 break-all font-mono text-xs text-slate-700 app-dark-surface-raised">
            {pathLabel}
          </div>

          <textarea
            className="textarea min-h-[360px] w-full border-slate-200 bg-slate-50 font-mono text-sm text-slate-800 focus:border-primary focus:outline-none app-dark-input"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="# Memory"
            disabled={isSaving || isResetting}
          />

          {error ? (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-900/30 dark:text-red-200">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 md:px-6">
          <button
            type="button"
            className="app-ui-button app-ui-button-danger"
            onClick={onReset}
            disabled={isSaving || isResetting}
          >
            {isResetting ? <span className="loading loading-spinner loading-xs" /> : <Trash2 className="h-4 w-4" />}
            Reset
          </button>
          <div className="flex items-center gap-2">
            <button type="button" className="app-ui-button" onClick={onClose} disabled={isSaving || isResetting}>
              Close
            </button>
            <button type="button" className="app-ui-button app-ui-button-primary" onClick={onSave} disabled={isSaving || isResetting}>
              {isSaving ? <span className="loading loading-spinner loading-xs" /> : null}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
