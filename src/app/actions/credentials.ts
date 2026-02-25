'use server';

import {
  deleteCredential,
  getAllCredentials,
  upsertGitHubCredential,
  upsertGitLabCredential,
} from '@/lib/credentials';
import type { Credential, CredentialType } from '@/lib/credentials';

type ListCredentialsResult =
  | { success: true; credentials: Credential[] }
  | { success: false; error: string };

export async function listCredentials(): Promise<ListCredentialsResult> {
  try {
    const credentials = await getAllCredentials();
    return { success: true, credentials };
  } catch (error) {
    console.error('Failed to list credentials:', error);
    return { success: false, error: 'Failed to load credentials.' };
  }
}

type SaveCredentialResult =
  | { success: true; credential: Credential }
  | { success: false; error: string };

export async function saveGitHubCredential(token: string): Promise<SaveCredentialResult> {
  const result = await upsertGitHubCredential(token);
  if (!result.success || !result.credential) {
    return { success: false, error: result.error || 'Failed to save GitHub credential.' };
  }

  return { success: true, credential: result.credential };
}

export async function saveGitLabCredential(serverUrl: string, token: string): Promise<SaveCredentialResult> {
  const result = await upsertGitLabCredential(serverUrl, token);
  if (!result.success || !result.credential) {
    return { success: false, error: result.error || 'Failed to save GitLab credential.' };
  }

  return { success: true, credential: result.credential };
}

type RemoveCredentialResult =
  | { success: true }
  | { success: false; error: string };

export async function removeCredential(type: CredentialType): Promise<RemoveCredentialResult> {
  try {
    const result = await deleteCredential(type);
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to remove credential.' };
    }

    return { success: true };
  } catch (error) {
    console.error('Failed to remove credential:', error);
    return { success: false, error: 'Failed to remove credential.' };
  }
}
