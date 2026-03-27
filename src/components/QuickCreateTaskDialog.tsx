'use client';

import SessionFileBrowser from '@/components/SessionFileBrowser';
import { useDialogKeyboardShortcuts } from '@/hooks/useDialogKeyboardShortcuts';
import type { QuickCreateDraft } from '@/lib/quick-create';
import { getBaseName } from '@/lib/path';
import { SESSION_MOBILE_VIEWPORT_QUERY } from '@/lib/responsive';
import { uploadAttachments } from '@/lib/upload-attachments';
import { CloudDownload, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

type QuickCreateSubmitInput = {
  draftId?: string | null;
  message: string;
  attachmentPaths: string[];
};

type QuickCreateTaskDialogProps = {
  isOpen: boolean;
  draft?: QuickCreateDraft | null;
  defaultRoot?: string;
  onClose: () => void;
  onSubmit: (input: QuickCreateSubmitInput) => Promise<{ success: boolean; error?: string }>;
};

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

function createAttachmentNamespaceId(draft?: QuickCreateDraft | null): string {
  if (draft?.id?.trim()) return draft.id.trim();
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function QuickCreateTaskDialog({
  isOpen,
  draft = null,
  defaultRoot,
  onClose,
  onSubmit,
}: QuickCreateTaskDialogProps) {
  const [message, setMessage] = useState('');
  const [attachmentPaths, setAttachmentPaths] = useState<string[]>([]);
  const [attachmentNamespaceId, setAttachmentNamespaceId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPastingAttachments, setIsPastingAttachments] = useState(false);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [isAttachmentBrowserOpen, setIsAttachmentBrowserOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const mobileAttachmentInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setIsAttachmentBrowserOpen(false);
      setIsSubmitting(false);
      setIsPastingAttachments(false);
      setIsUploadingAttachments(false);
      return;
    }

    setMessage(draft?.message ?? '');
    setAttachmentPaths(draft?.attachmentPaths ?? []);
    setAttachmentNamespaceId(createAttachmentNamespaceId(draft));
    setError(draft?.lastError ?? null);
    setIsSubmitting(false);
    setIsPastingAttachments(false);
    setIsUploadingAttachments(false);
    setIsAttachmentBrowserOpen(false);
  }, [draft, isOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia(SESSION_MOBILE_VIEWPORT_QUERY);
    const updateIsMobileViewport = () => setIsMobileViewport(mediaQuery.matches);
    updateIsMobileViewport();

    mediaQuery.addEventListener('change', updateIsMobileViewport);
    return () => mediaQuery.removeEventListener('change', updateIsMobileViewport);
  }, []);

  const appendAttachmentPaths = useCallback((incomingPaths: string[]) => {
    if (incomingPaths.length === 0) return;
    setAttachmentPaths((current) => Array.from(new Set([
      ...current,
      ...incomingPaths.map((entry) => entry.trim()).filter(Boolean),
    ])));
    setError(null);
  }, []);

  const handleTaskDescriptionPaste = useCallback(async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = getClipboardImageFiles(event.clipboardData);
    if (imageFiles.length === 0) return;

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
          : `quick-create-${timestamp}-${index + 1}.${normalizedExtension}`;
        formData.append(`image-${index}`, new File([file], fileName, { type: file.type || 'image/png' }));
      });

      const savedPaths = await uploadAttachments(`quick-create-${attachmentNamespaceId}`, formData);
      if (savedPaths.length === 0) {
        throw new Error('Failed to save pasted images.');
      }

      appendAttachmentPaths(savedPaths);
    } catch (pasteError) {
      setError(pasteError instanceof Error ? pasteError.message : 'Failed to paste image attachments.');
    } finally {
      setIsPastingAttachments(false);
    }
  }, [appendAttachmentPaths, attachmentNamespaceId]);

  const handleMobileAttachmentSelection = useCallback(async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    setError(null);
    setIsUploadingAttachments(true);

    try {
      const formData = new FormData();
      files.forEach((file, index) => {
        const fileName = file.name.trim() || `attachment-${Date.now()}-${index + 1}`;
        formData.append(`attachment-${index}`, file, fileName);
      });

      const savedPaths = await uploadAttachments(`quick-create-${attachmentNamespaceId}`, formData);
      if (savedPaths.length === 0) {
        throw new Error('Failed to upload selected attachments.');
      }

      appendAttachmentPaths(savedPaths);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Failed to upload selected attachments.');
    } finally {
      setIsUploadingAttachments(false);
    }
  }, [appendAttachmentPaths, attachmentNamespaceId]);

  const handleSelectAttachments = useCallback(() => {
    if (isMobileViewport) {
      mobileAttachmentInputRef.current?.click();
      return;
    }

    setIsAttachmentBrowserOpen(true);
  }, [isMobileViewport]);

  const handleSubmit = useCallback(async () => {
    if (!message.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const result = await onSubmit({
        draftId: draft?.id ?? null,
        message,
        attachmentPaths,
      });
      if (!result.success) {
        setError(result.error || 'Failed to start quick create.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [attachmentPaths, draft?.id, isSubmitting, message, onSubmit]);

  useDialogKeyboardShortcuts({
    enabled: isOpen && !isAttachmentBrowserOpen,
    onConfirm: handleSubmit,
    onDismiss: onClose,
    canConfirm: message.trim().length > 0 && !isSubmitting,
  });

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[1004] flex bg-slate-950/55 backdrop-blur-sm max-[1023px]:items-stretch max-[1023px]:justify-stretch max-[1023px]:p-0 min-[1024px]:items-center min-[1024px]:justify-center min-[1024px]:p-4"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !isSubmitting) {
            onClose();
          }
        }}
      >
        <div className="flex w-full flex-col border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#151b26] max-[1023px]:h-[100dvh] max-[1023px]:w-screen max-[1023px]:min-w-full max-[1023px]:max-w-none max-[1023px]:rounded-none max-[1023px]:border-x-0 max-[1023px]:border-y-0 max-[1023px]:shadow-none min-[1024px]:h-[min(760px,92vh)] min-[1024px]:max-w-3xl min-[1024px]:rounded-2xl">
          <div className="mx-auto flex w-full items-center justify-between border-b border-slate-100 dark:border-white/10 max-[1023px]:max-w-[42rem] max-[1023px]:px-5 max-[1023px]:pb-3 max-[1023px]:pt-[max(1rem,env(safe-area-inset-top))] min-[1024px]:max-w-none min-[1024px]:px-5 min-[1024px]:py-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {draft ? 'Retry Quick Create Task' : 'Create Task'}
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Describe the task and attach any relevant files before Palx routes it to the best project.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-circle btn-ghost btn-sm"
              onClick={onClose}
              disabled={isSubmitting}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mx-auto flex w-full flex-1 flex-col gap-4 overflow-y-auto max-[1023px]:max-w-[42rem] max-[1023px]:px-5 max-[1023px]:py-5 min-[1024px]:max-w-none min-[1024px]:p-5">
            {error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
                {error}
              </div>
            ) : null}

            <div className="flex flex-1 flex-col">
              <label
                htmlFor="quick-create-message"
                className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300"
              >
                Task Description
              </label>
              <textarea
                id="quick-create-message"
                className="min-h-[260px] w-full flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-sm leading-relaxed text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30 dark:border-[#30363d] dark:bg-[#0d1117] dark:text-slate-100 dark:placeholder:text-slate-500"
                placeholder={`Describe the task for the AI agent...\n\nExample:\n- Fix the broken checkout total on mobile.\n- Update the failing API integration tests.\n- Add screenshots or logs as attachments if useful.`}
                value={message}
                onChange={(event) => {
                  setMessage(event.target.value);
                  if (error) {
                    setError(null);
                  }
                }}
                onPaste={(event) => {
                  void handleTaskDescriptionPaste(event);
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.shiftKey) return;
                  event.preventDefault();
                  void handleSubmit();
                }}
                disabled={isSubmitting}
              />
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Press Enter to start background create, Shift+Enter for a new line.
              </p>
            </div>

            <div className="border-t border-slate-100 pt-4 dark:border-slate-700/70">
              <div className="mb-3 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Attachments</h4>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 text-sm font-medium text-primary transition-colors hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleSelectAttachments}
                  disabled={isSubmitting || isUploadingAttachments}
                >
                  <CloudDownload className="h-4 w-4" />
                  Select Attachments
                </button>
              </div>

              {isPastingAttachments ? (
                <div className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                  Saving pasted image attachments...
                </div>
              ) : null}

              {isUploadingAttachments ? (
                <div className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                  Uploading selected attachments...
                </div>
              ) : null}

              <div className="min-h-[88px] rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-[#0d1117]/40">
                <div className="flex flex-wrap gap-2">
                  {attachmentPaths.map((attachmentPath, index) => (
                    <span
                      key={`${attachmentPath}-${index}`}
                      className="inline-flex max-w-full items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      title={attachmentPath}
                    >
                      <span className="truncate">{getBaseName(attachmentPath)}</span>
                      <button
                        type="button"
                        className="rounded text-slate-500 transition hover:text-red-500 dark:text-slate-400 dark:hover:text-red-400"
                        onClick={() => {
                          setAttachmentPaths((current) => current.filter((_, currentIndex) => currentIndex !== index));
                        }}
                        title="Remove attachment"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}

                  {attachmentPaths.length === 0 ? (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      No attachments selected. Paste images into the description field or pick files from disk.
                    </span>
                  ) : null}
                </div>
              </div>

              <input
                ref={mobileAttachmentInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleMobileAttachmentSelection}
              />
            </div>
          </div>

          <div className="mx-auto flex w-full items-center justify-end gap-3 border-t border-slate-100 dark:border-white/10 max-[1023px]:max-w-[42rem] max-[1023px]:px-5 max-[1023px]:pb-[max(1rem,env(safe-area-inset-bottom))] max-[1023px]:pt-4 min-[1024px]:max-w-none min-[1024px]:px-5 min-[1024px]:py-4">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                void handleSubmit();
              }}
              disabled={isSubmitting || message.trim().length === 0}
            >
              {isSubmitting ? (
                <span className="loading loading-spinner loading-xs"></span>
              ) : (
                'Start Background Create'
              )}
            </button>
          </div>
        </div>
      </div>

      {isAttachmentBrowserOpen ? (
        <SessionFileBrowser
          title="Select Attachments"
          initialPath={defaultRoot}
          selectionMode="multiple"
          confirmLabel="Attach Selected Files"
          zIndexClassName="z-[1005]"
          onConfirm={async (selectedPaths) => {
            appendAttachmentPaths(selectedPaths);
            setIsAttachmentBrowserOpen(false);
          }}
          onCancel={() => setIsAttachmentBrowserOpen(false)}
        />
      ) : null}
    </>
  );
}
