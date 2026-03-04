export type CredentialLookupMetadata = {
  id: string;
  type: 'github' | 'gitlab';
  username: string;
  serverUrl?: string;
  keytarAccount?: string;
};

function getDefaultKeytarAccount(id: string): string {
  return `credential-${id}`;
}

function getKeytarAccountForMetadata(metadata: { id: string; keytarAccount?: string }): string {
  return metadata.keytarAccount || getDefaultKeytarAccount(metadata.id);
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function normalizeHost(value: string | undefined): string | null {
  if (!value) return null;

  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isSameCredentialIdentity(target: CredentialLookupMetadata, candidate: CredentialLookupMetadata): boolean {
  if (target.id === candidate.id) {
    return true;
  }

  if (target.type !== candidate.type) return false;
  if (normalizeUsername(target.username) !== normalizeUsername(candidate.username)) return false;

  if (target.type === 'gitlab') {
    const targetHost = normalizeHost(target.serverUrl || 'https://gitlab.com');
    const candidateHost = normalizeHost(candidate.serverUrl || 'https://gitlab.com');
    return targetHost !== null && targetHost === candidateHost;
  }

  return true;
}

export function getFallbackKeytarAccountsForCredential(
  target: CredentialLookupMetadata,
  candidates: CredentialLookupMetadata[],
): string[] {
  const primaryAccount = getKeytarAccountForMetadata(target);
  const unique = new Set<string>();

  for (const candidate of candidates) {
    if (!isSameCredentialIdentity(target, candidate)) continue;

    const account = getKeytarAccountForMetadata(candidate);
    if (account === primaryAccount) continue;
    unique.add(account);
  }

  return Array.from(unique);
}
