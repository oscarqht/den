import type { SessionAgentRunState } from '@/lib/types';

const sessionCanvasAutoStartClaims = new Set<string>();

export type SessionCanvasAgentInputHandle = {
  insertText: (text: string) => boolean;
  setReasoningEffort?: (effort: string) => boolean;
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

export function shouldReleaseSessionCanvasAgentSendLock(args: {
  isSending: boolean;
  optimisticMessageCount: number;
  runState?: SessionAgentRunState | null;
}): boolean {
  if (!args.isSending) {
    return false;
  }

  if (args.optimisticMessageCount > 0) {
    return false;
  }

  return Boolean(args.runState && args.runState !== 'idle');
}

export function buildSessionCanvasAutoStartKey(sessionId: string, prompt: string): string {
  const normalizedSessionId = sessionId.trim();
  const normalizedPrompt = prompt.trim();
  return normalizedSessionId && normalizedPrompt
    ? `${normalizedSessionId}:${normalizedPrompt}`
    : '';
}

export function claimSessionCanvasAutoStart(key: string): boolean {
  const normalizedKey = key.trim();
  if (!normalizedKey) {
    return false;
  }

  if (sessionCanvasAutoStartClaims.has(normalizedKey)) {
    return false;
  }

  sessionCanvasAutoStartClaims.add(normalizedKey);
  return true;
}

export function releaseSessionCanvasAutoStart(key: string): void {
  const normalizedKey = key.trim();
  if (!normalizedKey) {
    return;
  }

  sessionCanvasAutoStartClaims.delete(normalizedKey);
}
