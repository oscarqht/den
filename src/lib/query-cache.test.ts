import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getLatestQueryUpdatedAt,
  getLegacyAgentStatusStorageKey,
  getQueryCacheState,
  isProjectGitRepoDiscoveryQueryKey,
  isPersistedQuery,
  readLegacyAgentStatusCache,
} from './query-cache.ts';

test('getQueryCacheState reports cached refresh state', () => {
  const state = getQueryCacheState({
    data: { ok: true },
    dataUpdatedAt: Date.parse('2026-04-02T10:00:00.000Z'),
    isFetching: true,
  });

  assert.deepEqual(state, {
    hasCachedData: true,
    isRefreshing: true,
    lastUpdatedAt: '2026-04-02T10:00:00.000Z',
  });
});

test('getLatestQueryUpdatedAt picks the newest timestamp', () => {
  assert.equal(
    getLatestQueryUpdatedAt(
      {
        hasCachedData: true,
        isRefreshing: false,
        lastUpdatedAt: '2026-04-02T09:00:00.000Z',
      },
      {
        hasCachedData: true,
        isRefreshing: true,
        lastUpdatedAt: '2026-04-02T11:00:00.000Z',
      },
    ),
    '2026-04-02T11:00:00.000Z',
  );
});

test('readLegacyAgentStatusCache normalizes stored model catalogs', () => {
  const storage = {
    getItem(key: string) {
      if (key !== getLegacyAgentStatusStorageKey('codex')) {
        return null;
      }
      return JSON.stringify({
        models: [
          {
            id: 'gpt-5',
            label: 'GPT-5',
            description: 'Primary',
            reasoningEfforts: ['medium', 'high'],
          },
          { id: '   ', label: 'Invalid' },
        ],
        defaultModel: 'gpt-5',
        updatedAt: '2026-04-02T10:00:00.000Z',
      });
    },
  };

  assert.deepEqual(readLegacyAgentStatusCache(storage, 'codex'), {
    models: [
      {
        id: 'gpt-5',
        label: 'GPT-5',
        description: 'Primary',
        reasoningEfforts: ['medium', 'high'],
      },
    ],
    defaultModel: 'gpt-5',
    updatedAt: '2026-04-02T10:00:00.000Z',
  });
});

test('isPersistedQuery only persists successful queries explicitly marked as persistable', () => {
  assert.equal(isPersistedQuery({
    meta: { persist: true },
    state: { status: 'success' },
  } as never), true);
  assert.equal(isPersistedQuery({
    meta: { persist: true },
    state: { status: 'error' },
  } as never), false);
  assert.equal(isPersistedQuery({
    meta: {},
    state: { status: 'success' },
  } as never), false);
});

test('isProjectGitRepoDiscoveryQueryKey matches project and home repo discovery queries', () => {
  assert.equal(isProjectGitRepoDiscoveryQueryKey(['project', '/tmp/demo', 'git-repos']), true);
  assert.equal(isProjectGitRepoDiscoveryQueryKey(['home', 'project-git-repos', '/tmp/demo']), true);
  assert.equal(isProjectGitRepoDiscoveryQueryKey(['git', '/tmp/demo', 'branches']), false);
});
