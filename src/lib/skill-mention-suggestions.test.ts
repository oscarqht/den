import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  buildSkillMentionSuggestions,
  SKILL_MENTION_SUGGESTION_LIMIT,
} from './skill-mention-suggestions.ts';

describe('buildSkillMentionSuggestions', () => {
  it('filters installed skills by a case-insensitive substring match', () => {
    const suggestions = buildSkillMentionSuggestions('Doc', [
      'playwright',
      'openai-docs',
      'agent-browser',
    ]);

    assert.deepStrictEqual(suggestions, ['openai-docs']);
  });

  it('caps the suggestion list to the configured limit', () => {
    const suggestions = buildSkillMentionSuggestions(
      '',
      Array.from({ length: SKILL_MENTION_SUGGESTION_LIMIT + 5 }, (_, index) => `skill-${index}`),
    );

    assert.equal(suggestions.length, SKILL_MENTION_SUGGESTION_LIMIT);
  });
});
