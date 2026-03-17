import { NextResponse } from 'next/server';
import {
  buildQuickCreateJobWsUrl,
  ensureSessionNotificationServer,
} from '@/lib/sessionNotificationServer';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const { wsBaseUrl } = await ensureSessionNotificationServer();
    return NextResponse.json({
      wsUrl: buildQuickCreateJobWsUrl(wsBaseUrl),
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to initialize quick create socket.',
    }, { status: 500 });
  }
}
