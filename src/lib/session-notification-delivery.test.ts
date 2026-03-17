import assert from 'node:assert';
import { describe, it, mock } from 'node:test';

import { deliverSessionNotificationToSubscribers } from './session-notification-delivery.ts';

describe('deliverSessionNotificationToSubscribers', () => {
  it('calls the background fallback when there are no subscribers', async () => {
    const onUndelivered = mock.fn(async () => undefined);

    const delivered = await deliverSessionNotificationToSubscribers({
      sockets: undefined,
      openStateValue: 1,
      payload: '{"ok":true}',
      onUndelivered,
    });

    assert.strictEqual(delivered, 0);
    assert.strictEqual(onUndelivered.mock.callCount(), 1);
  });

  it('sends to open subscribers without triggering the fallback', async () => {
    const send = mock.fn(() => undefined);
    const onUndelivered = mock.fn(async () => undefined);

    const delivered = await deliverSessionNotificationToSubscribers({
      sockets: new Set([{ readyState: 1, send }]),
      openStateValue: 1,
      payload: '{"ok":true}',
      onUndelivered,
    });

    assert.strictEqual(delivered, 1);
    assert.strictEqual(send.mock.callCount(), 1);
    assert.strictEqual(onUndelivered.mock.callCount(), 0);
  });
});
