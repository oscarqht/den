export async function uploadAttachments(worktreePath: string, formData: FormData): Promise<string[]> {
  const requestBody = new FormData();
  requestBody.append('worktreePath', worktreePath);

  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      requestBody.append(key, value, value.name);
      continue;
    }
    requestBody.append(key, value);
  }

  const response = await fetch('/api/attachments', {
    method: 'POST',
    body: requestBody,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to upload attachments.');
  }

  if (!Array.isArray(payload?.savedPaths)) {
    throw new Error('Failed to upload attachments.');
  }

  return payload.savedPaths.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}
