import { useState } from 'react';
import { ImagePlus, Plus, Trash2, X } from 'lucide-react';
import SessionFileBrowser from '@/components/SessionFileBrowser';
import FileBrowser from '@/components/FileBrowser';
import { getProjectIconUrl } from '@/lib/project-icons';

export type RepoSettingsDialogProps = {
  isOpen: boolean;
  projectId: string | null;
  projectForSettings: string | null;
  projectName: string;
  projectFolderPaths: string[];
  defaultRoot?: string;
  projectStartupCommand: string;
  projectDevServerCommand: string;
  projectServiceStartCommand: string;
  projectServiceStopCommand: string;
  defaultProjectStartupCommand: string;
  defaultProjectDevServerCommand: string;
  defaultProjectServiceStartCommand: string;
  defaultProjectServiceStopCommand: string;
  projectIconPath: string | null;
  isSavingProjectSettings: boolean;
  isUploadingProjectIcon: boolean;
  projectSettingsError: string | null;
  onNameChange: (value: string) => void;
  onAddFolderPath: (path: string) => void;
  onRemoveFolderPath: (path: string) => void;
  onStartupCommandChange: (value: string) => void;
  onDevServerCommandChange: (value: string) => void;
  onServiceStartCommandChange: (value: string) => void;
  onServiceStopCommandChange: (value: string) => void;
  onUploadIcon: (iconPath: string) => void;
  onRemoveIcon: () => void;
  onClose: () => void;
  onSave: () => void;
};

export function RepoSettingsDialog({
  isOpen,
  projectId,
  projectForSettings,
  projectName,
  projectFolderPaths,
  defaultRoot,
  projectStartupCommand,
  projectDevServerCommand,
  projectServiceStartCommand,
  projectServiceStopCommand,
  defaultProjectStartupCommand,
  defaultProjectDevServerCommand,
  defaultProjectServiceStartCommand,
  defaultProjectServiceStopCommand,
  projectIconPath,
  isSavingProjectSettings,
  isUploadingProjectIcon,
  projectSettingsError,
  onNameChange,
  onAddFolderPath,
  onRemoveFolderPath,
  onStartupCommandChange,
  onDevServerCommandChange,
  onServiceStartCommandChange,
  onServiceStopCommandChange,
  onUploadIcon,
  onRemoveIcon,
  onClose,
  onSave,
}: RepoSettingsDialogProps) {
  const [isIconBrowserOpen, setIsIconBrowserOpen] = useState(false);
  const [isFolderBrowserOpen, setIsFolderBrowserOpen] = useState(false);

  if (!isOpen || !projectId) return null;

  const iconPreviewUrl = getProjectIconUrl(projectIconPath);
  const iconBrowserInitialPath = projectFolderPaths[0] || projectForSettings || defaultRoot;

  return (
    <>
      <div className="fixed inset-0 z-[1002] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-sm">
        <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#151b26]">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-5 py-4 md:px-6 dark:border-white/10 dark:bg-[#1e2532]/75">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">Project Settings</h3>
          <button
            className="btn btn-circle btn-ghost btn-sm text-slate-500 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
            onClick={onClose}
            disabled={isSavingProjectSettings || isUploadingProjectIcon}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-5 md:p-6">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Project ID</label>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 break-all font-mono text-xs text-slate-700 dark:border-slate-700 dark:bg-[#1e2532] dark:text-slate-200">
              {projectId}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Project Name</label>
            <input
              className="input w-full border-slate-200 bg-slate-50 text-sm text-slate-800 focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-[#1e2532] dark:text-slate-200"
              value={projectName}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Project name"
              disabled={isSavingProjectSettings || isUploadingProjectIcon}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Associated Folders</label>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Add or remove folders linked to this project.
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm gap-2"
                onClick={() => setIsFolderBrowserOpen(true)}
                disabled={isSavingProjectSettings || isUploadingProjectIcon}
              >
                <Plus className="h-4 w-4" />
                Add Folder
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-[#1e2532]/70">
              {projectFolderPaths.length === 0 ? (
                <div className="text-sm text-slate-600 dark:text-slate-300">
                  No folders are associated yet. Sessions can still start in local mode from your home directory.
                </div>
              ) : (
                <div className="space-y-2">
                  {projectFolderPaths.map((folderPath) => (
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
                        onClick={() => onRemoveFolderPath(folderPath)}
                        disabled={isSavingProjectSettings || isUploadingProjectIcon}
                        title="Remove associated folder"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Project Icon</label>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={iconPreviewUrl} alt="Project icon" className="h-full w-full object-cover" />
              </div>
              <button
                type="button"
                className="btn btn-sm gap-2"
                disabled={isUploadingProjectIcon || isSavingProjectSettings}
                onClick={() => setIsIconBrowserOpen(true)}
              >
                <ImagePlus className="h-4 w-4" />
                Choose Icon
              </button>
              {projectIconPath && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm gap-2 text-red-600"
                  disabled={isUploadingProjectIcon || isSavingProjectSettings}
                  onClick={onRemoveIcon}
                >
                  <Trash2 className="h-4 w-4" />
                  Remove
                </button>
              )}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Supported: png, jpg, jpeg, webp, svg, ico. Max 2MB. Projects without a custom icon use the bundled default icon.
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Start Up Command</label>
            <textarea
              className="textarea w-full border-slate-200 bg-slate-50 font-mono text-sm text-slate-800 focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-[#1e2532] dark:text-slate-200"
              rows={3}
              value={projectStartupCommand}
              onChange={(event) => onStartupCommandChange(event.target.value)}
              placeholder={defaultProjectStartupCommand}
              disabled={isSavingProjectSettings || isUploadingProjectIcon}
            />
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Multi-line commands are supported.
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Dev Server Command</label>
            <textarea
              className="textarea w-full border-slate-200 bg-slate-50 font-mono text-sm text-slate-800 focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-[#1e2532] dark:text-slate-200"
              rows={3}
              value={projectDevServerCommand}
              onChange={(event) => onDevServerCommandChange(event.target.value)}
              placeholder={defaultProjectDevServerCommand}
              disabled={isSavingProjectSettings || isUploadingProjectIcon}
            />
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Multi-line commands are supported.
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Start Service Command</label>
              <textarea
                className="textarea w-full border-slate-200 bg-slate-50 font-mono text-sm text-slate-800 focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-[#1e2532] dark:text-slate-200"
                rows={3}
                value={projectServiceStartCommand}
                onChange={(event) => onServiceStartCommandChange(event.target.value)}
                placeholder={defaultProjectServiceStartCommand}
                disabled={isSavingProjectSettings || isUploadingProjectIcon}
              />
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Projects with a start service command get service controls on the project card.
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Stop Service Command</label>
              <textarea
                className="textarea w-full border-slate-200 bg-slate-50 font-mono text-sm text-slate-800 focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-[#1e2532] dark:text-slate-200"
                rows={3}
                value={projectServiceStopCommand}
                onChange={(event) => onServiceStopCommandChange(event.target.value)}
                placeholder={defaultProjectServiceStopCommand}
                disabled={isSavingProjectSettings || isUploadingProjectIcon}
              />
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Optional. If omitted, stop falls back to terminating the managed service process directly.
              </div>
            </div>
          </div>

          {(isUploadingProjectIcon || isSavingProjectSettings) && (
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <span className="loading loading-spinner loading-xs"></span>
              {isUploadingProjectIcon ? 'Uploading icon...' : 'Saving project settings...'}
            </div>
          )}

          {projectSettingsError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {projectSettingsError}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-white/10">
            <button
              className="btn btn-ghost text-slate-700 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
              onClick={onClose}
              disabled={isSavingProjectSettings || isUploadingProjectIcon}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={onSave}
              disabled={isSavingProjectSettings || isUploadingProjectIcon}
            >
              Save
            </button>
          </div>
        </div>
        </div>
      </div>

      {isIconBrowserOpen && (
        <SessionFileBrowser
          title="Choose Project Icon"
          initialPath={iconBrowserInitialPath}
          onConfirm={async (paths) => {
            const selectedPath = paths[0];
            if (!selectedPath) return;
            onUploadIcon(selectedPath);
            setIsIconBrowserOpen(false);
          }}
          onCancel={() => setIsIconBrowserOpen(false)}
          confirmLabel="Use Selected Icon"
          defaultViewMode="grid"
          viewModeStorageKey={null}
          selectionMode="single"
          allowedFileExtensions={['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico']}
          zIndexClassName="z-[1003]"
        />
      )}

      {isFolderBrowserOpen ? (
        <FileBrowser
          title="Choose Associated Folder"
          initialPath={projectFolderPaths[0] || defaultRoot}
          onSelect={async (folderPath) => {
            onAddFolderPath(folderPath);
            setIsFolderBrowserOpen(false);
          }}
          onCancel={() => setIsFolderBrowserOpen(false)}
          zIndexClassName="z-[1003]"
        />
      ) : null}
    </>
  );
}
