
import { NextResponse } from 'next/server';
import { GitService } from '@/lib/git';
import { handleGitError } from '@/lib/api-utils';
import fs from 'node:fs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const path = searchParams.get('path');
  const limit = searchParams.get('limit');
  const scope = searchParams.get('scope') === 'current' ? 'current' : 'all';
  const baseCommitId = searchParams.get('baseCommitId')?.trim() || null;
  const headRef = searchParams.get('headRef')?.trim() || null;
  const includeBoundary = searchParams.get('includeBoundary') !== 'false';

  if (!path) {
    return NextResponse.json({ error: 'Repo path is required' }, { status: 400 });
  }

  // Check if path exists
  if (!fs.existsSync(path)) {
    return NextResponse.json({ error: `Path not found: ${path}` }, { status: 404 });
  }

  try {
    const git = new GitService(path);
    const parsedLimit = limit ? Number.parseInt(limit, 10) : NaN;
    const normalizedLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;
    const log = baseCommitId && headRef
      ? await git.getLogRange(baseCommitId, headRef, {
        includeBoundary,
        limit: normalizedLimit,
      })
      : await git.getLog(normalizedLimit ?? 50, { includeAll: scope !== 'current' });
    return NextResponse.json(log);
  } catch (error) {
    return handleGitError(error);
  }
}
