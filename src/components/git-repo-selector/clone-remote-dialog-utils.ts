import type { Credential, GitHubCredential } from '@/lib/credentials';
import type { RepoCredentialSelection } from './types';

export function resolveGitHubCredentialForRepoSuggestions(
  credentialOptions: Credential[],
  cloneCredentialSelection: RepoCredentialSelection,
): GitHubCredential | null {
  if (cloneCredentialSelection !== 'auto') {
    const selectedCredential = credentialOptions.find((credential) => credential.id === cloneCredentialSelection);
    if (selectedCredential?.type === 'github') {
      return selectedCredential;
    }
  }

  const githubCredentials = credentialOptions.filter((credential): credential is GitHubCredential => credential.type === 'github');
  return githubCredentials.length === 1 ? githubCredentials[0] : null;
}
