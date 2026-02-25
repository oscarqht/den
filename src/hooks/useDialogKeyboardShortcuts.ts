import { useEffect } from 'react';

type UseDialogKeyboardShortcutsOptions = {
  enabled?: boolean;
  onConfirm?: () => void | Promise<unknown>;
  onDismiss: () => void;
  canConfirm?: boolean;
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toUpperCase();
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable;
};

export function useDialogKeyboardShortcuts({
  enabled = true,
  onConfirm,
  onDismiss,
  canConfirm = true,
}: UseDialogKeyboardShortcutsOptions) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismiss();
        return;
      }

      if (event.key !== 'Enter') return;
      if (!onConfirm || !canConfirm) return;
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isEditableTarget(event.target)) return;

      event.preventDefault();
      void onConfirm();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, onConfirm, onDismiss, canConfirm]);
}
