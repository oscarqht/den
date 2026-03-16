import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  normalizeNullableProviderReasoningEffort,
  normalizeProviderReasoningEffort,
} from './reasoning.ts';

describe('normalizeProviderReasoningEffort', () => {
  it('preserves xhigh for Codex', () => {
    assert.strictEqual(normalizeProviderReasoningEffort('codex', 'xhigh'), 'xhigh');
    assert.strictEqual(normalizeNullableProviderReasoningEffort('codex', 'xhigh'), 'xhigh');
  });

  it('upgrades minimal to low for Codex web search compatibility', () => {
    assert.strictEqual(normalizeProviderReasoningEffort('codex', 'minimal'), 'low');
    assert.strictEqual(normalizeNullableProviderReasoningEffort('codex', 'minimal'), 'low');
  });
});
