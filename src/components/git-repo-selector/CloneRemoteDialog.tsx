'use client';

import { useState } from 'react';
import { CloudDownload, FolderCog, X } from 'lucide-react';
import FileBrowser from '@/components/FileBrowser';
import type { Credential } from '@/lib/credentials';
import { getCredentialOptionLabel, type RepoCredentialSelection } from './types';

export type CloneRemoteDialogProps = {
  isOpen: boolean;
  defaultRoot: string | null | undefined;
  remoteRepoUrl: string;
  cloneCredentialSelection: RepoCredentialSelection;
  credentialOptions: Credential[];
  isCloningRemote: boolean;
  isLoadingCloneCredentialOptions: boolean;
  cloneRemoteError: string | null;
  onClose: () => void;
  onRemoteRepoUrlChange: (value: string) => void;
  onCloneCredentialSelectionChange: (value: RepoCredentialSelection) => void;
  onSetDefaultFolder: (path: string) => void | Promise<void>;
  onCloneProject: () => void;
};

export function CloneRemoteDialog({
  isOpen,
  defaultRoot,
  remoteRepoUrl,
  cloneCredentialSelection,
  credentialOptions,
  isCloningRemote,
  isLoadingCloneCredentialOptions,
  cloneRemoteError,
  onClose,
  onRemoteRepoUrlChange,
  onCloneCredentialSelectionChange,
  onSetDefaultFolder,
  onCloneProject,
}: CloneRemoteDialogProps) {
  const [isDefaultRootBrowserOpen, setIsDefaultRootBrowserOpen] = useState(false);
  const [isSettingDefaultRoot, setIsSettingDefaultRoot] = useState(false);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-[1002] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm app-dark-overlay">
        <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl app-dark-modal">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-5 py-4 md:px-6 app-dark-modal-header">
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Clone Remote Repo</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">Clone a repository into your default root folder.</p>
            </div>
            <button className="app-ui-icon-button" onClick={onClose} disabled={isCloningRemote || isSettingDefaultRoot}>
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto p-5 md:p-6">
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 app-dark-surface">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Default Root Folder</h4>
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    The cloned repository will be created under this folder.
                  </p>
                </div>
                <button
                  type="button"
                  className="app-ui-button"
                  onClick={() => setIsDefaultRootBrowserOpen(true)}
                  disabled={isCloningRemote || isSettingDefaultRoot}
                >
                  {isSettingDefaultRoot ? (
                    <span className="loading loading-spinner loading-xs"></span>
                  ) : (
                    <FolderCog className="h-4 w-4" />
                  )}
                  Select default folder
                </button>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 app-dark-surface-raised">
                <span className="font-semibold text-slate-500 dark:text-slate-400">Default root:</span>{' '}
                <span className="font-mono">{defaultRoot?.trim() || 'Not configured'}</span>
              </div>

              {!defaultRoot?.trim() ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-200">
                  Select a default root folder before cloning this repository.
                </div>
              ) : null}
            </div>

            <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/35 p-4 md:p-5 app-dark-surface">
              <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Clone Remote</h4>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Repository URL</label>
                <input
                  className="input w-full border-slate-200 bg-white font-mono text-sm text-slate-800 focus:border-primary focus:outline-none app-dark-input"
                  placeholder="https://github.com/org/repo.git"
                  value={remoteRepoUrl}
                  onChange={(event) => onRemoteRepoUrlChange(event.target.value)}
                  disabled={isCloningRemote}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Credential</label>
                <select
                  className="select w-full border-slate-200 bg-white text-slate-700 focus:border-primary focus:outline-none app-dark-input"
                  value={cloneCredentialSelection}
                  onChange={(event) => onCloneCredentialSelectionChange(event.target.value)}
                  disabled={isCloningRemote || isLoadingCloneCredentialOptions}
                >
                  <option value="auto">Auto (match repository remote)</option>
                  {credentialOptions.map((credential) => (
                    <option key={credential.id} value={credential.id}>
                      {getCredentialOptionLabel(credential)}
                    </option>
                  ))}
                </select>
                {credentialOptions.length === 0 && !isLoadingCloneCredentialOptions ? (
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    No credentials found. Clone uses anonymous access unless remote auth is configured.
                  </div>
                ) : null}
              </div>

              {isLoadingCloneCredentialOptions ? (
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <span className="loading loading-spinner loading-xs"></span>
                  Loading credentials...
                </div>
              ) : null}

              {isCloningRemote ? (
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 app-dark-surface-raised">
                  <span className="loading loading-spinner loading-xs"></span>
                  Cloning repository...
                </div>
              ) : null}

              {cloneRemoteError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {cloneRemoteError}
                </div>
              ) : null}

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-[color:var(--app-dark-border-subtle)]">
                <button
                  className="app-ui-button"
                  onClick={onClose}
                  disabled={isCloningRemote || isSettingDefaultRoot}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary gap-2"
                  onClick={onCloneProject}
                  disabled={isCloningRemote || isSettingDefaultRoot || !defaultRoot?.trim() || !remoteRepoUrl.trim() || isLoadingCloneCredentialOptions}
                >
                  {isCloningRemote ? <span className="loading loading-spinner loading-xs"></span> : <CloudDownload className="h-4 w-4" />}
                  Clone Project
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isDefaultRootBrowserOpen ? (
        <FileBrowser
          title="Default Root Folder"
          initialPath={defaultRoot || undefined}
          onSelect={async (folderPath) => {
            setIsSettingDefaultRoot(true);
            try {
              await onSetDefaultFolder(folderPath);
              setIsDefaultRootBrowserOpen(false);
            } finally {
              setIsSettingDefaultRoot(false);
            }
          }}
          onCancel={() => {
            if (isSettingDefaultRoot) return;
            setIsDefaultRootBrowserOpen(false);
          }}
          zIndexClassName="z-[1003]"
        />
      ) : null}
    </>
  );
}
