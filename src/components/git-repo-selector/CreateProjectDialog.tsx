'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, CloudDownload, FolderCog, Plus, Trash2, X } from 'lucide-react';
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
  const mobileActionButtonClass = 'app-ui-icon-button w-10 min-w-10 sm:min-h-[2.625rem] sm:w-auto sm:min-w-0 sm:gap-2 sm:rounded-xl sm:px-[0.95rem] sm:text-sm sm:font-semibold';
  const mobilePrimaryActionButtonClass = 'h-10 min-h-10 w-10 min-w-10 justify-center gap-0 px-0 [&_svg]:h-[18px] [&_svg]:w-[18px] sm:w-auto sm:min-w-0 sm:gap-2 sm:px-4 sm:[&_svg]:h-4 sm:[&_svg]:w-4';
  const mobileActionIconClass = 'h-[18px] w-[18px] sm:h-4 sm:w-4';

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-[1002] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-sm app-dark-overlay">
        <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl app-dark-modal">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-5 py-4 md:px-6 app-dark-modal-header">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Create Project</h3>
            <button
              className="app-ui-icon-button"
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
                className="input w-full border-slate-200 bg-slate-50 text-sm text-slate-800 focus:border-primary focus:outline-none app-dark-input"
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
                    className={mobileActionButtonClass}
                    onClick={() => setIsDefaultRootBrowserOpen(true)}
                    disabled={isSubmitting || isSettingDefaultRoot}
                    aria-label="Set default root"
                    title="Set Default Root"
                  >
                    {isSettingDefaultRoot ? (
                      <span className="loading loading-spinner loading-xs"></span>
                    ) : (
                      <FolderCog className={mobileActionIconClass} />
                    )}
                    <span className="sr-only sm:not-sr-only">Set Default Root</span>
                  </button>
                  <button
                    type="button"
                    className={mobileActionButtonClass}
                    onClick={() => setIsFolderBrowserOpen(true)}
                    disabled={isSubmitting || isSettingDefaultRoot}
                    aria-label="Add folder"
                    title="Add Folder"
                  >
                    <Plus className={mobileActionIconClass} />
                    <span className="sr-only sm:not-sr-only">Add Folder</span>
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 app-dark-surface">
                {selectedFolderPaths.length === 0 ? (
                  <div className="text-sm text-slate-500 dark:text-slate-400">
                    No folders selected yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedFolderPaths.map((folderPath) => (
                      <div
                        key={folderPath}
                        className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 app-dark-surface-raised"
                      >
                        <div className="min-w-0 flex-1 break-all font-mono text-xs text-slate-700 dark:text-slate-200">
                          {folderPath}
                        </div>
                        <button
                          type="button"
                          className="app-ui-icon-button app-ui-icon-button-danger app-ui-icon-button-sm"
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

            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4 app-dark-surface">
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
                    className="input w-full border-slate-200 bg-white text-sm text-slate-800 focus:border-primary focus:outline-none app-dark-input"
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

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-[color:var(--app-dark-border-subtle)]">
              {onCloneRemote ? (
                <button
                  type="button"
                  className={`${mobileActionButtonClass} mr-auto`}
                  onClick={onCloneRemote}
                  disabled={isSubmitting}
                  aria-label="Clone remote repo"
                  title="Clone Remote Repo"
                >
                  <CloudDownload className={mobileActionIconClass} />
                  <span className="sr-only sm:not-sr-only">Clone Remote Repo</span>
                </button>
              ) : null}
              <button
                type="button"
                className={mobileActionButtonClass}
                onClick={onClose}
                disabled={isSubmitting}
                aria-label="Cancel"
                title="Cancel"
              >
                <X className={mobileActionIconClass} />
                <span className="sr-only sm:not-sr-only">Cancel</span>
              </button>
              <button
                type="button"
                className={`btn btn-primary ${mobilePrimaryActionButtonClass}`}
                onClick={handleSubmit}
                disabled={!canSubmit || isSubmitting}
                aria-label="Create project"
                title="Create Project"
              >
                <Check className={mobileActionIconClass} />
                <span className="sr-only sm:not-sr-only">Create Project</span>
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
