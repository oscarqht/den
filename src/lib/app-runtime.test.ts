import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import test from 'node:test';

import { isPalxRestartInProgress, readPalxRestartLogTail } from './app-runtime.ts';

test('recognizes in-progress restart states', () => {
  assert.equal(isPalxRestartInProgress('queued'), true);
  assert.equal(isPalxRestartInProgress('repairing'), true);
  assert.equal(isPalxRestartInProgress('ready'), false);
  assert.equal(isPalxRestartInProgress('failed'), false);
});

test('reads only the tail of the restart log', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'palx-runtime-log-'));
  const logPath = path.join(tempDir, 'restart.log');
  await fs.writeFile(logPath, 'line-one\nline-two\nline-three\n', 'utf-8');

  const tail = await readPalxRestartLogTail(logPath, 12);

  assert.equal(tail.includes('line-one'), false);
  assert.equal(tail.includes('line-three'), true);
  await fs.rm(tempDir, { recursive: true, force: true });
});
