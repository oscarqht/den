import assert from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { getBackgroundNotificationAttempts } from './background-notifications.ts';

describe('background notifications', () => {
  const originalPlatform = process.platform;
  const originalAppUrl = process.env.PALX_APP_URL;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    if (originalAppUrl === undefined) {
      delete process.env.PALX_APP_URL;
    } else {
      process.env.PALX_APP_URL = originalAppUrl;
    }
  });

  it('includes a clickable terminal-notifier attempt on macOS when app url is available', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    process.env.PALX_APP_URL = 'http://localhost:3210';

    const attempts = getBackgroundNotificationAttempts({
      sessionId: 'session-123',
      title: 'Agent needs attention',
      description: 'Authentication required.',
    });

    assert.deepStrictEqual(attempts[0], {
      command: 'terminal-notifier',
      args: [
        '-title',
        'Agent needs attention',
        '-message',
        'Authentication required.',
        '-group',
        'palx-session-session-123',
        '-open',
        'http://localhost:3210/session/session-123',
      ],
    });
  });

  it('falls back to osascript on macOS', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    delete process.env.PALX_APP_URL;

    const attempts = getBackgroundNotificationAttempts({
      sessionId: 'session-123',
      title: 'Codex finished',
      description: 'Implemented the fix.',
    });

    assert.deepStrictEqual(attempts[0], {
      command: 'osascript',
      args: [
        '-e',
        'display notification "Implemented the fix." with title "Codex finished"',
      ],
    });
  });

  it('builds notify-send attempts on Linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    const attempts = getBackgroundNotificationAttempts({
      sessionId: 'session-123',
      title: 'Codex finished',
      description: 'Implemented the fix.',
    });

    assert.deepStrictEqual(attempts, [
      {
        command: 'notify-send',
        args: ['Codex finished', 'Implemented the fix.'],
      },
    ]);
  });
});
