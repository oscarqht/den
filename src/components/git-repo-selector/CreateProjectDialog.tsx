'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderCog, Plus, Trash2, X } from 'lucide-react';
import { checkDirectoryAccessible } from '@/app/actions/git';
import FileBrowser from '@/components/FileBrowser';
import { getBaseName } from '@/lib/path';
import { useDialogKeyboardShortcuts } from '@/hooks/useDialogKeyboardShortcuts';

type CreateProjectDialogSubmit = {
  name: string;
  folderPaths: string[];
  createDefaultFolder?: {
    enabled: boolean;
    folderName?: string;
  };
};

export type CreateProjectDialogProps = {
  isOpen: boolean;
  defaultRoot?: string;
  isSubmitting: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (payload: CreateProjectDialogSubmit) => void | Promise<void>;
  onCloneRemote?: () => void;
  onSetDefaultRoot: (path: string) => void | Promise<void>;
};

export function CreateProjectDialog({
  isOpen,
  defaultRoot,
  isSubmitting,
  error,
  onClose,
  onCreate,
  onCloneRemote,
  onSetDefaultRoot,
}: CreateProjectDialogProps) {
  const [projectName, setProjectName] = useState('');
  const [selectedFolderPaths, setSelectedFolderPaths] = useState<string[]>([]);
  const [isFolderBrowserOpen, setIsFolderBrowserOpen] = useState(false);
  const [isDefaultRootBrowserOpen, setIsDefaultRootBrowserOpen] = useState(false);
  const [shouldCreateDefaultFolder, setShouldCreateDefaultFolder] = useState(false);
  const [defaultFolderName, setDefaultFolderName] = useState('');
  const [isDefaultRootAccessible, setIsDefaultRootAccessible] = useState(false);
  const [hasEditedProjectName, setHasEditedProjectName] = useState(false);
  const [hasEditedDefaultFolderName, setHasEditedDefaultFolderName] = useState(false);
  const [isSettingDefaultRoot, setIsSettingDefaultRoot] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    setProjectName('');
    setSelectedFolderPaths([]);
    setIsFolderBrowserOpen(false);
    setIsDefaultRootBrowserOpen(false);
    setShouldCreateDefaultFolder(false);
    setDefaultFolderName('');
    setHasEditedProjectName(false);
    setHasEditedDefaultFolderName(false);
    setIsSettingDefaultRoot(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!defaultRoot?.trim()) {
      setIsDefaultRootAccessible(false);
      return;
    }

    let isCancelled = false;
    void checkDirectoryAccessible(defaultRoot).then((isAccessible) => {
      if (!isCancelled) {
        setIsDefaultRootAccessible(isAccessible);
      }
    }).catch(() => {
      if (!isCancelled) {
        setIsDefaultRootAccessible(false);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [defaultRoot, isOpen]);

  useEffect(() => {
    if (hasEditedDefaultFolderName) return;
    setDefaultFolderName(projectName.trim());
  }, [hasEditedDefaultFolderName, projectName]);

  const canUseDefaultRoot = Boolean(defaultRoot?.trim()) && isDefaultRootAccessible;
  const trimmedProjectName = projectName.trim();
  const trimmedDefaultFolderName = defaultFolderName.trim();
  const resolvedDefaultFolderPath = shouldCreateDefaultFolder && defaultRoot?.trim() && trimmedDefaultFolderName
    ? `${defaultRoot.replace(/[\\/]+$/, '')}/${trimmedDefaultFolderName}`
    : null;
  const canSubmit = trimmedProjectName.length > 0
    && (!shouldCreateDefaultFolder || (canUseDefaultRoot && trimmedDefaultFolderName.length > 0));

  const addFolderPath = useCallback((folderPath: string) => {
    const trimmedPath = folderPath.trim();
    if (!trimmedPath) return;

    setSelectedFolderPaths((previous) => {
      if (previous.includes(trimmedPath)) {
        return previous;
      }
      return [...previous, trimmedPath];
    });

    if (!hasEditedProjectName && !trimmedProjectName) {
      const fallbackName = getBaseName(trimmedPath);
      if (fallbackName) {
        setProjectName(fallbackName);
      }
    }
  }, [hasEditedProjectName, trimmedProjectName]);

  const handleProjectNameChange = useCallback((value: string) => {
    setHasEditedProjectName(true);
    setProjectName(value);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!canSubmit || isSubmitting) return;

    void onCreate({
      name: trimmedProjectName,
      folderPaths: selectedFolderPaths,
      createDefaultFolder: shouldCreateDefaultFolder
        ? {
            enabled: true,
            folderName: trimmedDefaultFolderName || undefined,
          }
        : undefined,
    });
  }, [
    canSubmit,
    isSubmitting,
    onCreate,
    selectedFolderPaths,
    shouldCreateDefaultFolder,
    trimmedDefaultFolderName,
    trimmedProjectName,
  ]);

  useDialogKeyboardShortcuts({
    enabled: isOpen && !isFolderBrowserOpen,
    onConfirm: handleSubmit,
    onDismiss: onClose,
    canConfirm: canSubmit && !isSubmitting,
  });

  const folderCountLabel = useMemo(() => (
    selectedFolderPaths.length === 1 ? '1 associated folder' : `${selectedFolderPaths.length} associated folders`
  ), [selectedFolderPaths.length]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-[1002] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-sm">
        <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#151b26]">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-5 py-4 md:px-6 dark:border-white/10 dark:bg-[#1e2532]/75">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Create Project</h3>
            <button
              className="btn btn-circle btn-ghost btn-sm text-slate-500 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
              onClick={onClose}
              disabled={isSubmitting}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-5 p-5 md:p-6">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Project Name
              </label>
              <input
                className="input w-full border-slate-200 bg-slate-50 text-sm text-slate-800 focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-[#1e2532] dark:text-slate-200"
                value={projectName}
                onChange={(event) => handleProjectNameChange(event.target.value)}
                placeholder="Project name"
                disabled={isSubmitting}
              />
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Required. Defaults from the first associated folder when you have not entered a name yet.
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Associated Folders
                  </label>
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Optional. You can create a metadata-only project and add folders later.
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm gap-2 text-slate-700 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                    onClick={() => setIsDefaultRootBrowserOpen(true)}
                    disabled={isSubmitting || isSettingDefaultRoot}
                  >
                    {isSettingDefaultRoot ? (
                      <span className="loading loading-spinner loading-xs"></span>
                    ) : (
                      <FolderCog className="h-4 w-4" />
                    )}
                    Set Default Root
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm gap-2"
                    onClick={() => setIsFolderBrowserOpen(true)}
                    disabled={isSubmitting || isSettingDefaultRoot}
                  >
                    <Plus className="h-4 w-4" />
                    Add Folder
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-[#1e2532]/70">
                {selectedFolderPaths.length === 0 ? (
                  <div className="text-sm text-slate-500 dark:text-slate-400">
                    No folders selected yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedFolderPaths.map((folderPath) => (
                      <div
                        key={folderPath}
                        className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-[#151b26]"
                      >
                        <div className="min-w-0 flex-1 break-all font-mono text-xs text-slate-700 dark:text-slate-200">
                          {folderPath}
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs text-red-600 dark:text-red-300"
                          onClick={() => {
                            setSelectedFolderPaths((previous) => previous.filter((currentPath) => currentPath !== folderPath));
                          }}
                          disabled={isSubmitting}
                          title="Remove associated folder"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">{folderCountLabel}</div>
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-[#1e2532]/70">
              <label className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600 dark:bg-slate-900"
                  checked={shouldCreateDefaultFolder}
                  onChange={(event) => {
                    const nextChecked = event.target.checked;
                    setShouldCreateDefaultFolder(nextChecked);
                    if (nextChecked && !hasEditedDefaultFolderName) {
                      setDefaultFolderName(trimmedProjectName);
                    }
                  }}
                  disabled={isSubmitting || !canUseDefaultRoot}
                />
                <span>
                  Create new folder under default root
                  <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                    Unchecked by default. The new folder is added as the first associated folder.
                  </span>
                </span>
              </label>

              <div className="text-xs text-slate-500 dark:text-slate-400">
                Default root: {defaultRoot?.trim() || 'Not configured'}
              </div>

              {!canUseDefaultRoot ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-200">
                  Set a valid default root folder before using this option.
                </div>
              ) : null}

              {shouldCreateDefaultFolder ? (
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    New Folder Name
                  </label>
                  <input
                    className="input w-full border-slate-200 bg-white text-sm text-slate-800 focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-[#151b26] dark:text-slate-200"
                    value={defaultFolderName}
                    onChange={(event) => {
                      setHasEditedDefaultFolderName(true);
                      setDefaultFolderName(event.target.value);
                    }}
                    placeholder="Folder name"
                    disabled={isSubmitting || !canUseDefaultRoot}
                  />
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Target path: {resolvedDefaultFolderPath || 'Enter a folder name'}
                  </div>
                </div>
              ) : null}
            </div>

            {isSubmitting ? (
              <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <span className="loading loading-spinner loading-xs"></span>
                Creating project...
              </div>
            ) : null}

            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-200">
                {error}
              </div>
            ) : null}

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-white/10">
              {onCloneRemote ? (
                <button
                  className="btn btn-ghost mr-auto"
                  onClick={onCloneRemote}
                  disabled={isSubmitting}
                >
                  Clone Remote Repo
                </button>
              ) : null}
              <button
                className="btn btn-ghost text-slate-700 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={!canSubmit || isSubmitting}
              >
                Create Project
              </button>
            </div>
          </div>
        </div>
      </div>

      {isFolderBrowserOpen ? (
        <FileBrowser
          title="Choose Associated Folder"
          initialPath={defaultRoot}
          onSelect={async (folderPath) => {
            addFolderPath(folderPath);
            setIsFolderBrowserOpen(false);
          }}
          onCancel={() => setIsFolderBrowserOpen(false)}
          zIndexClassName="z-[1003]"
        />
      ) : null}

      {isDefaultRootBrowserOpen ? (
        <FileBrowser
          title="Default Root Folder"
          initialPath={defaultRoot}
          onSelect={async (folderPath) => {
            setIsSettingDefaultRoot(true);
            try {
              await onSetDefaultRoot(folderPath);
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
