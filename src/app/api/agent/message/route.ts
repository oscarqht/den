import { NextResponse } from 'next/server';
import { startSessionTurn } from '@/lib/agent/session-manager';
import { parseReasoningEffort } from '@/lib/agent/route-utils';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    sessionId?: string;
    message?: string;
    displayMessage?: string | null;
    attachmentPaths?: string[];
    reasoningEffort?: string | null;
    markInitialized?: boolean;
  } | null;

  const result = await startSessionTurn({
    sessionId: body?.sessionId ?? '',
    message: body?.message ?? '',
    displayMessage: body?.displayMessage ?? null,
    attachmentPaths: Array.isArray(body?.attachmentPaths) ? body?.attachmentPaths : [],
    reasoningEffort: parseReasoningEffort(body?.reasoningEffort),
    markInitialized: Boolean(body?.markInitialized),
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error || 'Failed to start agent turn.' }, { status: 400 });
  }

  return NextResponse.json(result);
}
