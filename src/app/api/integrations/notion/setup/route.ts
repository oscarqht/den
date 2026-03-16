import { NextResponse } from 'next/server';
import { ensureNotionMcpSetupAndAuthStarted } from '@/lib/notion-mcp';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const result = await ensureNotionMcpSetupAndAuthStarted();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error
        ? error.message
        : 'Failed to initialize Notion MCP integration.',
    }, { status: 500 });
  }
}
