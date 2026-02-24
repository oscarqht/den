export function getBaseName(path: string): string {
  if (!path) return '';
  // Support both Windows (\) and POSIX (/) separators
  // Using a simpler approach to avoid regex escaping issues in some environments
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  // Filter out empty strings which can happen with trailing slashes or absolute paths
  return parts.filter(Boolean).pop() || '';
}

export function getDirName(path: string): string {
  if (!path) return '';
  
  // Normalize separators to / for easier processing
  const normalized = path.replace(/\\/g, '/');
  
  // Remove trailing slash if it exists (but not if it's the root '/')
  const withoutTrailing = (normalized.length > 1 && normalized.endsWith('/')) 
    ? normalized.slice(0, -1) 
    : normalized;
    
  const lastIdx = withoutTrailing.lastIndexOf('/');
  
  if (lastIdx === -1) {
    // No separator found. Could be a relative path or a Windows drive root like "C:"
    // For "C:\" or "C:", we return the normalized version (C:/ or C:)
    if (path.includes(':') && path.length <= 3) return normalized;
    return '.';
  }
  
  if (lastIdx === 0) return '/';
  
  // On Windows, if we're at "C:/", lastIdx might be 2.
  if (path.includes(':') && lastIdx === 2) {
      return withoutTrailing.substring(0, 3); // "C:/"
  }
  
  return withoutTrailing.substring(0, lastIdx);
}
