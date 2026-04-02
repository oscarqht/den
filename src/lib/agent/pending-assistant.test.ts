import assert from 'node:assert';
import { describe, it } from 'node:test';

import { buildPendingAssistantItem, getPendingAssistantLabel } from './pending-assistant.ts';
import type { SessionAgentHistoryItem, SessionAgentRuntimeState } from '@/lib/types';

function createUserHistoryItem(overrides: Partial<SessionAgentHistoryItem> = {}): SessionAgentHistoryItem {
  return {
    kind: 'user',
    id: 'user-1',
    text: 'Ship it',
    sessionName: 'session-1',
    ordinal: 0,
    createdAt: '2026-04-02T00:00:00.000Z',
    updatedAt: '2026-04-02T00:00:00.000Z',
    itemStatus: null,
    ...overrides,
  };
}

function createRuntime(overrides: Partial<SessionAgentRuntimeState> = {}): SessionAgentRuntimeState {
  return {
    sessionName: 'session-1',
    agentProvider: 'codex',
    model: 'gpt-5.4',
    runState: 'queued',
    threadId: null,
    activeTurnId: null,
    lastActivityAt: '2026-04-02T00:00:01.000Z',
    turnDiagnostics: null,
    ...overrides,
  };
}

describe('pending assistant helpers', () => {
  it('maps diagnostic steps to user-facing pending copy', () => {
    assert.equal(getPendingAssistantLabel(createRuntime({
      turnDiagnostics: {
        transport: 'codex',
        runState: 'queued',
        queuedAt: '2026-04-02T00:00:00.000Z',
        updatedAt: '2026-04-02T00:00:00.000Z',
        currentStepKey: 'restore_thread',
        steps: [],
      },
    })), 'Resuming thread');
    assert.equal(getPendingAssistantLabel(createRuntime({ runState: 'running' })), 'Thinking');
  });

  it('creates a synthetic assistant item while a turn is active and silent', () => {
    const item = buildPendingAssistantItem('session-1', createRuntime(), [
      createUserHistoryItem(),
    ]);

    assert.ok(item);
    assert.equal(item?.kind, 'assistant');
    assert.equal(item?.itemStatus, 'pending');
    assert.equal(item?.text, 'Launching Codex runtime');
  });

  it('hides the synthetic assistant item once real agent activity appears', () => {
    const item = buildPendingAssistantItem('session-1', createRuntime(), [
      createUserHistoryItem(),
      {
        kind: 'tool',
        id: 'tool-1',
        source: 'function',
        server: null,
        tool: 'update_plan',
        status: 'requested',
        input: '{}',
        message: null,
        result: null,
        error: null,
        sessionName: 'session-1',
        ordinal: 1,
        createdAt: '2026-04-02T00:00:02.000Z',
        updatedAt: '2026-04-02T00:00:02.000Z',
        itemStatus: null,
      },
    ]);

    assert.equal(item, null);
  });
});
