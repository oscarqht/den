export type ParsedAgentStartupHistoryEntry = {
  instructions: string;
  task: string;
};

const STARTUP_HISTORY_PATTERN = /^\s*# Instructions\s*\n+([\s\S]*?)\n+# Task\s*\n+([\s\S]*?)\s*$/;

function normalizeSection(value: string): string {
  return value.trim();
}

export function parseAgentStartupHistoryEntry(text: string | null | undefined): ParsedAgentStartupHistoryEntry | null {
  const normalizedText = typeof text === 'string' ? text : '';
  if (!normalizedText.trim()) {
    return null;
  }

  const match = normalizedText.match(STARTUP_HISTORY_PATTERN);
  if (!match) {
    return null;
  }

  const instructions = normalizeSection(match[1] ?? '');
  const task = normalizeSection(match[2] ?? '');
  if (!instructions || !task) {
    return null;
  }

  return {
    instructions,
    task,
  };
}
