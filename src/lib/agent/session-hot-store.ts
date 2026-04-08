import fs from 'node:fs';
import path from 'node:path';

import {
  getVibaDirPath,
  readLocalState,
  updateLocalState,
  type LocalSessionAgentHistoryRecord,
  type LocalSessionRecord,
} from '@/lib/local-db';
import { sortSessionHistoryForTimeline } from '@/lib/agent/history-order';
import { buildPlanText, normalizePlanSteps, parsePlanStepsFromText } from '@/lib/agent/plan';
import {
  normalizeNullableProviderReasoningEffort,
  normalizeProviderReasoningEffort,
} from '@/lib/agent/reasoning';
import type {
  AgentProvider,
  HistoryEntry,
  ReasoningEffort,
  SessionAgentHistoryInput,
  SessionAgentHistoryItem,
  SessionAgentRunState,
  SessionAgentRuntimeState,
} from '@/lib/types';

const SESSION_STATE_DIR_NAME = 'session-state';
const FLUSH_DEBOUNCE_MS = 250;
const HISTORY_WAL_COMPACT_MAX_RECORDS = 1000;
const HISTORY_WAL_COMPACT_MAX_BYTES = 1_000_000;

type PersistedHistoryRecord = {
  sessionName: string;
  itemId: string;
  threadId: string | null;
  turnId: string | null;
  ordinal: number;
  kind: string;
  status: string | null;
  payloadJson: string;
  createdAt: string;
  updatedAt: string;
};

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

type SessionHotStoreCache = {
  sessionName: string;
  loaded: boolean;
  migrationAttempted: boolean;
  runtime: SessionAgentRuntimeState | null;
  historyById: Map<string, PersistedHistoryRecord>;
  dirtyRuntime: boolean;
  rewriteSnapshotOnFlush: boolean;
  pendingWalRecords: PersistedHistoryRecord[];
  walRecordCount: number;
  walBytes: number;
  flushTimer: NodeJS.Timeout | null;
};

export type SessionHotStoreRuntimePatch = {
  agentProvider?: AgentProvider;
  model?: string;
  reasoningEffort?: ReasoningEffort | null;
  threadId?: string | null;
  activeTurnId?: string | null;
  runState?: SessionAgentRunState | null;
  lastError?: string | null;
  lastActivityAt?: string | null;
};

export type SessionHotStoreHistoryQuery = {
  threadId?: string;
  turnId?: string;
  limit?: number;
  beforeOrdinal?: number;
};

export type SessionHotStoreHistoryPage = {
  history: SessionAgentHistoryItem[];
  hasOlder: boolean;
  oldestLoadedOrdinal: number | null;
};

type SessionHotStorePaths = {
  sessionDir: string;
  runtimePath: string;
  snapshotPath: string;
  walPath: string;
};

const sessionCaches = new Map<string, SessionHotStoreCache>();
let processHooksInstalled = false;

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  return normalizeOptionalText(value) ?? null;
}

function normalizeSessionName(sessionName: string): string {
  return normalizeOptionalText(sessionName) ?? '';
}

function getSessionHotStorePaths(sessionName: string): SessionHotStorePaths {
  const normalized = normalizeSessionName(sessionName);
  const sessionDir = path.join(
    getVibaDirPath(),
    SESSION_STATE_DIR_NAME,
    encodeURIComponent(normalized),
  );
  return {
    sessionDir,
    runtimePath: path.join(sessionDir, 'runtime.json'),
    snapshotPath: path.join(sessionDir, 'history.snapshot.json'),
    walPath: path.join(sessionDir, 'history.wal.ndjson'),
  };
}

function ensureSessionStateDir(paths: SessionHotStorePaths): void {
  fs.mkdirSync(paths.sessionDir, { recursive: true });
}

function writeFileAtomic(targetPath: string, contents: string): void {
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, contents, 'utf8');
  fs.renameSync(tempPath, targetPath);
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

function toHistoryRow(record: PersistedHistoryRecord): SessionAgentHistoryRow {
  return {
    session_name: record.sessionName,
    item_id: record.itemId,
    thread_id: record.threadId,
    turn_id: record.turnId,
    ordinal: record.ordinal,
    kind: record.kind,
    status: record.status,
    payload_json: record.payloadJson,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function toPersistedHistoryRecord(record: LocalSessionAgentHistoryRecord): PersistedHistoryRecord {
  return {
    sessionName: record.sessionName,
    itemId: record.itemId,
    threadId: normalizeNullableText(record.threadId),
    turnId: normalizeNullableText(record.turnId),
    ordinal: typeof record.ordinal === 'number' && Number.isFinite(record.ordinal)
      ? Math.max(0, Math.floor(record.ordinal))
      : 0,
    kind: record.kind,
    status: normalizeNullableText(record.status),
    payloadJson: record.payloadJson,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function createPersistedHistoryRecord(
  sessionName: string,
  write: NormalizedHistoryWrite,
  existing?: PersistedHistoryRecord | null,
): PersistedHistoryRecord {
  const mergedEntry = mergeHistoryEntry(
    existing ? parseHistoryEntryPayload(existing.payloadJson) : null,
    write.entry,
  );

  return {
    sessionName,
    itemId: write.itemId,
    threadId: write.threadIdProvided ? write.threadId : (existing?.threadId ?? null),
    turnId: write.turnIdProvided ? write.turnId : (existing?.turnId ?? null),
    ordinal: existing?.ordinal ?? write.ordinal,
    kind: write.kind,
    status: write.itemStatusProvided ? write.itemStatus : (existing?.status ?? null),
    payloadJson: JSON.stringify(mergedEntry),
    createdAt: existing?.createdAt ?? write.createdAt,
    updatedAt: write.updatedAt,
  };
}

function toLegacyRuntime(record: LocalSessionRecord): SessionAgentRuntimeState {
  return {
    sessionName: record.sessionName,
    agentProvider: record.agent as AgentProvider,
    model: record.model,
    reasoningEffort: normalizeProviderReasoningEffort(record.agent, record.reasoningEffort),
    threadId: normalizeNullableText(record.threadId),
    activeTurnId: normalizeNullableText(record.activeTurnId),
    runState: normalizeNullableText(record.runState) as SessionAgentRunState | null,
    lastError: normalizeNullableText(record.lastError),
    lastActivityAt: normalizeNullableText(record.lastActivityAt),
  };
}

function parseRuntimeFile(value: string): SessionAgentRuntimeState | null {
  try {
    const parsed = JSON.parse(value) as Partial<SessionAgentRuntimeState> | null;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const sessionName = normalizeOptionalText(parsed.sessionName);
    const agentProvider = normalizeOptionalText(parsed.agentProvider);
    const model = normalizeOptionalText(parsed.model);
    if (!sessionName || !agentProvider || !model) {
      return null;
    }

    return {
      sessionName,
      agentProvider: agentProvider as AgentProvider,
      model,
      reasoningEffort: normalizeProviderReasoningEffort(agentProvider, parsed.reasoningEffort ?? null),
      threadId: normalizeNullableText(parsed.threadId),
      activeTurnId: normalizeNullableText(parsed.activeTurnId),
      runState: normalizeNullableText(parsed.runState) as SessionAgentRunState | null,
      lastError: normalizeNullableText(parsed.lastError),
      lastActivityAt: normalizeNullableText(parsed.lastActivityAt),
    };
  } catch {
    return null;
  }
}

function loadRuntimeFromDisk(paths: SessionHotStorePaths): SessionAgentRuntimeState | null {
  try {
    return parseRuntimeFile(fs.readFileSync(paths.runtimePath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[session-hot-store] Failed to parse runtime snapshot, ignoring file.', error);
    }
    return null;
  }
}

function parseSnapshotFile(value: string): PersistedHistoryRecord[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry): entry is PersistedHistoryRecord => Boolean(entry) && typeof entry === 'object')
      .map((entry) => ({
        sessionName: normalizeOptionalText(entry.sessionName) ?? '',
        itemId: normalizeOptionalText(entry.itemId) ?? '',
        threadId: normalizeNullableText(entry.threadId),
        turnId: normalizeNullableText(entry.turnId),
        ordinal: typeof entry.ordinal === 'number' && Number.isFinite(entry.ordinal)
          ? Math.max(0, Math.floor(entry.ordinal))
          : 0,
        kind: normalizeOptionalText(entry.kind) ?? '',
        status: normalizeNullableText(entry.status),
        payloadJson: typeof entry.payloadJson === 'string' ? entry.payloadJson : '',
        createdAt: normalizeOptionalText(entry.createdAt) ?? new Date(0).toISOString(),
        updatedAt: normalizeOptionalText(entry.updatedAt) ?? new Date(0).toISOString(),
      }))
      .filter((entry) => Boolean(entry.sessionName && entry.itemId && entry.kind && entry.payloadJson));
  } catch {
    return [];
  }
}

function loadHistoryFromDisk(paths: SessionHotStorePaths): {
  historyById: Map<string, PersistedHistoryRecord>;
  walRecordCount: number;
  walBytes: number;
} {
  const historyById = new Map<string, PersistedHistoryRecord>();
  let walRecordCount = 0;
  let walBytes = 0;

  try {
    const snapshotRaw = fs.readFileSync(paths.snapshotPath, 'utf8');
    for (const entry of parseSnapshotFile(snapshotRaw)) {
      historyById.set(entry.itemId, entry);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[session-hot-store] Failed to parse history snapshot, ignoring file.', error);
    }
  }

  try {
    const walRaw = fs.readFileSync(paths.walPath, 'utf8');
    walBytes = Buffer.byteLength(walRaw);
    for (const line of walRaw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed) as PersistedHistoryRecord | null;
        if (
          !parsed
          || typeof parsed !== 'object'
          || !normalizeOptionalText(parsed.sessionName)
          || !normalizeOptionalText(parsed.itemId)
        ) {
          continue;
        }
        const entry = {
          sessionName: normalizeOptionalText(parsed.sessionName) ?? '',
          itemId: normalizeOptionalText(parsed.itemId) ?? '',
          threadId: normalizeNullableText(parsed.threadId),
          turnId: normalizeNullableText(parsed.turnId),
          ordinal: typeof parsed.ordinal === 'number' && Number.isFinite(parsed.ordinal)
            ? Math.max(0, Math.floor(parsed.ordinal))
            : 0,
          kind: normalizeOptionalText(parsed.kind) ?? '',
          status: normalizeNullableText(parsed.status),
          payloadJson: typeof parsed.payloadJson === 'string' ? parsed.payloadJson : '',
          createdAt: normalizeOptionalText(parsed.createdAt) ?? new Date(0).toISOString(),
          updatedAt: normalizeOptionalText(parsed.updatedAt) ?? new Date(0).toISOString(),
        } satisfies PersistedHistoryRecord;
        if (entry.kind && entry.payloadJson) {
          historyById.set(entry.itemId, entry);
          walRecordCount += 1;
        }
      } catch {
        // Ignore malformed WAL lines so a single bad entry does not poison the session.
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[session-hot-store] Failed to parse history WAL, ignoring file.', error);
    }
  }

  return { historyById, walRecordCount, walBytes };
}

function installProcessHooks(): void {
  if (processHooksInstalled) {
    return;
  }
  processHooksInstalled = true;

  const flushAll = () => {
    for (const sessionName of sessionCaches.keys()) {
      flush(sessionName);
    }
  };

  process.on('beforeExit', flushAll);
  process.on('SIGINT', flushAll);
  process.on('SIGTERM', flushAll);
}

function getOrLoadCache(sessionName: string): SessionHotStoreCache {
  const normalizedSessionName = normalizeSessionName(sessionName);
  if (!normalizedSessionName) {
    throw new Error('sessionName is required.');
  }

  installProcessHooks();

  const existing = sessionCaches.get(normalizedSessionName);
  if (existing?.loaded) {
    return existing;
  }

  const cache = existing ?? {
    sessionName: normalizedSessionName,
    loaded: false,
    migrationAttempted: false,
    runtime: null,
    historyById: new Map<string, PersistedHistoryRecord>(),
    dirtyRuntime: false,
    rewriteSnapshotOnFlush: false,
    pendingWalRecords: [],
    walRecordCount: 0,
    walBytes: 0,
    flushTimer: null,
  };
  sessionCaches.set(normalizedSessionName, cache);

  const paths = getSessionHotStorePaths(normalizedSessionName);
  const runtime = loadRuntimeFromDisk(paths);

  const { historyById, walRecordCount, walBytes } = loadHistoryFromDisk(paths);

  cache.runtime = runtime;
  cache.historyById = historyById;
  cache.walRecordCount = walRecordCount;
  cache.walBytes = walBytes;
  cache.loaded = true;

  maybeMigrateFromLegacy(cache);
  return cache;
}

function maybeMigrateFromLegacy(cache: SessionHotStoreCache): void {
  if (cache.migrationAttempted) {
    return;
  }
  cache.migrationAttempted = true;

  if (cache.runtime || cache.historyById.size > 0) {
    return;
  }

  const legacyState = readLocalState();
  const legacySession = legacyState.sessions[cache.sessionName];
  const legacyHistory = Object.values(legacyState.sessionAgentHistoryItems[cache.sessionName] ?? {});
  if (!legacySession && legacyHistory.length === 0) {
    return;
  }

  if (legacySession) {
    cache.runtime = toLegacyRuntime(legacySession);
    cache.dirtyRuntime = true;
  }

  if (legacyHistory.length > 0) {
    cache.historyById = new Map(
      legacyHistory.map((entry) => {
        const persisted = toPersistedHistoryRecord(entry);
        return [persisted.itemId, persisted] as const;
      }),
    );
    cache.rewriteSnapshotOnFlush = true;
    cache.pendingWalRecords = [];
    cache.walRecordCount = 0;
    cache.walBytes = 0;
  }

  flush(cache.sessionName);

  if (legacySession || legacyHistory.length > 0) {
    updateLocalState((state) => {
      const session = state.sessions[cache.sessionName];
      if (session) {
        session.threadId = null;
        session.activeTurnId = null;
        session.runState = null;
        session.lastError = null;
        session.lastActivityAt = null;
      }
      delete state.sessionAgentHistoryItems[cache.sessionName];
    });
  }
}

function scheduleFlush(sessionName: string): void {
  const cache = getOrLoadCache(sessionName);
  if (cache.flushTimer) {
    return;
  }
  cache.flushTimer = setTimeout(() => {
    cache.flushTimer = null;
    flush(sessionName);
  }, FLUSH_DEBOUNCE_MS);
}

function writeRuntime(cache: SessionHotStoreCache, paths: SessionHotStorePaths): void {
  if (!cache.runtime) {
    try {
      fs.rmSync(paths.runtimePath, { force: true });
    } catch {
      // Ignore cleanup errors.
    }
    cache.dirtyRuntime = false;
    return;
  }

  ensureSessionStateDir(paths);
  writeFileAtomic(paths.runtimePath, JSON.stringify(cache.runtime));
  cache.dirtyRuntime = false;
}

function writeSnapshot(cache: SessionHotStoreCache, paths: SessionHotStorePaths): void {
  ensureSessionStateDir(paths);
  const snapshot = [...cache.historyById.values()]
    .sort((left, right) => (
      left.ordinal - right.ordinal
      || left.createdAt.localeCompare(right.createdAt)
      || left.itemId.localeCompare(right.itemId)
    ));
  writeFileAtomic(paths.snapshotPath, JSON.stringify(snapshot));
  writeFileAtomic(paths.walPath, '');
  cache.pendingWalRecords = [];
  cache.walRecordCount = 0;
  cache.walBytes = 0;
  cache.rewriteSnapshotOnFlush = false;
}

function appendWal(cache: SessionHotStoreCache, paths: SessionHotStorePaths): void {
  if (cache.pendingWalRecords.length === 0) {
    return;
  }

  ensureSessionStateDir(paths);
  const lines = cache.pendingWalRecords.map((entry) => JSON.stringify(entry)).join('\n');
  const payload = `${lines}\n`;
  fs.appendFileSync(paths.walPath, payload, 'utf8');
  cache.walRecordCount += cache.pendingWalRecords.length;
  cache.walBytes += Buffer.byteLength(payload);
  cache.pendingWalRecords = [];
}

export function flush(sessionName: string): void {
  const cache = getOrLoadCache(sessionName);
  if (cache.flushTimer) {
    clearTimeout(cache.flushTimer);
    cache.flushTimer = null;
  }

  if (!cache.dirtyRuntime && !cache.rewriteSnapshotOnFlush && cache.pendingWalRecords.length === 0) {
    return;
  }

  const paths = getSessionHotStorePaths(sessionName);
  if (cache.dirtyRuntime) {
    writeRuntime(cache, paths);
  }

  if (cache.rewriteSnapshotOnFlush) {
    writeSnapshot(cache, paths);
    return;
  }

  appendWal(cache, paths);
  if (
    cache.walRecordCount >= HISTORY_WAL_COMPACT_MAX_RECORDS
    || cache.walBytes >= HISTORY_WAL_COMPACT_MAX_BYTES
  ) {
    compact(sessionName);
  }
}

export function compact(sessionName: string): void {
  const cache = getOrLoadCache(sessionName);
  cache.rewriteSnapshotOnFlush = true;
  flush(sessionName);
}

export function readRuntime(sessionName: string): SessionAgentRuntimeState | null {
  const cache = getOrLoadCache(sessionName);
  if (cache.dirtyRuntime) {
    return cache.runtime;
  }

  cache.runtime = loadRuntimeFromDisk(getSessionHotStorePaths(cache.sessionName));
  return cache.runtime;
}

export function readHistory(
  sessionName: string,
  query: SessionHotStoreHistoryQuery = {},
): SessionHotStoreHistoryPage {
  const cache = getOrLoadCache(sessionName);
  const threadId = normalizeOptionalText(query.threadId);
  const turnId = normalizeOptionalText(query.turnId);
  const beforeOrdinal = typeof query.beforeOrdinal === 'number' && Number.isFinite(query.beforeOrdinal)
    ? Math.max(0, Math.floor(query.beforeOrdinal))
    : undefined;
  const limit = typeof query.limit === 'number' && Number.isFinite(query.limit) && query.limit > 0
    ? Math.floor(query.limit)
    : undefined;

  let rows = [...cache.historyById.values()]
    .map((entry) => toHistoryRow(entry))
    .filter((row) => (!threadId || row.thread_id === threadId) && (!turnId || row.turn_id === turnId))
    .sort((left, right) => (
      (left.ordinal ?? 0) - (right.ordinal ?? 0)
      || left.created_at.localeCompare(right.created_at)
      || left.item_id.localeCompare(right.item_id)
    ));

  if (beforeOrdinal !== undefined) {
    rows = rows.filter((row) => (row.ordinal ?? 0) < beforeOrdinal);
  }

  let selectedRows = rows;
  if (limit !== undefined) {
    selectedRows = rows.slice(Math.max(0, rows.length - limit));
  }

  const oldestLoadedOrdinal = selectedRows.length > 0 ? (selectedRows[0]?.ordinal ?? 0) : null;
  return {
    history: sortSessionHistoryForTimeline(selectedRows
      .map((row) => toHistoryItem(row))
      .filter((item): item is SessionAgentHistoryItem => Boolean(item))),
    hasOlder: oldestLoadedOrdinal !== null
      ? rows.some((row) => (row.ordinal ?? 0) < oldestLoadedOrdinal)
      : false,
    oldestLoadedOrdinal,
  };
}

export function queueRuntimePatch(
  sessionName: string,
  updates: SessionHotStoreRuntimePatch,
): SessionAgentRuntimeState | null {
  const cache = getOrLoadCache(sessionName);
  if (!cache.runtime) {
    return null;
  }
  if (Object.keys(updates).length === 0) {
    return cache.runtime;
  }

  const nextAgentProvider = normalizeOptionalText(updates.agentProvider) ?? cache.runtime.agentProvider;
  const nextModel = normalizeOptionalText(updates.model) ?? cache.runtime.model;
  cache.runtime = {
    ...cache.runtime,
    agentProvider: nextAgentProvider as AgentProvider,
    model: nextModel,
    reasoningEffort: updates.reasoningEffort === undefined
      ? cache.runtime.reasoningEffort
      : normalizeProviderReasoningEffort(nextAgentProvider, updates.reasoningEffort),
    threadId: updates.threadId === undefined ? cache.runtime.threadId : normalizeNullableText(updates.threadId),
    activeTurnId: updates.activeTurnId === undefined
      ? cache.runtime.activeTurnId
      : normalizeNullableText(updates.activeTurnId),
    runState: updates.runState === undefined
      ? cache.runtime.runState
      : (normalizeNullableText(updates.runState) as SessionAgentRunState | null),
    lastError: updates.lastError === undefined ? cache.runtime.lastError : normalizeNullableText(updates.lastError),
    lastActivityAt: updates.lastActivityAt === undefined
      ? cache.runtime.lastActivityAt
      : normalizeNullableText(updates.lastActivityAt),
  };
  cache.dirtyRuntime = true;
  scheduleFlush(sessionName);
  return cache.runtime;
}

export function queueHistoryUpserts(
  sessionName: string,
  entries: SessionAgentHistoryInput[],
): void {
  const cache = getOrLoadCache(sessionName);
  const normalizedEntries = entries
    .map((entry) => normalizeHistoryWrite(entry))
    .filter((entry): entry is NormalizedHistoryWrite => Boolean(entry));

  if (normalizedEntries.length === 0) {
    return;
  }

  for (const write of normalizedEntries) {
    const existing = cache.historyById.get(write.itemId) ?? null;
    const nextRecord = createPersistedHistoryRecord(sessionName, write, existing);
    cache.historyById.set(write.itemId, nextRecord);
    cache.pendingWalRecords.push(nextRecord);
  }

  scheduleFlush(sessionName);
}

export function replaceHistory(
  sessionName: string,
  entries: SessionAgentHistoryInput[],
): void {
  const cache = getOrLoadCache(sessionName);
  const normalizedEntries = entries
    .map((entry) => normalizeHistoryWrite(entry))
    .filter((entry): entry is NormalizedHistoryWrite => Boolean(entry));
  const nextHistory = new Map<string, PersistedHistoryRecord>();
  for (const write of normalizedEntries) {
    nextHistory.set(write.itemId, createPersistedHistoryRecord(sessionName, write));
  }

  cache.historyById = nextHistory;
  cache.pendingWalRecords = [];
  cache.rewriteSnapshotOnFlush = true;
  scheduleFlush(sessionName);
}

export function clearHistory(sessionName: string): void {
  const cache = getOrLoadCache(sessionName);
  cache.historyById = new Map();
  cache.pendingWalRecords = [];
  cache.rewriteSnapshotOnFlush = true;
  scheduleFlush(sessionName);
}

export function getNextHistoryOrdinal(sessionName: string): number {
  const cache = getOrLoadCache(sessionName);
  let maxOrdinal = -1;
  for (const record of cache.historyById.values()) {
    maxOrdinal = Math.max(maxOrdinal, record.ordinal);
  }
  return maxOrdinal + 1;
}

export function migrateFromLegacy(sessionName: string): void {
  maybeMigrateFromLegacy(getOrLoadCache(sessionName));
}

export function deleteSessionState(sessionName: string): void {
  const normalizedSessionName = normalizeSessionName(sessionName);
  const cache = sessionCaches.get(normalizedSessionName);
  if (cache?.flushTimer) {
    clearTimeout(cache.flushTimer);
  }
  sessionCaches.delete(normalizedSessionName);

  const paths = getSessionHotStorePaths(normalizedSessionName);
  try {
    fs.rmSync(paths.sessionDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors.
  }
}

export function getSessionHotStorePathsForTests(sessionName: string): SessionHotStorePaths {
  return getSessionHotStorePaths(sessionName);
}

export function resetSessionHotStoreForTests(): void {
  for (const cache of sessionCaches.values()) {
    if (cache.flushTimer) {
      clearTimeout(cache.flushTimer);
    }
  }
  sessionCaches.clear();
}
