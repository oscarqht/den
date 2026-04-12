import assert from 'node:assert/strict';
import test from 'node:test';

import { selectSessionHistoryCommits } from './session-git-history.ts';
import type { Commit } from './types.ts';

function createCommit(hash: string, message: string): Commit {
  return {
    hash,
    date: '2026-04-12T00:00:00.000Z',
    message,
    refs: '',
    body: '',
    author_name: 'Test',
    author_email: 'test@example.com',
    parents: [],
  };
}

test('keeps the full bounded history when the stored base commit is present', () => {
  const commits = [
    createCommit('dddd444', 'head'),
    createCommit('cccc333', 'mid'),
    createCommit('bbbb222', 'base'),
  ];

  assert.deepEqual(
    selectSessionHistoryCommits(commits, { baseCommitId: 'bbbb222', mergeBaseHash: 'aaaa111' }),
    commits,
  );
});

test('falls back to the merge-base boundary when no stored base commit is available', () => {
  const commits = [
    createCommit('dddd444', 'head'),
    createCommit('cccc333', 'mid'),
    createCommit('bbbb222', 'merge base'),
    createCommit('aaaa111', 'older'),
  ];

  assert.deepEqual(
    selectSessionHistoryCommits(commits, { mergeBaseHash: 'bbbb222' }).map((commit) => commit.hash),
    ['dddd444', 'cccc333', 'bbbb222'],
  );
});

test('returns the current branch history unchanged when no boundary commit can be resolved', () => {
  const commits = [
    createCommit('dddd444', 'head'),
    createCommit('cccc333', 'mid'),
  ];

  assert.deepEqual(
    selectSessionHistoryCommits(commits, { baseCommitId: 'missing', mergeBaseHash: 'also-missing' }),
    commits,
  );
});
