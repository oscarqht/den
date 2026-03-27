import { NextResponse } from 'next/server';
import {
  AttachmentUploadError,
  getAttachmentUploadErrorMessage,
  getAttachmentUploadErrorStatusCode,
  saveAttachmentsFromFormData,
} from '@/lib/attachment-storage';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const worktreePath = formData.get('worktreePath');
    if (typeof worktreePath !== 'string' || !worktreePath.trim()) {
      throw new AttachmentUploadError('worktreePath is required.');
    }

    const savedPaths = await saveAttachmentsFromFormData(worktreePath, formData);
    return NextResponse.json({ savedPaths });
  } catch (error) {
    return NextResponse.json(
      { error: getAttachmentUploadErrorMessage(error) },
      { status: getAttachmentUploadErrorStatusCode(error) },
    );
  }
}
