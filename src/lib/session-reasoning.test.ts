import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getModelReasoningEffortOptions, resolveReasoningEffortSelection } from './session-reasoning.ts';

describe('session reasoning helpers', () => {
  it('uses the active model reasoning efforts when available', () => {
    assert.deepStrictEqual(
      getModelReasoningEffortOptions(
        [
          { id: 'gpt-5', label: 'GPT-5', reasoningEfforts: ['low', 'medium', 'high'] },
          { id: 'o3', label: 'o3', reasoningEfforts: ['low', 'medium'] },
        ],
        'o3',
        'gpt-5',
      ),
      ['low', 'medium'],
    );
  });

  it('falls back to the default model when the active model is blank', () => {
    assert.deepStrictEqual(
      getModelReasoningEffortOptions(
        [
          { id: 'gpt-5', label: 'GPT-5', reasoningEfforts: ['low', 'medium', 'high'] },
        ],
        '',
        'gpt-5',
      ),
      ['low', 'medium', 'high'],
    );
  });

  it('does not fall back when the active model is an unknown custom id', () => {
    assert.deepStrictEqual(
      getModelReasoningEffortOptions(
        [
          { id: 'gpt-5', label: 'GPT-5', reasoningEfforts: ['low', 'medium', 'high'] },
        ],
        'custom-gpt',
        'gpt-5',
      ),
      [],
    );
  });

  it('prefers the current selection when it is still valid', () => {
    assert.equal(
      resolveReasoningEffortSelection(['low', 'medium', 'high'], 'medium', 'high'),
      'high',
    );
  });

  it('preserves the current selection while options are unavailable', () => {
    assert.equal(
      resolveReasoningEffortSelection([], 'medium', 'high'),
      'high',
    );
  });

  it('falls back to the persisted session reasoning effort when needed', () => {
    assert.equal(
      resolveReasoningEffortSelection(['low', 'medium', 'high'], 'medium', ''),
      'medium',
    );
  });

  it('falls back to the first available option when no saved value matches', () => {
    assert.equal(
      resolveReasoningEffortSelection(['low', 'medium', 'high'], 'xhigh', ''),
      'low',
    );
  });
});
