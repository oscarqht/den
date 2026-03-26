type PendingSessionNavigation = {
  sessionName: string;
  createdAt: number;
  retryCount: number;
};

const PENDING_SESSION_NAVIGATION_STORAGE_KEY = 'palx:pending-session-navigation';
const PENDING_SESSION_NAVIGATION_MAX_AGE_MS = 30_000;
const PENDING_SESSION_NAVIGATION_MAX_RETRIES = 1;

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null;

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readPendingSessionNavigation(): PendingSessionNavigation | null {
  const storage = getSessionStorage();
  if (!storage) return null;

  const raw = storage.getItem(PENDING_SESSION_NAVIGATION_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PendingSessionNavigation;
    if (
      typeof parsed.sessionName !== 'string' ||
      !parsed.sessionName.trim() ||
      typeof parsed.createdAt !== 'number' ||
      !Number.isFinite(parsed.createdAt) ||
      typeof parsed.retryCount !== 'number' ||
      !Number.isFinite(parsed.retryCount)
    ) {
      storage.removeItem(PENDING_SESSION_NAVIGATION_STORAGE_KEY);
      return null;
    }
    return {
      sessionName: parsed.sessionName.trim(),
      createdAt: parsed.createdAt,
      retryCount: parsed.retryCount,
    };
  } catch {
    storage.removeItem(PENDING_SESSION_NAVIGATION_STORAGE_KEY);
    return null;
  }
}

function writePendingSessionNavigation(pending: PendingSessionNavigation): void {
  const storage = getSessionStorage();
  if (!storage) return;

  storage.setItem(PENDING_SESSION_NAVIGATION_STORAGE_KEY, JSON.stringify(pending));
}

export function recordPendingSessionNavigation(sessionName: string): void {
  const normalizedSessionName = sessionName.trim();
  if (!normalizedSessionName) return;

  writePendingSessionNavigation({
    sessionName: normalizedSessionName,
    createdAt: Date.now(),
    retryCount: 0,
  });
}

export function consumePendingSessionNavigationRetry(): { sessionName: string } | null {
  const storage = getSessionStorage();
  if (!storage) return null;

  const pending = readPendingSessionNavigation();
  if (!pending) return null;

  if (Date.now() - pending.createdAt > PENDING_SESSION_NAVIGATION_MAX_AGE_MS) {
    storage.removeItem(PENDING_SESSION_NAVIGATION_STORAGE_KEY);
    return null;
  }

  if (pending.retryCount >= PENDING_SESSION_NAVIGATION_MAX_RETRIES) {
    storage.removeItem(PENDING_SESSION_NAVIGATION_STORAGE_KEY);
    return null;
  }

  writePendingSessionNavigation({
    ...pending,
    retryCount: pending.retryCount + 1,
  });
  return {
    sessionName: pending.sessionName,
  };
}

export function clearPendingSessionNavigation(sessionName?: string): void {
  const storage = getSessionStorage();
  if (!storage) return;

  if (!sessionName) {
    storage.removeItem(PENDING_SESSION_NAVIGATION_STORAGE_KEY);
    return;
  }

  const pending = readPendingSessionNavigation();
  if (!pending) return;

  if (pending.sessionName === sessionName.trim()) {
    storage.removeItem(PENDING_SESSION_NAVIGATION_STORAGE_KEY);
  }
}
