import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getHomeProjectGitRepoLabel,
  omitRecordKeys,
  toHomeProjectGitRepos,
} from './home-project-git.ts';

describe('home project git helpers', () => {
  it('prefers the discovered relative path as the repo label', () => {
    assert.equal(
      getHomeProjectGitRepoLabel('apps/web', '/tmp/project/apps/web'),
      'apps/web',
    );
  });

  it('falls back to the repo folder name when no relative path is available', () => {
    assert.equal(
      getHomeProjectGitRepoLabel('', '/tmp/project-root'),
      'project-root',
    );
  });

  it('maps discovered repos into home repo entries with stable labels', () => {
    assert.deepEqual(
      toHomeProjectGitRepos([
        { repoPath: '/tmp/project-root', relativePath: '' },
        { repoPath: '/tmp/workspace/apps/api', relativePath: 'apps/api' },
      ]),
      [
        { repoPath: '/tmp/project-root', label: 'project-root' },
        { repoPath: '/tmp/workspace/apps/api', label: 'apps/api' },
      ],
    );
  });

  it('omits only the requested keys from a record', () => {
    assert.deepEqual(
      omitRecordKeys(
        {
          keep: ['a'],
          remove: ['b'],
          alsoKeep: ['c'],
        },
        ['remove', 'missing'],
      ),
      {
        keep: ['a'],
        alsoKeep: ['c'],
      },
    );
  });
});
