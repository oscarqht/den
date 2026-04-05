import assert from 'node:assert';
import { describe, it } from 'node:test';

import type { Credential } from '@/lib/credentials';
import { resolveGitHubCredentialForRepoSuggestions } from './clone-remote-dialog-utils.ts';

const githubCredentialA: Credential = {
  id: 'github-a',
  type: 'github',
  username: 'alice',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const githubCredentialB: Credential = {
  id: 'github-b',
  type: 'github',
  username: 'bob',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const gitlabCredential: Credential = {
  id: 'gitlab-a',
  type: 'gitlab',
  username: 'carol',
  serverUrl: 'https://gitlab.example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('resolveGitHubCredentialForRepoSuggestions', () => {
  it('prefers the explicitly selected GitHub credential', () => {
    const result = resolveGitHubCredentialForRepoSuggestions(
      [githubCredentialA, githubCredentialB, gitlabCredential],
      'github-b',
    );

    assert.deepStrictEqual(result, githubCredentialB);
  });

  it('uses the only GitHub credential when selection is auto', () => {
    const result = resolveGitHubCredentialForRepoSuggestions(
      [gitlabCredential, githubCredentialA],
      'auto',
    );

    assert.deepStrictEqual(result, githubCredentialA);
  });

  it('still uses the only GitHub credential when a non-GitHub credential is selected', () => {
    const result = resolveGitHubCredentialForRepoSuggestions(
      [gitlabCredential, githubCredentialA],
      'gitlab-a',
    );

    assert.deepStrictEqual(result, githubCredentialA);
  });

  it('does not guess when multiple GitHub credentials exist and none is selected', () => {
    const result = resolveGitHubCredentialForRepoSuggestions(
      [githubCredentialA, githubCredentialB, gitlabCredential],
      'auto',
    );

    assert.strictEqual(result, null);
  });
});
