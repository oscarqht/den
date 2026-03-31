import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  formatGitTimestamp,
  normalizeGitTimestamp,
  parseGitTimestamp,
} from './git-date.ts';

describe('git-date', () => {
  it('normalizes legacy git timestamps into ISO-8601 form', () => {
    assert.strictEqual(
      normalizeGitTimestamp('2026-03-30 18:12:34 +0800'),
      '2026-03-30T18:12:34+08:00',
    );
  });

  it('preserves strict ISO timestamps', () => {
    assert.strictEqual(
      normalizeGitTimestamp('2026-03-30T18:12:34+08:00'),
      '2026-03-30T18:12:34+08:00',
    );
  });

  it('parses legacy git timestamps using the normalized value', () => {
    const parsed = parseGitTimestamp('2026-03-30 18:12:34 +0800');
    assert.ok(parsed instanceof Date);
    assert.strictEqual(
      parsed?.toISOString(),
      new Date('2026-03-30T18:12:34+08:00').toISOString(),
    );
  });

  it('formats legacy timestamps without surfacing Invalid Date', () => {
    const options: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    };

    assert.strictEqual(
      formatGitTimestamp('2026-03-30 18:12:34 +0800', 'en-US', options),
      new Date('2026-03-30T18:12:34+08:00').toLocaleString('en-US', options),
    );
  });
});
