import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  buildProjectMentionSuggestions,
  PROJECT_MENTION_SUGGESTION_LIMIT,
} from './project-mention-suggestions.ts';

describe('buildProjectMentionSuggestions', () => {
  it('matches against aliases while inserting the primary suggestion', () => {
    const suggestions = buildProjectMentionSuggestions({
      query: 'ak',
      candidates: [
        { suggestion: 'AI Platform', aliases: ['ai', 'aiplatform'] },
        { suggestion: 'Account Kit', aliases: ['ak'] },
      ],
    });

    assert.deepStrictEqual(suggestions, ['Account Kit']);
  });

  it('caps the result set to the configured limit', () => {
    const suggestions = buildProjectMentionSuggestions({
      query: '',
      candidates: Array.from(
        { length: PROJECT_MENTION_SUGGESTION_LIMIT + 5 },
        (_, index) => ({ suggestion: `project-${index}` }),
      ),
    });

    assert.equal(suggestions.length, PROJECT_MENTION_SUGGESTION_LIMIT);
  });
});
