const LEGACY_GIT_TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/;

export function normalizeGitTimestamp(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  const legacyMatch = trimmed.match(LEGACY_GIT_TIMESTAMP_PATTERN);
  if (!legacyMatch) return trimmed;

  const [, datePart, timePart, offsetHours, offsetMinutes] = legacyMatch;
  return `${datePart}T${timePart}${offsetHours}:${offsetMinutes}`;
}

export function parseGitTimestamp(value: string): Date | null {
  const normalized = normalizeGitTimestamp(value);
  if (!normalized) return null;

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatGitTimestamp(
  value: string,
  locales?: Intl.LocalesArgument,
  options?: Intl.DateTimeFormatOptions,
): string {
  const parsed = parseGitTimestamp(value);
  if (!parsed) {
    return value;
  }

  return parsed.toLocaleString(locales, options);
}
