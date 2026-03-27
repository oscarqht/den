import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  AttachmentUploadError,
  MAX_ATTACHMENT_FILE_BYTES,
  MAX_ATTACHMENT_TOTAL_BYTES,
  saveAttachmentsFromFormData,
} from './attachment-storage.ts';

const cleanupTargets = new Set<string>();

after(async () => {
  await Promise.all(Array.from(cleanupTargets, (target) => fs.rm(target, { recursive: true, force: true })));
});

function getAttachmentsDir(worktreePath: string): string {
  const worktreeLabel = path.basename(worktreePath.trim()).replace(/[^a-zA-Z0-9._-]/g, '_') || 'workspace';
  return path.join(os.tmpdir(), 'viba-attachments', worktreeLabel);
}

describe('saveAttachmentsFromFormData', () => {
  it('writes uploaded files and avoids filename collisions', async () => {
    const worktreePath = `test-worktree-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const attachmentsDir = getAttachmentsDir(worktreePath);
    cleanupTargets.add(attachmentsDir);

    const formData = new FormData();
    formData.append('attachment-1', new File(['alpha'], 'report?.txt', { type: 'text/plain' }));
    formData.append('attachment-2', new File(['beta'], 'report?.txt', { type: 'text/plain' }));

    const savedPaths = await saveAttachmentsFromFormData(worktreePath, formData);

    assert.equal(savedPaths.length, 2);
    assert.equal(path.basename(savedPaths[0]), 'report_.txt');
    assert.equal(path.basename(savedPaths[1]), 'report_-1.txt');
    assert.equal(await fs.readFile(savedPaths[0], 'utf8'), 'alpha');
    assert.equal(await fs.readFile(savedPaths[1], 'utf8'), 'beta');
  });

  it('rejects files larger than the configured per-file limit', async () => {
    const formData = new FormData();
    formData.append(
      'attachment',
      new File([Buffer.alloc(MAX_ATTACHMENT_FILE_BYTES + 1)], 'huge.bin', { type: 'application/octet-stream' }),
    );

    await assert.rejects(
      () => saveAttachmentsFromFormData('oversized-file', formData),
      (error: unknown) => {
        assert.ok(error instanceof AttachmentUploadError);
        assert.equal(error.statusCode, 413);
        assert.match(error.message, /huge\.bin/);
        return true;
      },
    );
  });

  it('rejects requests that exceed the total upload limit', async () => {
    const chunkSize = Math.floor(MAX_ATTACHMENT_TOTAL_BYTES / 3) + 1;
    const formData = new FormData();
    formData.append('attachment-1', new File([Buffer.alloc(chunkSize)], 'chunk-1.bin'));
    formData.append('attachment-2', new File([Buffer.alloc(chunkSize)], 'chunk-2.bin'));
    formData.append('attachment-3', new File([Buffer.alloc(chunkSize)], 'chunk-3.bin'));

    await assert.rejects(
      () => saveAttachmentsFromFormData('oversized-total', formData),
      (error: unknown) => {
        assert.ok(error instanceof AttachmentUploadError);
        assert.equal(error.statusCode, 413);
        assert.match(error.message, /total upload limit/i);
        return true;
      },
    );
  });
});
