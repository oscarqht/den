import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

import { subscribeToQuickCreateJobUpdates } from './quick-create-updates.ts';
import { subscribeToSessionsUpdated } from './session-updates.ts';

type MockWindow = {
  clearTimeout: typeof clearTimeout;
  setTimeout: typeof setTimeout;
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
};

type MockFetchResponse = {
  ok: boolean;
  json: () => Promise<{ wsUrl: string }>;
};

type MockFetch = typeof fetch;

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  static reset(): void {
    MockWebSocket.instances = [];
  }

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  closeCount = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close(): void {
    this.closeCount += 1;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

const ORIGINAL_WINDOW = (globalThis as { window?: MockWindow }).window;
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_WEBSOCKET = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;

function installMockWindow(): void {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  (globalThis as { window?: MockWindow }).window = {
    setTimeout,
    clearTimeout,
    addEventListener: (type, listener) => {
      const nextListeners = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
      nextListeners.add(listener);
      listeners.set(type, nextListeners);
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener);
    },
  };
}

async function waitForTimers(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('socket bootstrap deduplication', () => {
  beforeEach(() => {
    installMockWindow();
    MockWebSocket.reset();
    (globalThis as { WebSocket?: typeof WebSocket }).WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  it('reuses the in-flight quick create bootstrap across an immediate resubscribe', async () => {
    let fetchCalls = 0;
    let resolveFetch: ((value: MockFetchResponse) => void) | null = null;

    globalThis.fetch = ((async () => {
      fetchCalls += 1;
      return await new Promise<MockFetchResponse>((resolve) => {
        resolveFetch = resolve;
      });
    }) as MockFetch);

    const unsubscribeFirst = subscribeToQuickCreateJobUpdates(() => {});
    unsubscribeFirst();
    const unsubscribeSecond = subscribeToQuickCreateJobUpdates(() => {});

    assert.equal(fetchCalls, 1);

    assert.ok(resolveFetch);
    resolveFetch?.({
      ok: true,
      json: async () => ({ wsUrl: 'ws://localhost:9999/quick-create' }),
    });
    await flushAsyncWork();

    assert.equal(MockWebSocket.instances.length, 1);
    assert.equal(MockWebSocket.instances[0]?.url, 'ws://localhost:9999/quick-create');

    unsubscribeSecond();
    await waitForTimers();
    assert.equal(MockWebSocket.instances[0]?.closeCount, 1);
  });

  it('reuses the in-flight session list bootstrap across an immediate resubscribe', async () => {
    let fetchCalls = 0;
    let resolveFetch: ((value: MockFetchResponse) => void) | null = null;

    globalThis.fetch = ((async () => {
      fetchCalls += 1;
      return await new Promise<MockFetchResponse>((resolve) => {
        resolveFetch = resolve;
      });
    }) as MockFetch);

    const unsubscribeFirst = subscribeToSessionsUpdated(() => {});
    unsubscribeFirst();
    const unsubscribeSecond = subscribeToSessionsUpdated(() => {});

    assert.equal(fetchCalls, 1);

    assert.ok(resolveFetch);
    resolveFetch?.({
      ok: true,
      json: async () => ({ wsUrl: 'ws://localhost:9999/session-list' }),
    });
    await flushAsyncWork();

    assert.equal(MockWebSocket.instances.length, 1);
    assert.equal(MockWebSocket.instances[0]?.url, 'ws://localhost:9999/session-list');

    unsubscribeSecond();
    await waitForTimers();
    assert.equal(MockWebSocket.instances[0]?.closeCount, 1);
  });
});

after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_WINDOW === undefined) {
    delete (globalThis as { window?: MockWindow }).window;
  } else {
    (globalThis as { window?: MockWindow }).window = ORIGINAL_WINDOW;
  }
  if (ORIGINAL_WEBSOCKET === undefined) {
    delete (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  } else {
    (globalThis as { WebSocket?: typeof WebSocket }).WebSocket = ORIGINAL_WEBSOCKET;
  }
});
