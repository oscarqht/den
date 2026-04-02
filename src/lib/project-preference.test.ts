import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickPreferredProject } from './project-preference.ts';

describe('pickPreferredProject', () => {
  it('prefers the most recently opened project among duplicates', () => {
    const preferred = pickPreferredProject([
      {
        id: 'project-older',
        lastOpenedAt: '2026-03-27T05:10:16.473Z',
        iconPath: null,
      },
      {
        id: 'project-newer',
        lastOpenedAt: '2026-03-27T09:57:17.978Z',
        iconPath: null,
      },
    ]);

    assert.equal(preferred?.id, 'project-newer');
  });

  it('prefers a project with an icon when recency ties', () => {
    const preferred = pickPreferredProject([
      {
        id: 'project-without-icon',
        lastOpenedAt: '2026-03-27T09:57:17.978Z',
        iconPath: null,
      },
      {
        id: 'project-with-icon',
        lastOpenedAt: '2026-03-27T09:57:17.978Z',
        iconPath: '/tmp/icon.png',
      },
    ]);

    assert.equal(preferred?.id, 'project-with-icon');
  });

  it('treats an emoji icon as a project icon when recency ties', () => {
    const preferred = pickPreferredProject([
      {
        id: 'project-without-icon',
        lastOpenedAt: '2026-03-27T09:57:17.978Z',
        iconPath: null,
        iconEmoji: null,
      },
      {
        id: 'project-with-emoji',
        lastOpenedAt: '2026-03-27T09:57:17.978Z',
        iconPath: null,
        iconEmoji: '🧪',
      },
    ]);

    assert.equal(preferred?.id, 'project-with-emoji');
  });
});
