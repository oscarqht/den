export function getBaseName(path: string): string {
  if (!path) return '';
  const parts = path.split('/');
  return parts.filter(Boolean).pop() || '';
}

export function getDirName(path: string): string {
  if (!path) return '';

  const withoutTrailing = (path.length > 1 && path.endsWith('/'))
    ? path.slice(0, -1)
    : path;

  const lastIdx = withoutTrailing.lastIndexOf('/');

  if (lastIdx === -1) {
    return '.';
  }

  if (lastIdx === 0) return '/';

  return withoutTrailing.substring(0, lastIdx);
}
