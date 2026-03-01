import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createGitLogOptions } from './git-log-options.ts';

describe('createGitLogOptions', () => {
  it('uses CLI flags so options are not parsed as revisions', () => {
    const options = createGitLogOptions(100, true);
    const optionRecord = options as Record<string, unknown>;

    assert.strictEqual(options['--decorate'], 'short');
    assert.ok(Object.prototype.hasOwnProperty.call(optionRecord, '--all'));
    assert.ok(!Object.prototype.hasOwnProperty.call(optionRecord, 'decorate'));
    assert.ok(!Object.prototype.hasOwnProperty.call(optionRecord, 'all'));
    assert.strictEqual(options.maxCount, 100);
  });

  it('omits --all when only current branch history is requested', () => {
    const options = createGitLogOptions(25, false);
    const optionRecord = options as Record<string, unknown>;

    assert.ok(!Object.prototype.hasOwnProperty.call(optionRecord, '--all'));
    assert.strictEqual(options.maxCount, 25);
  });
});
