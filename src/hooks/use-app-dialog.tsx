'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useEscapeDismiss } from './use-escape-dismiss';

type DialogVariant = 'primary' | 'danger';

type BaseDialogOptions = {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: DialogVariant;
};

type ConfirmDialogOptions = BaseDialogOptions & {
  kind: 'confirm';
};

type PromptDialogOptions = BaseDialogOptions & {
  kind: 'prompt';
  defaultValue?: string;
  placeholder?: string;
  inputLabel?: string;
  requireNonEmpty?: boolean;
};

type DialogRequest = (ConfirmDialogOptions | PromptDialogOptions) & {
  requestId: number;
};
type DialogResolver = (value: boolean | string | null) => void;

type AppDialogModalProps = {
  request: DialogRequest;
  onCancel: () => void;
  onConfirm: (value?: string) => void;
};

function AppDialogModal({ request, onCancel, onConfirm }: AppDialogModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState(
    request.kind === 'prompt' ? (request.defaultValue ?? '') : '',
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (request.kind === 'prompt') {
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      confirmButtonRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [request]);

  useEscapeDismiss(
    true,
    onCancel,
    request.kind === 'confirm' ? () => onConfirm() : undefined,
  );

  const canSubmit = request.kind === 'confirm'
    || !request.requireNonEmpty
    || value.trim().length > 0;

  const confirmButtonClass = cn(
    'btn min-w-24',
    request.confirmVariant === 'danger' ? 'btn-error' : 'btn-primary',
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={request.description ? descriptionId : undefined}
        className="w-full max-w-md rounded-2xl border border-base-300 bg-base-100 shadow-2xl"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            onConfirm(request.kind === 'prompt' ? value : undefined);
          }}
        >
          <div className="border-b border-base-300 px-6 py-5">
            <h2 id={titleId} className="text-lg font-semibold text-base-content">
              {request.title}
            </h2>
            {request.description ? (
              <div
                id={descriptionId}
                className="mt-2 whitespace-pre-line text-sm leading-6 text-base-content/70"
              >
                {request.description}
              </div>
            ) : null}
          </div>

          {request.kind === 'prompt' ? (
            <div className="px-6 py-5">
              <label className="block text-sm font-medium text-base-content" htmlFor={inputId}>
                {request.inputLabel ?? 'Value'}
              </label>
              <input
                ref={inputRef}
                id={inputId}
                type="text"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={request.placeholder}
                className="input input-bordered mt-2 w-full"
              />
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3 border-t border-base-300 px-6 py-4">
            <button type="button" className="btn btn-ghost min-w-24" onClick={onCancel}>
              {request.cancelLabel ?? 'Cancel'}
            </button>
            <button
              ref={confirmButtonRef}
              type="submit"
              className={confirmButtonClass}
              disabled={!canSubmit}
            >
              {request.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

export function useAppDialog() {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const resolverRef = useRef<DialogResolver | null>(null);
  const activeRequestRef = useRef<DialogRequest | null>(null);
  const nextRequestIdRef = useRef(0);

  const resolveRequest = useCallback((value: boolean | string | null) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    activeRequestRef.current = null;
    setRequest(null);
    resolver?.(value);
  }, []);

  const dismissActiveRequest = useCallback(() => {
    const activeRequest = activeRequestRef.current;
    if (!activeRequest) return;
    resolveRequest(activeRequest.kind === 'prompt' ? null : false);
  }, [resolveRequest]);

  useEffect(() => {
    return () => {
      const activeRequest = activeRequestRef.current;
      if (!activeRequest || !resolverRef.current) return;
      const resolver = resolverRef.current;
      resolverRef.current = null;
      activeRequestRef.current = null;
      resolver(activeRequest.kind === 'prompt' ? null : false);
    };
  }, []);

  const openRequest = useCallback(function openRequest<T extends boolean | string | null>(
    nextRequest: Omit<DialogRequest, 'requestId'>,
  ): Promise<T> {
      dismissActiveRequest();

      return new Promise<T>((resolve) => {
        const requestWithId: DialogRequest = {
          ...nextRequest,
          requestId: ++nextRequestIdRef.current,
        };
        resolverRef.current = resolve as DialogResolver;
        activeRequestRef.current = requestWithId;
        setRequest(requestWithId);
      });
    },
    [dismissActiveRequest],
  );

  const confirm = useCallback((options: Omit<ConfirmDialogOptions, 'kind'>) => {
    return openRequest<boolean>({
      kind: 'confirm',
      cancelLabel: 'Cancel',
      confirmLabel: 'Confirm',
      confirmVariant: 'primary',
      ...options,
    });
  }, [openRequest]);

  const prompt = useCallback((options: Omit<PromptDialogOptions, 'kind'>) => {
    return openRequest<string | null>({
      kind: 'prompt',
      cancelLabel: 'Cancel',
      confirmLabel: 'Save',
      confirmVariant: 'primary',
      ...options,
    });
  }, [openRequest]);

  return {
    isOpen: request !== null,
    confirm,
    prompt,
    dialog: request ? (
      <AppDialogModal
        key={request.requestId}
        request={request}
        onCancel={dismissActiveRequest}
        onConfirm={(value) => {
          resolveRequest(request.kind === 'prompt' ? (value ?? '') : true);
        }}
      />
    ) : null,
  };
}
