'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Credential, CredentialType } from '@/lib/credentials';

// Re-export types for client-side use
export type { Credential, CredentialType };
export type { GitHubCredential, GitLabCredential } from '@/lib/credentials';

export interface GitHubRepositoryOption {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  updatedAt: string;
  htmlUrl: string;
  cloneUrl: string;
  sshUrl: string;
}

async function fetchCredentials(): Promise<Credential[]> {
  const res = await fetch('/api/credentials');
  if (!res.ok) {
    throw new Error('Failed to fetch credentials');
  }
  return res.json();
}

export function useCredentials() {
  return useQuery({
    queryKey: ['credentials'],
    queryFn: fetchCredentials,
  });
}

async function fetchGitHubRepositories(credentialId: string): Promise<GitHubRepositoryOption[]> {
  const res = await fetch(`/api/credentials/github/repos?credentialId=${encodeURIComponent(credentialId)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Failed to fetch GitHub repositories');
  }
  return data;
}

export function useGitHubRepositories(credentialId: string | null) {
  return useQuery({
    queryKey: ['credentials', 'github-repos', credentialId],
    queryFn: () => fetchGitHubRepositories(credentialId!),
    enabled: !!credentialId,
  });
}

// Create GitHub credential
interface CreateGitHubParams {
  type: 'github';
  token: string;
}

interface CreateGitLabParams {
  type: 'gitlab';
  serverUrl: string;
  token: string;
}

type CreateCredentialParams = CreateGitHubParams | CreateGitLabParams;

async function createCredential(params: CreateCredentialParams): Promise<Credential> {
  const res = await fetch('/api/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  
  const data = await res.json();
  
  if (!res.ok) {
    throw new Error(data.error || 'Failed to create credential');
  }
  
  return data;
}

export function useCreateCredential() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: createCredential,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
    },
  });
}

// Update credential
interface UpdateCredentialParams {
  id: string;
  token: string;
}

async function updateCredential(params: UpdateCredentialParams): Promise<Credential> {
  const res = await fetch('/api/credentials', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  
  const data = await res.json();
  
  if (!res.ok) {
    throw new Error(data.error || 'Failed to update credential');
  }
  
  return data;
}

export function useUpdateCredential() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: updateCredential,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
    },
  });
}

// Delete credential
async function deleteCredentialApi(id: string): Promise<void> {
  const res = await fetch('/api/credentials', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  
  const data = await res.json();
  
  if (!res.ok) {
    throw new Error(data.error || 'Failed to delete credential');
  }
}

export function useDeleteCredential() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: deleteCredentialApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
    },
  });
}
