import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { sessionRecordToMetadata } from './session-metadata.ts';

test('converts a stored session record into metadata with compatibility fields', () => {
  const metadata = sessionRecordToMetadata({
    sessionName: 'session-a',
    projectId: 'project-a',
    projectPath: '/workspace/project-a',
    workspacePath: '/workspace/.palx/session-a',
    workspaceFoldersJson: null,
    workspaceMode: 'single_worktree',
    activeRepoPath: '/workspace/project-a',
    repoPath: '/workspace/project-a',
    worktreePath: '/workspace/.palx/session-a',
    branchName: 'palx/session-a',
    baseBranch: 'main',
    agent: 'codex',
    model: 'gpt-5.4',
    reasoningEffort: 'medium',
    threadId: null,
    activeTurnId: null,
    runState: 'running',
    lastError: null,
    lastActivityAt: null,
    title: 'Session A',
    devServerScript: null,
    initialized: true,
    timestamp: '2026-04-02T10:00:00.000Z',
    gitRepos: [{
      sourceRepoPath: '/workspace/project-a',
      relativeRepoPath: '',
      worktreePath: '/workspace/.palx/session-a',
      branchName: 'palx/session-a',
      baseBranch: 'main',
      baseCommitId: 'abc1234',
    }],
  });

  assert.deepEqual(metadata.gitRepos, [{
    sourceRepoPath: '/workspace/project-a',
    relativeRepoPath: '',
    worktreePath: '/workspace/.palx/session-a',
    branchName: 'palx/session-a',
    baseBranch: 'main',
    baseCommitId: 'abc1234',
  }]);
  assert.equal(metadata.repoPath, '/workspace/project-a');
  assert.equal(metadata.worktreePath, '/workspace/.palx/session-a');
  assert.equal(metadata.branchName, 'palx/session-a');
  assert.equal(metadata.runState, 'running');
});

test('falls back to a direct workspace mapping for local-source sessions', () => {
  const metadata = sessionRecordToMetadata({
    sessionName: 'session-b',
    projectId: 'project-b',
    projectPath: '/workspace/project-b',
    workspacePath: '/workspace/project-b',
    workspaceFoldersJson: null,
    workspaceMode: 'local_source',
    activeRepoPath: '/workspace/project-b',
    repoPath: '/workspace/project-b',
    worktreePath: '/workspace/project-b',
    branchName: 'main',
    baseBranch: null,
    agent: 'codex',
    model: 'gpt-5.4',
    reasoningEffort: 'low',
    threadId: null,
    activeTurnId: null,
    runState: null,
    lastError: null,
    lastActivityAt: null,
    title: 'Session B',
    devServerScript: null,
    initialized: true,
    timestamp: '2026-04-02T09:00:00.000Z',
    gitRepos: [],
  });

  assert.deepEqual(metadata.workspaceFolders, [{
    sourcePath: path.resolve('/workspace/project-b'),
    workspaceRelativePath: '.',
    workspacePath: path.resolve('/workspace/project-b'),
    provisioning: 'direct',
  }]);
  assert.equal(metadata.worktreePath, '/workspace/project-b');
});
