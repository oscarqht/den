import { after, describe, it } from 'node:test';
import assert from 'node:assert';

import {
  getBrowserOpenAttempts,
  getFileManagerLaunchAttempts,
  getTerminalLaunchAttempts,
} from './fs-launch.ts';

describe('fs launch command selection', () => {
  const originalPlatform = process.platform;

  after(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('returns Windows file manager attempts', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    assert.deepStrictEqual(getFileManagerLaunchAttempts('C:\\repo'), [
      { command: 'explorer.exe', args: ['C:\\repo'] },
    ]);
  });

  it('returns Windows terminal attempts', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    const attempts = getTerminalLaunchAttempts('C:\\repo');
    assert.deepStrictEqual(attempts[0], { command: 'wt.exe', args: ['-d', 'C:\\repo'] });
    assert.strictEqual(attempts[1]?.command, 'pwsh.exe');
    assert.strictEqual(attempts[2]?.command, 'powershell.exe');
    assert.strictEqual(attempts[3]?.command, 'cmd.exe');
  });

  it('returns macOS browser open attempts', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    assert.deepStrictEqual(getBrowserOpenAttempts('http://localhost:3200/session/abc'), [
      { command: 'open', args: ['http://localhost:3200/session/abc'] },
    ]);
  });

  it('returns Linux browser open attempts', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    assert.deepStrictEqual(getBrowserOpenAttempts('http://localhost:3200/session/abc'), [
      { command: 'xdg-open', args: ['http://localhost:3200/session/abc'] },
    ]);
  });
});
