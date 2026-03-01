import { NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * Handles errors in Git API routes.
 *
 * @param error The error object caught in the try-catch block.
 * @returns A NextResponse with the appropriate error message and status code.
 */
export function handleGitError(error: unknown) {
  console.error('Git API Error:', error);

  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: error.issues }, { status: 400 });
  }

  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('not a git repository')) {
    return NextResponse.json({ error: 'Not a git repository' }, { status: 400 });
  }

  return NextResponse.json({ error: message }, { status: 500 });
}
