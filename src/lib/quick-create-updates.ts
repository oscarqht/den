import type { QuickCreateJobUpdatePayload } from '@/lib/quick-create';

const QUICK_CREATE_SOCKET_ENDPOINT = '/api/notifications/quick-create/socket';
const QUICK_CREATE_TAB_ID_KEY = '__palxQuickCreateTabId';

const listeners = new Set<(payload: QuickCreateJobUpdatePayload) => void>();
let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let reconnectAttempt = 0;
let isConnecting = false;

function clearReconnectTimer(): void {
  if (reconnectTimer === null) return;
  window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function dispatchListeners(payload: QuickCreateJobUpdatePayload): void {
  for (const listener of listeners) {
    listener(payload);
  }
}

function scheduleReconnect(): void {
  if (typeof window === 'undefined') return;
  if (listeners.size === 0 || reconnectTimer !== null) return;

  const delay = Math.min(10000, 500 * (2 ** reconnectAttempt));
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    void ensureQuickCreateSocketConnected();
  }, delay);
}

async function ensureQuickCreateSocketConnected(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (listeners.size === 0) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (isConnecting) return;

  isConnecting = true;
  try {
    const response = await fetch(QUICK_CREATE_SOCKET_ENDPOINT, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Failed to initialize quick create socket');
    }

    const data = await response.json() as { wsUrl?: string };
    const wsUrl = data.wsUrl?.trim();
    if (!wsUrl) {
      throw new Error('Quick create websocket URL is missing');
    }

    const nextSocket = new WebSocket(wsUrl);
    socket = nextSocket;
    nextSocket.onopen = () => {
      reconnectAttempt = 0;
      clearReconnectTimer();
    };
    nextSocket.onerror = () => {
      nextSocket.close();
    };
    nextSocket.onclose = () => {
      if (socket === nextSocket) {
        socket = null;
      }
      scheduleReconnect();
    };
    nextSocket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data as string) as QuickCreateJobUpdatePayload;
        if (payload.type !== 'quick-create-job-update') return;
        dispatchListeners(payload);
      } catch {
        // Ignore malformed update payloads.
      }
    };
  } catch {
    scheduleReconnect();
  } finally {
    isConnecting = false;
  }
}

function maybeCloseQuickCreateSocket(): void {
  if (listeners.size > 0) return;
  clearReconnectTimer();
  reconnectAttempt = 0;
  isConnecting = false;
  socket?.close();
  socket = null;
}

export function getQuickCreateTabId(): string {
  if (typeof window === 'undefined') return 'server';
  const runtimeWindow = window as Window & {
    [QUICK_CREATE_TAB_ID_KEY]?: string;
  };
  const existing = runtimeWindow[QUICK_CREATE_TAB_ID_KEY];
  if (existing) return existing;

  const generated = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  runtimeWindow[QUICK_CREATE_TAB_ID_KEY] = generated;
  return generated;
}

export function subscribeToQuickCreateJobUpdates(
  listener: (payload: QuickCreateJobUpdatePayload) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => { };
  }

  listeners.add(listener);
  void ensureQuickCreateSocketConnected();

  return () => {
    listeners.delete(listener);
    maybeCloseQuickCreateSocket();
  };
}
