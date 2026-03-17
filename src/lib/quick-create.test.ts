import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  deriveQuickCreateTitle,
  parseQuickCreateRoutingSelection,
} from './quick-create.ts';

describe('parseQuickCreateRoutingSelection', () => {
  it('parses a valid JSON payload', () => {
    const result = parseQuickCreateRoutingSelection(
      '{"projectPath":"/workspace/app","reasoningEffort":"high","reason":"Most relevant repo."}',
      new Set(['/workspace/app']),
    );

    assert.deepStrictEqual(result, {
      projectPath: '/workspace/app',
      reasoningEffort: 'high',
      reason: 'Most relevant repo.',
    });
  });

  it('rejects invalid JSON responses', () => {
    assert.throws(
      () => parseQuickCreateRoutingSelection('not json', new Set(['/workspace/app'])),
      /did not return json/i,
    );
  });

  it('rejects payloads without reasoning effort', () => {
    assert.throws(
      () => parseQuickCreateRoutingSelection(
        '{"projectPath":"/workspace/app","reason":"Most relevant repo."}',
        new Set(['/workspace/app']),
      ),
      /reasoning effort/i,
    );
  });
});

describe('deriveQuickCreateTitle', () => {
  it('uses the first non-empty line', () => {
    assert.equal(
      deriveQuickCreateTitle('\n\nFix checkout total on mobile\nInvestigate tax bug'),
      'Fix checkout total on mobile',
    );
  });
});
