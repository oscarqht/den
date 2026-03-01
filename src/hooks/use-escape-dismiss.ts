import { useEffect, useRef } from 'react';

type KeyHandler = {
  id: number;
  onEscape: () => void;
  onEnter?: () => void;
};

const keyHandlers: KeyHandler[] = [];
let nextKeyHandlerId = 0;
let hasGlobalKeyListener = false;

function getTopHandler() {
  const topHandler = keyHandlers[keyHandlers.length - 1];
  if (!topHandler) {
    return null;
  }
  return topHandler;
}

function shouldIgnoreEnter(event: KeyboardEvent) {
  if (event.defaultPrevented || event.repeat || event.isComposing) {
    return true;
  }
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return true;
  }
  const target = event.target as HTMLElement | null;
  if (!target) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = target.tagName;
  if (tagName === 'TEXTAREA' || tagName === 'BUTTON' || tagName === 'SELECT' || tagName === 'OPTION' || tagName === 'A') {
    return true;
  }
  return false;
}

function handleGlobalKey(event: KeyboardEvent) {
  const topHandler = getTopHandler();
  if (!topHandler) {
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    topHandler.onEscape();
    return;
  }

  if (event.key === 'Enter' && topHandler.onEnter && !shouldIgnoreEnter(event)) {
    event.preventDefault();
    topHandler.onEnter();
  }
}


function attachGlobalListener() {
  if (hasGlobalKeyListener || typeof document === 'undefined') {
    return;
  }

  document.addEventListener('keydown', handleGlobalKey);
  hasGlobalKeyListener = true;
}

function detachGlobalListenerIfUnused() {
  if (!hasGlobalKeyListener || typeof document === 'undefined' || keyHandlers.length > 0) {
    return;
  }

  document.removeEventListener('keydown', handleGlobalKey);
  hasGlobalKeyListener = false;
}

export function useEscapeDismiss(enabled: boolean, onEscape: () => void, onEnter?: () => void) {
  const onEscapeRef = useRef(onEscape);
  const onEnterRef = useRef(onEnter);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    onEnterRef.current = onEnter;
  }, [onEnter]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const id = ++nextKeyHandlerId;
    keyHandlers.push({
      id,
      onEscape: () => onEscapeRef.current(),
      onEnter: () => onEnterRef.current?.(),
    });

    attachGlobalListener();

    return () => {
      const index = keyHandlers.findIndex((handler) => handler.id === id);
      if (index >= 0) {
        keyHandlers.splice(index, 1);
      }
      detachGlobalListenerIfUnused();
    };
  }, [enabled]);
}
