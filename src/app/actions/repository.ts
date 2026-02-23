'use server';

import { resolveRepositoryPathByName } from '@/lib/repo-resolver';

type ResolveRepositoryResult = {
  success: boolean;
  repoPath: string | null;
  error?: string;
};

export async function resolveRepositoryByName(repoName: string): Promise<ResolveRepositoryResult> {
  try {
    const resolvedPath = await resolveRepositoryPathByName(repoName);
    return {
      success: true,
      repoPath: resolvedPath,
    };
  } catch (error) {
    console.error('Failed to resolve repository by name:', error);
    return {
      success: false,
      repoPath: null,
      error: 'Failed to search repositories. Please try again.',
    };
  }
}
