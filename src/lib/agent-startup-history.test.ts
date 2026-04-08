import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAgentStartupHistoryEntry } from './agent-startup-history.ts';

test('parses a startup history entry into instructions and task sections', () => {
  const parsed = parseAgentStartupHistoryEntry([
    '# Instructions',
    '',
    '- First instruction',
    '- Second instruction',
    '',
    '# Task',
    '',
    'Fix the bug in the first message.',
    '',
    'Attachments:',
    '- /tmp/screenshot.png',
  ].join('\n'));

  assert.deepStrictEqual(parsed, {
    instructions: '- First instruction\n- Second instruction',
    task: 'Fix the bug in the first message.\n\nAttachments:\n- /tmp/screenshot.png',
  });
});

test('returns null for plain user messages', () => {
  assert.equal(parseAgentStartupHistoryEntry('Just a normal follow-up'), null);
});

test('returns null when either startup section is missing', () => {
  assert.equal(parseAgentStartupHistoryEntry('# Instructions\n\n- Only instructions'), null);
  assert.equal(parseAgentStartupHistoryEntry('# Task\n\nOnly task'), null);
});
