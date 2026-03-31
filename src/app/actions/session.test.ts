import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  deleteSessionWithDependencies,
  type DeleteSessionDependencies,
  type SessionMetadata,
} from './session.ts';

function createSessionMetadata(): SessionMetadata {
  return {
    sessionName: 'session-1',
    projectId: 'project-1',
    projectPath: '/tmp/project',
    workspacePath: '/tmp/project/session-1',
    workspaceFolders: [],
    workspaceMode: 'single_worktree',
    activeRepoPath: '/tmp/project',
    gitRepos: [{
      sourceRepoPath: '/tmp/project',
      relativeRepoPath: '.',
      worktreePath: '/tmp/project/.worktrees/session-1',
      branchName: 'palx/session-1',
      baseBranch: 'main',
    }],
    agent: 'codex',
    agentProvider: 'codex',
    model: 'gpt-5.4',
    timestamp: '2026-03-30T00:00:00.000Z',
  };
}

function createDeleteDeps(overrides: Partial<DeleteSessionDependencies> = {}) {
  const deletedSessions: string[] = [];
  const promptDirs: string[] = [];
  const removeWorktreeCalls: string[] = [];
  let cleanupCalled = false;
  let published = false;

  const deps: DeleteSessionDependencies = {
    getSessionMetadata: async () => createSessionMetadata(),
    shutdownSessionOwnedProcesses: async () => ({
      success: true,
      failures: [],
      runtime: {
        success: true,
        wasRunning: false,
        runtimePid: null,
        failures: [],
        lingeringSubprocesses: [],
        runtimeStillAlive: false,
      },
      trackedProcesses: {
        success: true,
        stopped: [],
        failures: [],
      },
      terminals: {
        success: true,
        terminatedSessions: [],
        lingeringSessions: [],
      },
    }),
    removeWorktree: async (_repoPath, _worktreePath, branchName) => {
      removeWorktreeCalls.push(branchName);
      return { success: true };
    },
    cleanupSessionWorkspace: async () => {
      cleanupCalled = true;
    },
    deleteSessionState: (value: string) => {
      deletedSessions.push(value);
    },
    getSessionPromptsDir: async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'palx-session-delete-prompts-'));
      promptDirs.push(dir);
      cleanupPromptDirs.add(dir);
      return dir;
    },
    publishSessionListUpdated: async () => {
      published = true;
      return 1;
    },
    ...overrides,
  };

  return {
    deps,
    deletedSessions,
    promptDirs,
    removeWorktreeCalls,
    get cleanupCalled() {
      return cleanupCalled;
    },
    get published() {
      return published;
    },
  };
}

const cleanupPromptDirs = new Set<string>();

after(async () => {
  for (const dir of cleanupPromptDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  cleanupPromptDirs.clear();
});

describe('deleteSessionWithDependencies', () => {
  it('waits for process shutdown before cleanup starts', async () => {
    const order: string[] = [];
    let releaseShutdown!: () => void;
    const shutdownGate = new Promise<void>((resolve) => {
      releaseShutdown = resolve;
    });
    const harness = createDeleteDeps({
      shutdownSessionOwnedProcesses: async () => {
        order.push('shutdown-start');
        await shutdownGate;
        order.push('shutdown-end');
        return {
          success: true,
          failures: [],
          runtime: {
            success: true,
            wasRunning: true,
            runtimePid: 123,
            failures: [],
            lingeringSubprocesses: [],
            runtimeStillAlive: false,
          },
          trackedProcesses: {
            success: true,
            stopped: [],
            failures: [],
          },
          terminals: {
            success: true,
            terminatedSessions: [],
            lingeringSessions: [],
          },
        };
      },
      removeWorktree: async (...args) => {
        order.push('remove-worktree');
        return { success: true };
      },
      cleanupSessionWorkspace: async () => {
        order.push('cleanup-workspace');
      },
      publishSessionListUpdated: async () => {
        order.push('publish');
        return 1;
      },
    });

    const deletion = deleteSessionWithDependencies('session-1', harness.deps);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(order, ['shutdown-start']);

    releaseShutdown();
    const result = await deletion;

    assert.equal(result.success, true);
    assert.deepEqual(order, ['shutdown-start', 'shutdown-end', 'remove-worktree', 'cleanup-workspace', 'publish']);
  });

  it('aborts deletion and preserves session artifacts when shutdown fails', async () => {
    const harness = createDeleteDeps({
      shutdownSessionOwnedProcesses: async () => ({
        success: false,
        failures: ['Agent runtime process 200 is still alive.'],
        runtime: {
          success: false,
          wasRunning: true,
          runtimePid: 200,
          failures: [{
            scope: 'runtime',
            pid: 200,
            message: 'Agent runtime process 200 is still alive.',
          }],
          lingeringSubprocesses: [],
          runtimeStillAlive: true,
        },
        trackedProcesses: {
          success: true,
          stopped: [],
          failures: [],
        },
        terminals: {
          success: true,
          terminatedSessions: [],
          lingeringSessions: [],
        },
      }),
    });

    const promptsDir = await harness.deps.getSessionPromptsDir();
    cleanupPromptDirs.add(promptsDir);
    const promptPath = path.join(promptsDir, 'session-1.txt');
    await writeFile(promptPath, 'keep me', 'utf8');

    const result = await deleteSessionWithDependencies('session-1', {
      ...harness.deps,
      getSessionPromptsDir: async () => promptsDir,
    });

    assert.equal(result.success, false);
    assert.match(result.error || '', /still alive/);
    assert.deepEqual(harness.removeWorktreeCalls, []);
    assert.equal(harness.cleanupCalled, false);
    assert.deepEqual(harness.deletedSessions, []);
    await access(promptPath);
  });
});
