import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getFallbackKeytarAccountsForCredential } from './credential-token-fallback.ts';

describe('getFallbackKeytarAccountsForCredential', () => {
  it('prefers matching GitHub identities and excludes unrelated credentials', () => {
    const fallbackAccounts = getFallbackKeytarAccountsForCredential(
      {
        id: 'legacy-id',
        type: 'github',
        username: 'm0o0scar',
        keytarAccount: 'credential-github',
      },
      [
        {
          id: 'new-id',
          type: 'github',
          username: 'm0o0scar',
          keytarAccount: 'credential-new-id',
        },
        {
          id: 'other-id',
          type: 'github',
          username: 'someone-else',
          keytarAccount: 'credential-other-id',
        },
      ],
    );

    assert.deepStrictEqual(fallbackAccounts, ['credential-new-id']);
  });

  it('supports fallback to default keytar account when legacy entry has no explicit account', () => {
    const fallbackAccounts = getFallbackKeytarAccountsForCredential(
      {
        id: 'legacy-id',
        type: 'github',
        username: 'm0o0scar',
        keytarAccount: 'credential-github',
      },
      [
        {
          id: 'new-id',
          type: 'github',
          username: 'm0o0scar',
        },
      ],
    );

    assert.deepStrictEqual(fallbackAccounts, ['credential-new-id']);
  });

  it('only matches GitLab fallbacks when server hosts match', () => {
    const fallbackAccounts = getFallbackKeytarAccountsForCredential(
      {
        id: 'gitlab-legacy-id',
        type: 'gitlab',
        username: 'bot-user',
        serverUrl: 'https://git.insea.io',
        keytarAccount: 'credential-gitlab',
      },
      [
        {
          id: 'gitlab-good',
          type: 'gitlab',
          username: 'bot-user',
          serverUrl: 'https://git.insea.io',
          keytarAccount: 'credential-gitlab-good',
        },
        {
          id: 'gitlab-wrong-host',
          type: 'gitlab',
          username: 'bot-user',
          serverUrl: 'https://gitlab.com',
          keytarAccount: 'credential-gitlab-wrong-host',
        },
      ],
    );

    assert.deepStrictEqual(fallbackAccounts, ['credential-gitlab-good']);
  });

  it('deduplicates fallback accounts and excludes the primary account', () => {
    const fallbackAccounts = getFallbackKeytarAccountsForCredential(
      {
        id: 'legacy-id',
        type: 'github',
        username: 'm0o0scar',
        keytarAccount: 'credential-github',
      },
      [
        {
          id: 'new-id-a',
          type: 'github',
          username: 'm0o0scar',
          keytarAccount: 'credential-new-id',
        },
        {
          id: 'new-id-b',
          type: 'github',
          username: 'm0o0scar',
          keytarAccount: 'credential-new-id',
        },
        {
          id: 'new-id-c',
          type: 'github',
          username: 'm0o0scar',
          keytarAccount: 'credential-github',
        },
      ],
    );

    assert.deepStrictEqual(fallbackAccounts, ['credential-new-id']);
  });
});
