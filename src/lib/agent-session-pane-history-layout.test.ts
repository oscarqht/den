import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../components/AgentSessionPane.tsx', import.meta.url), 'utf8');

test('agent session history keeps rows in normal flow', () => {
  assert.match(source, /Keep the timeline in normal document flow/);
  assert.match(source, /displayHistory\.map\(\(item\) => \(/);
  assert.doesNotMatch(source, /className="absolute left-0 right-0"/);
  assert.doesNotMatch(source, /historyMetrics\.totalHeight|visibleHistoryItems|shouldVirtualizeHistory/);
});

test('agent session history renders startup instructions behind a collapsed details toggle', () => {
  assert.match(source, /parseAgentStartupHistoryEntry\(item\.text\)/);
  assert.match(source, /<details/);
  assert.match(source, />\s*System instructions\s*</);
});
