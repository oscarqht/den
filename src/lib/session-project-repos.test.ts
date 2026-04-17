import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveProjectRepoPathsForSession,
  shouldDiscoverProjectReposForSession,
} from './session-project-repos.ts';

describe('shouldDiscoverProjectReposForSession', () => {
  it('skips discovery when launch context already includes repo paths', () => {
    assert.equal(shouldDiscoverProjectReposForSession({
      launchContextRepoPaths: ['/workspace/repo-a'],
      sessionRepoPaths: [],
    }), false);
  });

  it('skips discovery when session metadata already includes repo paths', () => {
    assert.equal(shouldDiscoverProjectReposForSession({
      launchContextRepoPaths: [],
      sessionRepoPaths: ['/workspace/repo-a'],
    }), false);
  });

  it('requires discovery only when both sources are empty', () => {
    assert.equal(shouldDiscoverProjectReposForSession({
      launchContextRepoPaths: [],
      sessionRepoPaths: [],
    }), true);
  });
});

describe('resolveProjectRepoPathsForSession', () => {
  it('prefers launch-context repo paths over other sources', () => {
    assert.deepEqual(resolveProjectRepoPathsForSession({
      launchContextRepoPaths: ['/workspace/repo-a'],
      sessionRepoPaths: ['/workspace/repo-b'],
      discoveredProjectRepoPaths: ['/workspace/repo-c'],
    }), ['/workspace/repo-a']);
  });

  it('falls back to session metadata repo paths before project discovery', () => {
    assert.deepEqual(resolveProjectRepoPathsForSession({
      launchContextRepoPaths: [],
      sessionRepoPaths: ['/workspace/repo-b'],
      discoveredProjectRepoPaths: ['/workspace/repo-c'],
    }), ['/workspace/repo-b']);
  });

  it('deduplicates and trims repo paths', () => {
    assert.deepEqual(resolveProjectRepoPathsForSession({
      launchContextRepoPaths: ['  /workspace/repo-a  ', '/workspace/repo-a'],
    }), ['/workspace/repo-a']);
  });

  it('returns discovered repo paths only when no stored repo paths exist', () => {
    assert.deepEqual(resolveProjectRepoPathsForSession({
      launchContextRepoPaths: [],
      sessionRepoPaths: [],
      discoveredProjectRepoPaths: ['/workspace/repo-c'],
    }), ['/workspace/repo-c']);
  });
});
