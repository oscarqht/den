import type { SessionAgentRunState } from '@/lib/types';

export type SessionCanvasAgentInputHandle = {
  insertText: (text: string) => boolean;
};

export function formatPathsForAgentInput(paths: string[]): string {
  const normalizedPaths = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
  if (normalizedPaths.length === 0) return '';
  return `${normalizedPaths.join(' ')} `;
}

export function insertPathsIntoAgentInput(
  handle: SessionCanvasAgentInputHandle | null | undefined,
  paths: string[],
): boolean {
  const nextText = formatPathsForAgentInput(paths);
  if (!handle || !nextText) {
    return false;
  }

  return handle.insertText(nextText);
}

export function shouldAutoStartSessionCanvasAgentTurn(args: {
  initialized?: boolean;
  initialPrompt?: string | null;
  runState?: SessionAgentRunState | null;
}): boolean {
  if (args.initialized !== false) {
    return false;
  }

  if (!(args.initialPrompt?.trim())) {
    return false;
  }

  return !args.runState || args.runState === 'idle';
}
