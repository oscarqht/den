import assert from 'node:assert/strict';
import test from 'node:test';

import { AGENT_SESSION_CODE_BLOCK_CLASSNAME } from './agent-session-pane-styles.ts';

test('agent session code blocks keep readable light and dark theme colors', () => {
  assert.match(AGENT_SESSION_CODE_BLOCK_CLASSNAME, /\bbg-slate-100\b/);
  assert.match(AGENT_SESSION_CODE_BLOCK_CLASSNAME, /\btext-slate-800\b/);
  assert.match(AGENT_SESSION_CODE_BLOCK_CLASSNAME, /\bdark:text-slate-100\b/);
  assert.match(AGENT_SESSION_CODE_BLOCK_CLASSNAME, /\bapp-dark-code\b/);
});
