import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import {
  clearPendingSessionNavigation,
  consumePendingSessionNavigationRetry,
  recordPendingSessionNavigation,
} from './session-navigation.ts';

type MockStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

const ORIGINAL_WINDOW = (globalThis as { window?: unknown }).window;

function createMockStorage(): MockStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
  };
}

function installMockWindow(storage: MockStorage): void {
  (globalThis as { window?: unknown }).window = {
    sessionStorage: storage,
  };
}

describe('session-navigation', () => {
  beforeEach(() => {
    const storage = createMockStorage();
    installMockWindow(storage);
    clearPendingSessionNavigation();
  });

  it('records and consumes a pending session navigation once', () => {
    recordPendingSessionNavigation('session-1');

    assert.deepStrictEqual(consumePendingSessionNavigationRetry(), { sessionName: 'session-1' });
    assert.strictEqual(consumePendingSessionNavigationRetry(), null);
  });

  it('clears a pending navigation when session is opened', () => {
    recordPendingSessionNavigation('session-2');
    clearPendingSessionNavigation('session-2');

    assert.strictEqual(consumePendingSessionNavigationRetry(), null);
  });

  it('does not clear another session pending navigation', () => {
    recordPendingSessionNavigation('session-3');
    clearPendingSessionNavigation('session-other');

    assert.deepStrictEqual(consumePendingSessionNavigationRetry(), { sessionName: 'session-3' });
  });
});

after(() => {
  if (ORIGINAL_WINDOW === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = ORIGINAL_WINDOW;
  }
});
