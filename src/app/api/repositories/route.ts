import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getRepositories, updateRepository } from '@/lib/store';

const updateRepositorySchema = z.object({
  path: z.string().min(1),
  updates: z.object({
    name: z.string().optional(),
    expandedFolders: z.array(z.string()).optional(),
    visibilityMap: z.record(z.string(), z.enum(['visible', 'hidden'])).optional(),
    localGroupExpanded: z.boolean().optional(),
    remotesGroupExpanded: z.boolean().optional(),
    worktreesGroupExpanded: z.boolean().optional(),
  }),
});

export async function GET() {
  return NextResponse.json(getRepositories());
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { path, updates } = updateRepositorySchema.parse(body);
    return NextResponse.json(updateRepository(path, updates));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : 'Failed to update repository.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
