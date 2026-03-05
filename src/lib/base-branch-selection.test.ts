import assert from 'node:assert';
import { describe, test } from 'node:test';
import { resolveInitialBaseBranchSelection } from './base-branch-selection.ts';

describe('resolveInitialBaseBranchSelection', () => {
  test('uses remembered branch when it still exists', () => {
    const selected = resolveInitialBaseBranchSelection(
      [
        { name: 'main', current: true },
        { name: 'feature/a', current: false },
      ],
      'feature/a',
      'main'
    );

    assert.strictEqual(selected, 'feature/a');
  });

  test('falls back to currently checked out branch when remembered one is missing', () => {
    const selected = resolveInitialBaseBranchSelection(
      [
        { name: 'main', current: true },
        { name: 'feature/a', current: false },
      ],
      'feature/missing',
      'main'
    );

    assert.strictEqual(selected, 'main');
  });

  test('discovers current branch from branch list when explicit current is not provided', () => {
    const selected = resolveInitialBaseBranchSelection(
      [
        { name: 'main', current: false },
        { name: 'release', current: true },
      ],
      null,
      ''
    );

    assert.strictEqual(selected, 'release');
  });

  test('returns empty string when there is no usable branch information', () => {
    const selected = resolveInitialBaseBranchSelection([], undefined, undefined);

    assert.strictEqual(selected, '');
  });
});
