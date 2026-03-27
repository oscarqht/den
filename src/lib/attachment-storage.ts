import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ATTACHMENTS_ROOT_DIR = path.join(os.tmpdir(), 'viba-attachments');
export const MAX_ATTACHMENT_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENT_TOTAL_BYTES = 50 * 1024 * 1024;

export class AttachmentUploadError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'AttachmentUploadError';
    this.statusCode = statusCode;
  }
}

function formatBytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return Number.isInteger(megabytes) ? `${megabytes} MB` : `${megabytes.toFixed(1)} MB`;
}

function sanitizeAttachmentFileName(fileName: string, fallbackPrefix: string): string {
  const trimmedName = fileName.trim();
  if (!trimmedName) {
    return `${fallbackPrefix}-${Date.now()}`;
  }
  return trimmedName.replace(/[^a-zA-Z0-9._-]/g, '_') || `${fallbackPrefix}-${Date.now()}`;
}

export function getAttachmentUploadErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to upload attachments.';
}

export function getAttachmentUploadErrorStatusCode(error: unknown): number {
  return error instanceof AttachmentUploadError ? error.statusCode : 500;
}

export async function saveAttachmentsFromFormData(worktreePath: string, formData: FormData): Promise<string[]> {
  return saveAttachmentsFromEntries(worktreePath, formData.entries());
}

export async function saveAttachmentsFromEntries(
  worktreePath: string,
  entries: IterableIterator<[string, FormDataEntryValue]>,
): Promise<string[]> {
  const normalizedWorktreePath = worktreePath.trim();
  if (!normalizedWorktreePath) {
    throw new AttachmentUploadError('worktreePath is required.');
  }

  const worktreeLabel = path.basename(normalizedWorktreePath).replace(/[^a-zA-Z0-9._-]/g, '_') || 'workspace';
  const attachmentsDir = path.join(ATTACHMENTS_ROOT_DIR, worktreeLabel);
  await fs.mkdir(attachmentsDir, { recursive: true });

  const savedPaths: string[] = [];
  let totalBytes = 0;

  for (const [, entry] of entries) {
    if (!(entry instanceof File)) continue;

    const rawName = entry.name.trim() || 'attachment';
    if (entry.size > MAX_ATTACHMENT_FILE_BYTES) {
      throw new AttachmentUploadError(
        `"${rawName}" exceeds the ${formatBytes(MAX_ATTACHMENT_FILE_BYTES)} file limit.`,
        413,
      );
    }

    totalBytes += entry.size;
    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
      throw new AttachmentUploadError(
        `Attachments exceed the ${formatBytes(MAX_ATTACHMENT_TOTAL_BYTES)} total upload limit.`,
        413,
      );
    }

    const safeName = sanitizeAttachmentFileName(entry.name, 'attachment');
    const parsed = path.parse(safeName);
    const baseName = parsed.name || `attachment-${Date.now()}`;
    const extension = parsed.ext || '';
    let candidateName = `${baseName}${extension}`;
    let fullPath = path.join(attachmentsDir, candidateName);
    let suffix = 1;

    while (true) {
      try {
        await fs.access(fullPath);
        candidateName = `${baseName}-${suffix}${extension}`;
        fullPath = path.join(attachmentsDir, candidateName);
        suffix += 1;
      } catch {
        break;
      }
    }

    const buffer = Buffer.from(await entry.arrayBuffer());
    await fs.writeFile(fullPath, buffer);
    savedPaths.push(fullPath);
  }

  return savedPaths;
}
