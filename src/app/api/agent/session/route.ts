import { NextRequest, NextResponse } from 'next/server';
import { getSessionAgentSnapshot, replaceSessionAgentHistory } from '@/app/actions/session';
import { getAgentAdapter } from '@/lib/agent/providers';
import { enrichSessionRuntimeWithDiagnostics } from '@/lib/agent/session-manager';
import type { HistoryEntry, SessionAgentHistoryItem } from '@/lib/types';

export const runtime = 'nodejs';

function hasPlanDetails(entry: HistoryEntry | SessionAgentHistoryItem): boolean {
  if (entry.kind !== 'plan') {
    return false;
  }

  return Boolean(
    (entry.steps && entry.steps.length > 0)
    || (typeof entry.text === 'string' && entry.text.trim()),
  );
}

function hasBrokenPlan(history: SessionAgentHistoryItem[]): boolean {
  return history.some((entry) => entry.kind === 'plan' && !hasPlanDetails(entry));
}

function repairPlanHistory(
  history: SessionAgentHistoryItem[],
  replayedEntries: HistoryEntry[],
): SessionAgentHistoryItem[] {
  const replayedPlans = replayedEntries.filter(hasPlanDetails);
  if (replayedPlans.length === 0) {
    return history;
  }

  const replayedById = new Map(
    replayedPlans.map((entry) => [entry.id, entry]),
  );
  const remainingPlans = [...replayedPlans];
  let changed = false;
  const repaired = history.map((entry) => {
    if (entry.kind !== 'plan' || hasPlanDetails(entry)) {
      return entry;
    }

    const matched = replayedById.get(entry.id) ?? remainingPlans.shift();
    if (!matched || matched.kind !== 'plan') {
      return entry;
    }

    changed = true;
    return {
      ...entry,
      text: matched.text,
      steps: matched.steps,
    };
  });

  return changed ? repaired : history;
}

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId')?.trim();
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 });
  }

  const snapshotResult = await getSessionAgentSnapshot(sessionId);
  if (!snapshotResult.success || !snapshotResult.snapshot) {
    return NextResponse.json({
      error: snapshotResult.error || 'Session not found.',
    }, { status: 404 });
  }

  const snapshot = snapshotResult.snapshot;
  const enrichedSnapshot = {
    ...snapshot,
    runtime: enrichSessionRuntimeWithDiagnostics(sessionId, snapshot.runtime) ?? snapshot.runtime,
  };
  if (enrichedSnapshot.runtime.threadId && (
    enrichedSnapshot.history.length === 0
    || hasBrokenPlan(enrichedSnapshot.history)
  )) {
    try {
      const adapter = getAgentAdapter(enrichedSnapshot.runtime.agentProvider);
      const thread = await adapter.readThreadHistory({
        workspacePath: enrichedSnapshot.metadata.workspacePath,
        threadId: enrichedSnapshot.runtime.threadId,
        model: enrichedSnapshot.runtime.model,
        reasoningEffort: enrichedSnapshot.runtime.reasoningEffort ?? null,
      });

      const history = thread.entries.map((entry, index) => ({
        ...entry,
        threadId: thread.threadId,
        ordinal: index,
      }));
      if (enrichedSnapshot.history.length === 0) {
        await replaceSessionAgentHistory(sessionId, history);
        const refreshed = await getSessionAgentSnapshot(sessionId);
        if (refreshed.success && refreshed.snapshot) {
          return NextResponse.json({
            ...refreshed.snapshot,
            runtime: enrichSessionRuntimeWithDiagnostics(sessionId, refreshed.snapshot.runtime) ?? refreshed.snapshot.runtime,
          });
        }
      } else {
        const repairedHistory = repairPlanHistory(enrichedSnapshot.history, thread.entries);
        if (repairedHistory !== enrichedSnapshot.history) {
          return NextResponse.json({
            ...enrichedSnapshot,
            history: repairedHistory,
          });
        }
      }
    } catch {
      // Fall through to the persisted snapshot when provider replay is unavailable.
    }
  }

  return NextResponse.json(enrichedSnapshot);
}
