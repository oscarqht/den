import assert from 'node:assert';
import { describe, it, mock } from 'node:test';

import { deliverSessionNotificationToSubscribers } from './session-notification-delivery.ts';

describe('deliverSessionNotificationToSubscribers', () => {
  it('returns zero when there are no subscribers', async () => {
    const delivered = await deliverSessionNotificationToSubscribers({
      sockets: undefined,
      openStateValue: 1,
      payload: '{"ok":true}',
    });

    assert.strictEqual(delivered, 0);
  });

  it('sends to open subscribers', async () => {
    const send = mock.fn(() => undefined);

    const delivered = await deliverSessionNotificationToSubscribers({
      sockets: new Set([{ readyState: 1, send }]),
      openStateValue: 1,
      payload: '{"ok":true}',
    });

    assert.strictEqual(delivered, 1);
    assert.strictEqual(send.mock.callCount(), 1);
  });

  it('drops stale sockets and returns zero when nothing can be delivered', async () => {
    const staleSocket = {
      readyState: 0,
      send: mock.fn(() => undefined),
    };
    const sockets = new Set([staleSocket]);
    const onSocketStale = mock.fn(() => undefined);

    const delivered = await deliverSessionNotificationToSubscribers({
      sockets,
      openStateValue: 1,
      payload: '{"ok":true}',
      onSocketStale,
    });

    assert.strictEqual(delivered, 0);
    assert.strictEqual(sockets.size, 0);
    assert.strictEqual(onSocketStale.mock.callCount(), 1);
  });
});
