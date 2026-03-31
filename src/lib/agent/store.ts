import { readLocalState, updateLocalState } from '@/lib/local-db';
import {
  normalizeNullableProviderReasoningEffort,
  normalizeProviderReasoningEffort,
} from '@/lib/agent/reasoning';
import { buildPlanText, normalizePlanSteps, parsePlanStepsFromText } from '@/lib/agent/plan';
import { sortSessionHistoryForTimeline } from '@/lib/agent/history-order';
import type {
  AgentProvider,
  HistoryEntry,
  ReasoningEffort,
  SessionAgentHistoryInput,
  SessionAgentHistoryItem,
  SessionAgentRunState,
  SessionAgentRuntimeState,
} from '@/lib/types';

type SessionRuntimeRow = {
  session_name: string;
  agent: string;
  model: string;
  reasoning_effort: string | null;
  thread_id: string | null;
  active_turn_id: string | null;
  run_state: string | null;
  last_error: string | null;
  last_activity_at: string | null;
};

type SessionAgentHistoryRow = {
  session_name: string;
  item_id: string;
  thread_id: string | null;
  turn_id: string | null;
  ordinal: number | null;
  kind: string;
  status: string | null;
  payload_json: string;
  created_at: string;
  updated_at: string;
};

type NormalizedHistoryWrite = {
  itemId: string;
  entry: HistoryEntry;
  kind: HistoryEntry['kind'];
  payloadJson: string;
  threadIdProvided: boolean;
  threadId: string | null;
  turnIdProvided: boolean;
  turnId: string | null;
  ordinal: number;
  itemStatusProvided: boolean;
  itemStatus: string | null;
  createdAt: string;
  updatedAt: string;
};

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  return normalizeOptionalText(value) ?? null;
}

function toRuntimeState(row: SessionRuntimeRow): SessionAgentRuntimeState {
  return {
    sessionName: row.session_name,
    agentProvider: row.agent as AgentProvider,
    model: row.model,
    reasoningEffort: normalizeProviderReasoningEffort(row.agent, row.reasoning_effort),
    threadId: normalizeNullableText(row.thread_id),
    activeTurnId: normalizeNullableText(row.active_turn_id),
    runState: normalizeNullableText(row.run_state) as SessionAgentRunState | null,
    lastError: normalizeNullableText(row.last_error),
    lastActivityAt: normalizeNullableText(row.last_activity_at),
  };
}

function toHistoryItem(row: SessionAgentHistoryRow): SessionAgentHistoryItem | null {
  try {
    const parsed = JSON.parse(row.payload_json) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const payload = parsed as Record<string, unknown>;
    if (payload.kind !== row.kind) {
      return null;
    }

    if (typeof payload.id !== 'string' || !payload.id.trim()) {
      payload.id = row.item_id;
    }

    if (payload.kind === 'plan') {
      const text = typeof payload.text === 'string' ? payload.text : '';
      const steps = normalizePlanSteps(payload.steps);
      return {
        kind: 'plan',
        id: typeof payload.id === 'string' ? payload.id : row.item_id,
        text: text || buildPlanText(steps),
        steps: steps.length > 0 ? steps : parsePlanStepsFromText(text),
        sessionName: row.session_name,
        threadId: normalizeNullableText(row.thread_id),
        turnId: normalizeNullableText(row.turn_id),
        ordinal: row.ordinal ?? 0,
        itemStatus: normalizeNullableText(row.status),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }

    return {
      ...(payload as HistoryEntry),
      sessionName: row.session_name,
      threadId: normalizeNullableText(row.thread_id),
      turnId: normalizeNullableText(row.turn_id),
      ordinal: row.ordinal ?? 0,
      itemStatus: normalizeNullableText(row.status),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

function normalizeHistoryWrite(input: SessionAgentHistoryInput): NormalizedHistoryWrite | null {
  const itemId = normalizeOptionalText(input.id);
  if (!itemId) {
    return null;
  }

  const {
    threadId,
    turnId,
    ordinal,
    itemStatus,
    createdAt,
    updatedAt,
    ...entry
  } = input;

  const normalizedEntry = { ...entry, id: itemId } as HistoryEntry;

  return {
    itemId,
    entry: normalizedEntry,
    kind: normalizedEntry.kind,
    payloadJson: JSON.stringify(normalizedEntry),
    threadIdProvided: Object.prototype.hasOwnProperty.call(input, 'threadId'),
    threadId: normalizeNullableText(threadId),
    turnIdProvided: Object.prototype.hasOwnProperty.call(input, 'turnId'),
    turnId: normalizeNullableText(turnId),
    ordinal: typeof ordinal === 'number' && Number.isFinite(ordinal) ? Math.max(0, Math.floor(ordinal)) : 0,
    itemStatusProvided: Object.prototype.hasOwnProperty.call(input, 'itemStatus'),
    itemStatus: normalizeNullableText(itemStatus),
    createdAt: normalizeOptionalText(createdAt) ?? new Date().toISOString(),
    updatedAt: normalizeOptionalText(updatedAt) ?? new Date().toISOString(),
  };
}

function parseHistoryEntryPayload(value: string): HistoryEntry | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const entry = parsed as Partial<HistoryEntry>;
    return typeof entry.kind === 'string' && typeof entry.id === 'string'
      ? (entry as HistoryEntry)
      : null;
  } catch {
    return null;
  }
}

function mergeHistoryEntry(existing: HistoryEntry | null, next: HistoryEntry): HistoryEntry {
  if (!existing || existing.kind !== next.kind) {
    return next;
  }

  switch (next.kind) {
    case 'user': {
      const incoming = next as Extract<HistoryEntry, { kind: 'user' }>;
      const current = existing as Extract<HistoryEntry, { kind: 'user' }>;
      return {
        ...incoming,
        text: incoming.text || current.text,
      };
    }
    case 'assistant': {
      const incoming = next as Extract<HistoryEntry, { kind: 'assistant' }>;
      const current = existing as Extract<HistoryEntry, { kind: 'assistant' }>;
      return {
        ...incoming,
        text: incoming.text || current.text,
        phase: incoming.phase ?? current.phase,
      };
    }
    case 'reasoning': {
      const incoming = next as Extract<HistoryEntry, { kind: 'reasoning' }>;
      const current = existing as Extract<HistoryEntry, { kind: 'reasoning' }>;
      return {
        ...incoming,
        summary: incoming.summary || current.summary,
        text: incoming.text || current.text,
      };
    }
    case 'command': {
      const incoming = next as Extract<HistoryEntry, { kind: 'command' }>;
      const current = existing as Extract<HistoryEntry, { kind: 'command' }>;
      return {
        ...incoming,
        output: incoming.output || current.output,
        status: incoming.status || current.status,
        exitCode: incoming.exitCode ?? current.exitCode,
        toolName: incoming.toolName ?? current.toolName,
        toolInput: incoming.toolInput ?? current.toolInput,
      };
    }
    case 'tool': {
      const incoming = next as Extract<HistoryEntry, { kind: 'tool' }>;
      const current = existing as Extract<HistoryEntry, { kind: 'tool' }>;
      return {
        ...incoming,
        source: incoming.source || current.source,
        server: incoming.server ?? current.server,
        status: incoming.status || current.status,
        input: incoming.input ?? current.input,
        message: incoming.message ?? current.message,
        result: incoming.result ?? current.result,
        error: incoming.error ?? current.error,
      };
    }
    case 'fileChange': {
      const incoming = next as Extract<HistoryEntry, { kind: 'fileChange' }>;
      const current = existing as Extract<HistoryEntry, { kind: 'fileChange' }>;
      return {
        ...incoming,
        status: incoming.status || current.status,
        output: incoming.output || current.output,
        changes: incoming.changes.length > 0 ? incoming.changes : current.changes,
      };
    }
    case 'plan': {
      const incoming = next as Extract<HistoryEntry, { kind: 'plan' }>;
      const current = existing as Extract<HistoryEntry, { kind: 'plan' }>;
      const steps = incoming.steps && incoming.steps.length > 0
        ? incoming.steps
        : current.steps;
      return {
        ...incoming,
        text: incoming.text || current.text || buildPlanText(steps ?? []),
        steps,
      };
    }
  }
}

export function readSessionRuntime(sessionName: string): SessionAgentRuntimeState | null {
  const record = readLocalState().sessions[sessionName];
  const row = record ? {
    session_name: record.sessionName,
    agent: record.agent,
    model: record.model,
    reasoning_effort: record.reasoningEffort ?? null,
    thread_id: record.threadId ?? null,
    active_turn_id: record.activeTurnId ?? null,
    run_state: record.runState ?? null,
    last_error: record.lastError ?? null,
    last_activity_at: record.lastActivityAt ?? null,
  } satisfies SessionRuntimeRow : undefined;

  return row ? toRuntimeState(row) : null;
}

export function updateSessionRuntime(
  sessionName: string,
  updates: {
    agentProvider?: AgentProvider;
    model?: string;
    reasoningEffort?: ReasoningEffort | null;
    threadId?: string | null;
    activeTurnId?: string | null;
    runState?: SessionAgentRunState | null;
    lastError?: string | null;
    lastActivityAt?: string | null;
  },
): SessionAgentRuntimeState | null {
  const currentRuntime = readSessionRuntime(sessionName);
  if (Object.keys(updates).length === 0) {
    return readSessionRuntime(sessionName);
  }
  updateLocalState((state) => {
    const session = state.sessions[sessionName];
    if (!session) return;
    if (updates.agentProvider !== undefined) {
      const value = normalizeOptionalText(updates.agentProvider);
      if (value) {
        session.agent = value;
      }
    }
    if (updates.model !== undefined) {
      const value = normalizeOptionalText(updates.model);
      if (value) {
        session.model = value;
      }
    }
    if (updates.reasoningEffort !== undefined) {
      session.reasoningEffort = normalizeNullableProviderReasoningEffort(
        updates.agentProvider ?? currentRuntime?.agentProvider,
        updates.reasoningEffort,
      );
    }
    if (updates.threadId !== undefined) {
      session.threadId = normalizeNullableText(updates.threadId);
    }
    if (updates.activeTurnId !== undefined) {
      session.activeTurnId = normalizeNullableText(updates.activeTurnId);
    }
    if (updates.runState !== undefined) {
      session.runState = normalizeNullableText(updates.runState);
    }
    if (updates.lastError !== undefined) {
      session.lastError = normalizeNullableText(updates.lastError);
    }
    if (updates.lastActivityAt !== undefined) {
      session.lastActivityAt = normalizeNullableText(updates.lastActivityAt);
    }
  });

  return readSessionRuntime(sessionName);
}

export function listSessionHistory(sessionName: string): SessionAgentHistoryItem[] {
  const rows = Object.values(readLocalState().sessionAgentHistoryItems[sessionName] ?? {})
    .map((record) => ({
      session_name: record.sessionName,
      item_id: record.itemId,
      thread_id: record.threadId ?? null,
      turn_id: record.turnId ?? null,
      ordinal: record.ordinal,
      kind: record.kind,
      status: record.status ?? null,
      payload_json: record.payloadJson,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    } satisfies SessionAgentHistoryRow))
    .sort((left, right) => (
      left.ordinal - right.ordinal
      || left.created_at.localeCompare(right.created_at)
      || left.item_id.localeCompare(right.item_id)
    ));

  return sortSessionHistoryForTimeline(rows
    .map((row) => toHistoryItem(row))
    .filter((item): item is SessionAgentHistoryItem => Boolean(item)));
}

export function getNextHistoryOrdinal(sessionName: string): number {
  const items = Object.values(readLocalState().sessionAgentHistoryItems[sessionName] ?? {});
  const maxOrdinal = items.reduce((max, item) => Math.max(max, item.ordinal), -1);
  return maxOrdinal + 1;
}

export function upsertSessionHistoryEntries(sessionName: string, entries: SessionAgentHistoryInput[]) {
  const normalizedEntries = entries
    .map((entry) => normalizeHistoryWrite(entry))
    .filter((entry): entry is NormalizedHistoryWrite => Boolean(entry));

  if (normalizedEntries.length === 0) {
    return;
  }

  updateLocalState((state) => {
    const sessionHistory = state.sessionAgentHistoryItems[sessionName] ?? {};
    for (const write of normalizedEntries) {
      const existingRecord = sessionHistory[write.itemId];
      const existing = existingRecord ? {
        session_name: existingRecord.sessionName,
        item_id: existingRecord.itemId,
        thread_id: existingRecord.threadId ?? null,
        turn_id: existingRecord.turnId ?? null,
        ordinal: existingRecord.ordinal,
        kind: existingRecord.kind,
        status: existingRecord.status ?? null,
        payload_json: existingRecord.payloadJson,
        created_at: existingRecord.createdAt,
        updated_at: existingRecord.updatedAt,
      } satisfies SessionAgentHistoryRow : undefined;
      const mergedEntry = mergeHistoryEntry(
        existing ? parseHistoryEntryPayload(existing.payload_json) : null,
        write.entry,
      );
      sessionHistory[write.itemId] = {
        sessionName,
        itemId: write.itemId,
        threadId: write.threadIdProvided ? write.threadId : (existing?.thread_id ?? null),
        turnId: write.turnIdProvided ? write.turnId : (existing?.turn_id ?? null),
        ordinal: existing?.ordinal ?? write.ordinal,
        kind: write.kind,
        status: write.itemStatusProvided ? write.itemStatus : (existing?.status ?? null),
        payloadJson: JSON.stringify(mergedEntry),
        createdAt: existing?.created_at ?? write.createdAt,
        updatedAt: write.updatedAt,
      };
    }
    state.sessionAgentHistoryItems[sessionName] = sessionHistory;
  });
}

export function clearSessionHistory(sessionName: string) {
  updateLocalState((state) => {
    delete state.sessionAgentHistoryItems[sessionName];
  });
}
