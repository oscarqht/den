import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveSessionStatus, formatSessionStatus } from './session-status.ts';

test('maps agent run states to session statuses', () => {
  assert.equal(deriveSessionStatus('queued'), 'in_progress');
  assert.equal(deriveSessionStatus('running'), 'in_progress');
  assert.equal(deriveSessionStatus('completed'), 'done');
  assert.equal(deriveSessionStatus('error'), 'need_attention');
  assert.equal(deriveSessionStatus('needs_auth'), 'need_attention');
  assert.equal(deriveSessionStatus('cancelled'), 'cancelled');
  assert.equal(deriveSessionStatus('idle'), 'idle');
  assert.equal(deriveSessionStatus(null), 'idle');
  assert.equal(deriveSessionStatus(undefined), 'idle');
});

test('treats unknown non-empty run states as in progress', () => {
  assert.equal(deriveSessionStatus('starting' as never), 'in_progress');
});

test('formats session statuses for display', () => {
  assert.equal(formatSessionStatus('in_progress'), 'In Progress');
  assert.equal(formatSessionStatus('done'), 'Done');
  assert.equal(formatSessionStatus('need_attention'), 'Need Attention');
  assert.equal(formatSessionStatus('cancelled'), 'Cancelled');
  assert.equal(formatSessionStatus('idle'), 'Idle');
});
