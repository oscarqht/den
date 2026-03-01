"use client"

import * as React from "react"

const TOAST_LIMIT = 5
const TOAST_REMOVE_DELAY = 5000

// Helper to copy text to clipboard
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      return true;
    } catch {
      return false;
    } finally {
      document.body.removeChild(textArea);
    }
  }
}

export type ToastType = "default" | "success" | "warning" | "error" | "info"

export interface Toast {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  type?: ToastType
  variant?: "default" | "destructive" | "warning" // For compatibility
  duration?: number
  action?: React.ReactNode
}

let count = 0

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER
  return count.toString()
}

type Action =
  | {
      type: "ADD_TOAST"
      toast: Toast
    }
  | {
      type: "UPDATE_TOAST"
      toast: Partial<Toast>
    }
  | {
      type: "DISMISS_TOAST"
      toastId?: string
    }
  | {
      type: "REMOVE_TOAST"
      toastId?: string
    }

interface State {
  toasts: Toast[]
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

const addToRemoveQueue = (toastId: string, duration = TOAST_REMOVE_DELAY) => {
  if (toastTimeouts.has(toastId)) {
    return
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId)
    dispatch({
      type: "REMOVE_TOAST",
      toastId: toastId,
    })
  }, duration)

  toastTimeouts.set(toastId, timeout)
}

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "ADD_TOAST":
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      }

    case "UPDATE_TOAST":
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      }

    case "DISMISS_TOAST": {
      const { toastId } = action

      if (toastId) {
        addToRemoveQueue(toastId, 0) // Remove immediately for dismiss
      } else {
        state.toasts.forEach((toast) => {
          addToRemoveQueue(toast.id, 0)
        })
      }

      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== toastId && toastId !== undefined),
      }
    }
    case "REMOVE_TOAST":
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        }
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      }
  }
}

const listeners: Array<(state: State) => void> = []

let memoryState: State = { toasts: [] }

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action)
  listeners.forEach((listener) => {
    listener(memoryState)
  })
}

function toast(props: Omit<Toast, "id">) {
  const id = genId()

  const update = (props: Toast) =>
    dispatch({
      type: "UPDATE_TOAST",
      toast: { ...props, id },
    })
  const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id })

  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
    },
  })

  // Auto remove
  addToRemoveQueue(id, props.duration || TOAST_REMOVE_DELAY)

  return {
    id: id,
    dismiss,
    update,
  }
}

function useToast() {
  const [state, setState] = React.useState<State>(memoryState)

  React.useEffect(() => {
    listeners.push(setState)
    return () => {
      const index = listeners.indexOf(setState)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }, [state])

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: "DISMISS_TOAST", toastId }),
  }
}

// Git error toast helper - shows a destructive toast with copy button
interface GitErrorToastOptions {
  title?: string;
  operation?: string;
  onFix?: () => void | Promise<void>;
  fixLabel?: string;
}

function showGitErrorToast(error: Error | string, options: GitErrorToastOptions = {}) {
  const errorMessage = typeof error === 'string' ? error : error.message;
  const title = options.title || (options.operation ? `${options.operation} Failed` : 'Git Operation Failed');
  
  const id = genId();
  
  // Create a stateful component for the copy button
  const CopyableErrorDescription = () => {
    const [copied, setCopied] = React.useState(false);
    const [fixing, setFixing] = React.useState(false);
    
    const handleCopy = async (e: React.MouseEvent) => {
      e.stopPropagation();
      const success = await copyToClipboard(errorMessage);
      if (success) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    };

    const handleFix = async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!options.onFix) return;

      setFixing(true);
      try {
        await options.onFix();
        dispatch({ type: "DISMISS_TOAST", toastId: id });
      } catch (err) {
        console.error("Fix failed", err);
        setFixing(false);
      }
    };
    
    // Container
    return React.createElement('div', { 
      className: 'mt-2 space-y-3' 
    },
      // Error message box
      React.createElement('div', { 
        className: 'max-h-[120px] overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed bg-black/20 p-3 rounded-md break-all text-error-content/90 border border-error-content/20'
      }, errorMessage),
      // Buttons container
      React.createElement('div', { className: 'flex gap-2' },
        // Copy button
        React.createElement('button', {
          onClick: handleCopy,
          type: 'button',
          className: `btn btn-xs ${copied ? 'btn-success text-white' : 'bg-white/20 hover:bg-white/30 text-white border-white/20'}`,
        },
          copied ? 'Copied!' : 'Copy Error'
        ),
        // Fix button
        options.onFix ? React.createElement('button', {
          onClick: handleFix,
          type: 'button',
          disabled: fixing,
          className: 'btn btn-xs btn-warning text-white',
        }, fixing ? 'Fixing...' : (options.fixLabel || 'Fix Issue')) : null
      )
    );
  };
  
  toast({
    type: "error",
    title,
    description: React.createElement(CopyableErrorDescription),
    duration: 10000 // Long duration for errors
  });
  
  return {
    id,
    dismiss: () => dispatch({ type: "DISMISS_TOAST", toastId: id }),
  };
}

export { useToast, toast, showGitErrorToast }
