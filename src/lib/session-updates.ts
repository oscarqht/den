export const SESSIONS_UPDATED_EVENT = 'viba:sessions-updated';
const SESSIONS_UPDATED_CHANNEL = 'viba:sessions-updated';
const SESSIONS_UPDATED_TAB_ID_KEY = '__vibaSessionsUpdatedTabId';
const SESSION_LIST_SOCKET_ENDPOINT = '/api/notifications/session-list/socket';

type SessionListUpdatedPayload = {
  type: 'session-list-updated';
  timestamp?: string;
};

type SessionsUpdatedPayload = {
  sourceTabId?: string;
};

const listeners = new Set<() => void>();
let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let closeTimer: number | null = null;
let reconnectAttempt = 0;
let connectPromise: Promise<void> | null = null;
let connectionGeneration = 0;

function clearReconnectTimer(): void {
  if (reconnectTimer === null) return;
  window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function clearCloseTimer(): void {
  if (closeTimer === null) return;
  window.clearTimeout(closeTimer);
  closeTimer = null;
}

function dispatchListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

function scheduleReconnect(): void {
  if (typeof window === 'undefined') return;
  if (listeners.size === 0) return;
  if (reconnectTimer !== null) return;

  const delay = Math.min(10000, 500 * (2 ** reconnectAttempt));
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    void ensureSessionListSocketConnected();
  }, delay);
}

async function ensureSessionListSocketConnected(): Promise<void> {
  if (typeof window === 'undefined') return;
  clearCloseTimer();
  if (listeners.size === 0) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (connectPromise) {
    await connectPromise;
    return;
  }

  const attemptGeneration = ++connectionGeneration;
  const nextPromise = (async () => {
    try {
      const response = await fetch(SESSION_LIST_SOCKET_ENDPOINT, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Failed to initialize session list socket');
      }
      const data = await response.json() as { wsUrl?: string };
      const wsUrl = data.wsUrl?.trim();
      if (!wsUrl) {
        throw new Error('Session list websocket URL is missing');
      }
      if (listeners.size === 0 || attemptGeneration !== connectionGeneration) {
        return;
      }

      const nextSocket = new WebSocket(wsUrl);
      socket = nextSocket;
      nextSocket.onopen = () => {
        if (socket !== nextSocket) return;
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
        if (attemptGeneration === connectionGeneration) {
          scheduleReconnect();
        }
      };
      nextSocket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as Partial<SessionListUpdatedPayload>;
          if (payload.type !== 'session-list-updated') return;
          dispatchListeners();
        } catch {
          // Ignore malformed update payloads.
        }
      };
    } catch {
      if (attemptGeneration === connectionGeneration) {
        scheduleReconnect();
      }
    }
  })();

  connectPromise = nextPromise;
  try {
    await nextPromise;
  } finally {
    if (connectPromise === nextPromise) {
      connectPromise = null;
    }
  }
}

function maybeCloseSessionListSocket(): void {
  if (listeners.size > 0) return;
  clearCloseTimer();
  clearReconnectTimer();
  closeTimer = window.setTimeout(() => {
    closeTimer = null;
    if (listeners.size > 0) return;
    reconnectAttempt = 0;
    connectionGeneration += 1;
    const activeSocket = socket;
    socket = null;
    activeSocket?.close();
  }, 0);
}

function getCurrentTabId(): string {
  if (typeof window === 'undefined') return 'server';
  const runtimeWindow = window as Window & {
    [SESSIONS_UPDATED_TAB_ID_KEY]?: string;
  };
  const existing = runtimeWindow[SESSIONS_UPDATED_TAB_ID_KEY];
  if (existing) return existing;

  const generated = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  runtimeWindow[SESSIONS_UPDATED_TAB_ID_KEY] = generated;
  return generated;
}

export function notifySessionsUpdated(): void {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent(SESSIONS_UPDATED_EVENT));

  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(SESSIONS_UPDATED_CHANNEL);
    channel.postMessage({ sourceTabId: getCurrentTabId() } satisfies SessionsUpdatedPayload);
    channel.close();
  } catch {
    // Ignore BroadcastChannel failures.
  }
}

export function subscribeToSessionsUpdated(listener: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => { };
  }

  listeners.add(listener);
  void ensureSessionListSocketConnected();

  const currentTabId = getCurrentTabId();
  const handleLocalEvent = () => {
    listener();
  };
  window.addEventListener(SESSIONS_UPDATED_EVENT, handleLocalEvent);

  let channel: BroadcastChannel | null = null;
  let channelListener: ((event: MessageEvent<SessionsUpdatedPayload>) => void) | null = null;

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(SESSIONS_UPDATED_CHANNEL);
      channelListener = (event: MessageEvent<SessionsUpdatedPayload>) => {
        if (event.data?.sourceTabId === currentTabId) return;
        listener();
      };
      channel.addEventListener('message', channelListener);
    } catch {
      channel = null;
      channelListener = null;
    }
  }

  return () => {
    listeners.delete(listener);
    window.removeEventListener(SESSIONS_UPDATED_EVENT, handleLocalEvent);
    if (channel && channelListener) {
      channel.removeEventListener('message', channelListener);
    }
    channel?.close();
    maybeCloseSessionListSocket();
  };
}
