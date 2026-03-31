import assert from 'node:assert/strict';
import test from 'node:test';
import type { SessionMetadata } from '../app/actions/session.ts';
import type { Project } from './types.ts';
import { groupHomeProjectSessionsByProject } from './home-project-sessions.ts';

function createSession(overrides: Partial<SessionMetadata> & Pick<SessionMetadata, 'sessionName'>): SessionMetadata {
  return {
    sessionName: overrides.sessionName,
    projectPath: overrides.projectPath ?? '',
    workspacePath: overrides.workspacePath ?? `/tmp/${overrides.sessionName}`,
    workspaceFolders: overrides.workspaceFolders ?? [],
    workspaceMode: overrides.workspaceMode ?? 'folder',
    gitRepos: overrides.gitRepos ?? [],
    agent: overrides.agent ?? 'codex',
    model: overrides.model ?? 'gpt-5',
    timestamp: overrides.timestamp ?? '2026-03-31T00:00:00.000Z',
    ...overrides,
  };
}

test('groups sessions by canonical project key while preserving input order', () => {
  const projects: Project[] = [{
    id: 'project-1',
    name: 'Project 1',
    folderPaths: ['/workspace/project-1', '/workspace/project-1-alt'],
  }];
  const sessions: SessionMetadata[] = [
    createSession({
      sessionName: 'session-2',
      projectId: 'project-1',
      projectPath: '/workspace/project-1',
      timestamp: '2026-03-31T09:30:00.000Z',
    }),
    createSession({
      sessionName: 'session-1',
      projectPath: '/workspace/project-1-alt',
      repoPath: '/workspace/project-1-alt',
      timestamp: '2026-03-31T09:00:00.000Z',
    }),
  ];

  const grouped = groupHomeProjectSessionsByProject(projects, sessions);

  assert.deepEqual(
    grouped.get('project-1')?.map((session) => session.sessionName),
    ['session-2', 'session-1'],
  );
});

test('falls back to the session path when project metadata is unavailable', () => {
  const grouped = groupHomeProjectSessionsByProject([], [
    createSession({
      sessionName: 'orphaned-session',
      projectPath: '/workspace/missing-project',
      repoPath: '/workspace/missing-project',
    }),
  ]);

  assert.deepEqual(
    grouped.get('/workspace/missing-project')?.map((session) => session.sessionName),
    ['orphaned-session'],
  );
});
