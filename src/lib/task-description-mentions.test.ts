import assert from 'node:assert';
import { describe, it } from 'node:test';

import { findActiveMention, replaceActiveMention } from './task-description-mentions.ts';

describe('findActiveMention', () => {
  it('detects an active @ mention at the cursor', () => {
    const text = 'Open @src/components';
    const mention = findActiveMention(text, text.length);

    assert.deepStrictEqual(mention, {
      trigger: '@',
      start: 5,
      end: text.length,
      query: 'src/components',
    });
  });

  it('detects an active $ mention at the cursor', () => {
    const text = 'Use $openai-docs';
    const mention = findActiveMention(text, text.length);

    assert.deepStrictEqual(mention, {
      trigger: '$',
      start: 4,
      end: text.length,
      query: 'openai-docs',
    });
  });

  it('prefers the nearest valid trigger before the cursor', () => {
    const text = 'Inspect @src then use $play';
    const mention = findActiveMention(text, text.length);

    assert.deepStrictEqual(mention, {
      trigger: '$',
      start: 22,
      end: text.length,
      query: 'play',
    });
  });

  it('returns null when whitespace breaks the token before the cursor', () => {
    const text = 'Open @src/components now';

    assert.equal(findActiveMention(text, text.length), null);
    assert.equal(findActiveMention('Open @src/components\nnext line', 30), null);
  });
});

describe('replaceActiveMention', () => {
  it('replaces the full active token span with the selected suggestion', () => {
    const text = 'Use $pla for browser work';
    const mention = findActiveMention(text, 8);

    assert.ok(mention);

    const result = replaceActiveMention(text, mention, 'playwright');
    assert.equal(result.value, 'Use $playwright for browser work');
    assert.equal(result.cursorPosition, 'Use $playwright'.length);
  });
});
