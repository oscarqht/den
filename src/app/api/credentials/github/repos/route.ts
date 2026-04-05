import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCredentialById, getCredentialToken } from '@/lib/credentials';

interface GitHubRepoApiItem {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  updated_at: string;
  html_url: string;
  clone_url: string;
  ssh_url: string;
}

class GitHubApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const querySchema = z.object({
  credentialId: z.string().min(1, 'Credential ID is required'),
});

const GITHUB_REPOS_PER_PAGE = 100;

function createGitHubRequestHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function hasGitHubNextPage(linkHeader: string | null): boolean {
  if (!linkHeader) return false;
  return linkHeader
    .split(',')
    .some((entry) => entry.includes('rel="next"'));
}

async function fetchAllGitHubRepositories(token: string): Promise<GitHubRepoApiItem[]> {
  const repositories: GitHubRepoApiItem[] = [];

  for (let page = 1; ; page += 1) {
    const response = await fetch(
      `https://api.github.com/user/repos?sort=updated&direction=desc&per_page=${GITHUB_REPOS_PER_PAGE}&type=all&page=${page}`,
      {
        headers: createGitHubRequestHeaders(token),
        cache: 'no-store',
      },
    );

    if (!response.ok) {
      if (response.status === 401) {
        throw new GitHubApiError('Invalid or expired GitHub token', 401);
      }
      throw new GitHubApiError(`GitHub API error: ${response.status}`, 502);
    }

    const pageRepositories = (await response.json()) as GitHubRepoApiItem[];
    repositories.push(...pageRepositories);

    if (!hasGitHubNextPage(response.headers.get('link'))) {
      break;
    }
  }

  repositories.sort((left, right) => (
    new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
  ));

  return repositories;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const { credentialId } = querySchema.parse({
      credentialId: searchParams.get('credentialId'),
    });

    const credential = await getCredentialById(credentialId);
    if (!credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 });
    }
    if (credential.type !== 'github') {
      return NextResponse.json({ error: 'Selected credential is not a GitHub credential' }, { status: 400 });
    }

    const token = await getCredentialToken(credential.id);
    if (!token) {
      return NextResponse.json({ error: 'Token not found for selected credential' }, { status: 400 });
    }

    const repositories = await fetchAllGitHubRepositories(token);
    const payload = repositories.map((repo) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      private: repo.private,
      updatedAt: repo.updated_at,
      htmlUrl: repo.html_url,
      cloneUrl: repo.clone_url,
      sshUrl: repo.ssh_url,
    }));

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    }
    if (error instanceof GitHubApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to list GitHub repositories:', error);
    return NextResponse.json({ error: 'Failed to list GitHub repositories' }, { status: 500 });
  }
}
