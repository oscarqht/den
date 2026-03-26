import path from 'node:path';

export function isPathWithinDirectory(rootPath: string, candidatePath: string): boolean {
  const normalizedRoot = path.resolve(rootPath);
  const normalizedCandidate = path.resolve(candidatePath);

  if (normalizedRoot === normalizedCandidate) {
    return true;
  }

  const rootWithSeparator = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : `${normalizedRoot}${path.sep}`;

  return normalizedCandidate.startsWith(rootWithSeparator);
}
