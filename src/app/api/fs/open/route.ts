import { NextResponse } from 'next/server';
import { z } from 'zod';

import { FsLaunchError, openDirectoryInFileManager, resolveExistingDirectory } from '@/lib/fs-launch';

export const runtime = 'nodejs';

const requestSchema = z.object({
  path: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = requestSchema.parse(body);
    const directoryPath = resolveExistingDirectory(payload.path);

    await openDirectoryInFileManager(directoryPath);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? 'Invalid payload' }, { status: 400 });
    }
    if (error instanceof FsLaunchError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
