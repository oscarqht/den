import { NextRequest, NextResponse } from 'next/server';

import { buildPreviewProxyUrl, ensurePreviewProxyServer } from '@/lib/previewProxyServer';

export const runtime = 'nodejs';

type StartPreviewProxyRequestBody = {
  target?: unknown;
};

export async function POST(request: NextRequest) {
  let body: StartPreviewProxyRequestBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
  }

  if (!body || typeof body.target !== 'string' || !body.target.trim()) {
    return NextResponse.json({ error: 'target is required' }, { status: 400 });
  }

  try {
    const target = body.target.trim();
    const { proxyBaseUrl } = await ensurePreviewProxyServer(target);
    const proxyUrl = buildPreviewProxyUrl(proxyBaseUrl, target);

    return NextResponse.json({
      proxyBaseUrl,
      proxyUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start preview proxy';
    const status = message.toLowerCase().includes('http') ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
