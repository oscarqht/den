import type { SessionAgentHistoryItem, SessionAgentRuntimeState } from '@/lib/types';

function latestUserEntry(history: SessionAgentHistoryItem[]) {
  return history.reduce<SessionAgentHistoryItem | null>((latest, item) => {
    if (item.kind !== 'user') {
      return latest;
    }
    if (!latest || item.ordinal > latest.ordinal) {
      return item;
    }
    return latest;
  }, null);
}

function hasVisibleAgentActivitySinceUser(
  history: SessionAgentHistoryItem[],
  latestUser: SessionAgentHistoryItem,
) {
  return history.some((item) => item.kind !== 'user' && item.ordinal > latestUser.ordinal);
}

export function getPendingAssistantLabel(runtime: SessionAgentRuntimeState | null | undefined) {
  const currentStepKey = runtime?.turnDiagnostics?.currentStepKey ?? null;
  switch (currentStepKey) {
    case 'launch_runtime':
      return 'Launching Codex runtime';
    case 'restore_thread':
      return 'Resuming thread';
    case 'start_thread':
      return 'Creating thread';
    case 'await_turn_started':
      return 'Awaiting turn start';
    default:
      return runtime?.runState === 'running' ? 'Thinking' : 'Launching Codex runtime';
  }
}

export function buildPendingAssistantItem(
  sessionId: string,
  runtime: SessionAgentRuntimeState | null | undefined,
  history: SessionAgentHistoryItem[],
) {
  const runState = runtime?.runState ?? null;
  if (runState !== 'queued' && runState !== 'running') {
    return null;
  }

  const latestUser = latestUserEntry(history);
  if (!latestUser) {
    return null;
  }

  if (hasVisibleAgentActivitySinceUser(history, latestUser)) {
    return null;
  }

  const label = getPendingAssistantLabel(runtime);
  const createdAt = runtime?.lastActivityAt || latestUser.updatedAt || latestUser.createdAt;
  return {
    kind: 'assistant',
    id: `pending-assistant-${runtime?.activeTurnId || latestUser.id}`,
    text: label,
    phase: null,
    sessionName: runtime?.sessionName || sessionId,
    threadId: runtime?.threadId ?? null,
    turnId: runtime?.activeTurnId ?? null,
    ordinal: latestUser.ordinal + 0.5,
    itemStatus: 'pending',
    createdAt,
    updatedAt: createdAt,
  } satisfies SessionAgentHistoryItem;
}
