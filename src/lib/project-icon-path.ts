import { createHash } from 'node:crypto';
import path from 'node:path';

export function buildManagedProjectIconPath(
  iconDir: string,
  projectId: string,
  extension: string,
  fileBuffer: Buffer,
): string {
  const projectHash = createHash('sha1').update(projectId).digest('hex').slice(0, 16);
  const contentHash = createHash('sha1').update(fileBuffer).digest('hex').slice(0, 12);
  return path.join(iconDir, `${projectHash}-${contentHash}${extension}`);
}
