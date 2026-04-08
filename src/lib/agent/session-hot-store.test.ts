import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { LocalSessionRecord } from '../local-db.ts';

type LocalDbModule = typeof import('../local-db.ts');
type HotStoreModule = typeof import('./session-hot-store.ts');

let tempHome = '';
let previousHome = '';
let previousUserProfile = '';
let localDbModule: LocalDbModule;
let hotStoreModule: HotStoreModule;

function createSessionRecord(): LocalSessionRecord {
  return {
    sessionName: 'session-1',
    projectId: 'project-1',
    projectPath: '/tmp/project',
    workspacePath: '/tmp/project/workspace',
    workspaceMode: 'folder',
    activeRepoPath: '/tmp/project',
    repoPath: '/tmp/project',
    worktreePath: '/tmp/project/workspace',
    branchName: 'main',
    baseBranch: 'main',
    agent: 'codex',
    model: 'gpt-5.4',
    reasoningEffort: 'medium',
    threadId: 'thread-1',
    activeTurnId: null,
    runState: 'running',
    lastError: null,
    lastActivityAt: '2026-04-06T10:00:00.000Z',
    title: 'Session',
    devServerScript: null,
    initialized: true,
    timestamp: '2026-04-06T09:59:00.000Z',
    gitRepos: [{
      sourceRepoPath: '/tmp/project',
      relativeRepoPath: '',
      worktreePath: '/tmp/project/workspace',
      branchName: 'main',
      baseBranch: 'main',
    }],
  };
}

async function readMaybeFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

before(async () => {
  tempHome = await mkdtemp(path.join(os.tmpdir(), 'den-session-hot-store-test-'));
  previousHome = process.env.HOME || '';
  previousUserProfile = process.env.USERPROFILE || '';
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  localDbModule = await import('../local-db.ts');
  hotStoreModule = await import('./session-hot-store.ts');
});

beforeEach(async () => {
  hotStoreModule.resetSessionHotStoreForTests();
  localDbModule.resetLocalStateForTests();
  await rm(path.join(tempHome, '.viba'), { recursive: true, force: true });
});

after(async () => {
  process.env.HOME = previousHome;
  process.env.USERPROFILE = previousUserProfile;
  hotStoreModule.resetSessionHotStoreForTests();
  localDbModule.resetLocalStateForTests();
  if (tempHome) {
    await rm(tempHome, { recursive: true, force: true });
  }
});

describe('session hot store', () => {
  it('debounces history writes into the per-session WAL', async () => {
    localDbModule.updateLocalState((state) => {
      state.sessions['session-1'] = createSessionRecord();
    });

    const runtime = hotStoreModule.readRuntime('session-1');
    assert.equal(runtime?.sessionName, 'session-1');

    hotStoreModule.queueHistoryUpserts('session-1', [{
      kind: 'user',
      id: 'user-1',
      text: 'hello',
      ordinal: 0,
      createdAt: '2026-04-06T10:00:00.000Z',
      updatedAt: '2026-04-06T10:00:00.000Z',
    }]);

    const paths = hotStoreModule.getSessionHotStorePathsForTests('session-1');
    assert.equal(await readMaybeFile(paths.walPath), '');

    await new Promise((resolve) => setTimeout(resolve, 320));

    const walContents = await readMaybeFile(paths.walPath);
    assert.match(walContents, /"itemId":"user-1"/);
  });

  it('compacts the WAL into a snapshot file', async () => {
    localDbModule.updateLocalState((state) => {
      state.sessions['session-1'] = createSessionRecord();
    });

    hotStoreModule.readRuntime('session-1');
    hotStoreModule.queueHistoryUpserts('session-1', [
      {
        kind: 'user',
        id: 'user-1',
        text: 'hello',
        ordinal: 0,
        createdAt: '2026-04-06T10:00:00.000Z',
        updatedAt: '2026-04-06T10:00:00.000Z',
      },
      {
        kind: 'assistant',
        id: 'assistant-1',
        text: 'world',
        phase: null,
        ordinal: 1,
        createdAt: '2026-04-06T10:00:01.000Z',
        updatedAt: '2026-04-06T10:00:01.000Z',
      },
    ]);
    hotStoreModule.flush('session-1');

    const paths = hotStoreModule.getSessionHotStorePathsForTests('session-1');
    assert.match(await readMaybeFile(paths.walPath), /"itemId":"assistant-1"/);

    hotStoreModule.compact('session-1');

    const snapshot = JSON.parse(await readFile(paths.snapshotPath, 'utf8')) as Array<{ itemId: string }>;
    assert.deepEqual(snapshot.map((entry) => entry.itemId), ['user-1', 'assistant-1']);
    assert.equal(await readMaybeFile(paths.walPath), '');
  });

  it('migrates legacy runtime and history on first access', async () => {
    localDbModule.updateLocalState((state) => {
      state.sessions['session-1'] = createSessionRecord();
      state.sessionAgentHistoryItems['session-1'] = {
        'user-1': {
          sessionName: 'session-1',
          itemId: 'user-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
          ordinal: 0,
          kind: 'user',
          status: null,
          payloadJson: JSON.stringify({
            kind: 'user',
            id: 'user-1',
            text: 'hello',
          }),
          createdAt: '2026-04-06T10:00:00.000Z',
          updatedAt: '2026-04-06T10:00:00.000Z',
        },
        'assistant-1': {
          sessionName: 'session-1',
          itemId: 'assistant-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
          ordinal: 1,
          kind: 'assistant',
          status: null,
          payloadJson: JSON.stringify({
            kind: 'assistant',
            id: 'assistant-1',
            text: 'world',
            phase: null,
          }),
          createdAt: '2026-04-06T10:00:01.000Z',
          updatedAt: '2026-04-06T10:00:01.000Z',
        },
      };
    });

    const runtime = hotStoreModule.readRuntime('session-1');
    const historyPage = hotStoreModule.readHistory('session-1');

    assert.equal(runtime?.threadId, 'thread-1');
    assert.equal(historyPage.history.length, 2);
    assert.equal(localDbModule.readLocalState().sessionAgentHistoryItems['session-1'], undefined);
    assert.equal(localDbModule.readLocalState().sessions['session-1']?.threadId ?? null, null);
    assert.equal(localDbModule.readLocalState().sessions['session-1']?.runState ?? null, null);

    const paths = hotStoreModule.getSessionHotStorePathsForTests('session-1');
    const snapshot = JSON.parse(await readFile(paths.snapshotPath, 'utf8')) as Array<{ itemId: string }>;
    assert.equal(snapshot.length, 2);
  });

  it('reloads runtime snapshots written by another process', async () => {
    localDbModule.updateLocalState((state) => {
      state.sessions['session-1'] = createSessionRecord();
    });

    const initialRuntime = hotStoreModule.readRuntime('session-1');
    assert.equal(initialRuntime?.runState, 'running');

    hotStoreModule.flush('session-1');
    const paths = hotStoreModule.getSessionHotStorePathsForTests('session-1');
    const nextRuntime = {
      ...initialRuntime,
      runState: 'completed',
      lastActivityAt: '2026-04-06T10:05:00.000Z',
    };
    await writeFile(paths.runtimePath, JSON.stringify(nextRuntime), 'utf8');

    const refreshedRuntime = hotStoreModule.readRuntime('session-1');
    assert.equal(refreshedRuntime?.runState, 'completed');
    assert.equal(refreshedRuntime?.lastActivityAt, '2026-04-06T10:05:00.000Z');
  });
});
