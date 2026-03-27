import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { countHomeProjectSessionsByProject } from './home-project-activity.ts';

describe('home project activity', () => {
  it('counts every session row by resolved project key', () => {
    const counts = countHomeProjectSessionsByProject(
      [
        { projectId: 'project-1', projectPath: '/tmp/project-1' },
        { projectPath: '/tmp/project-1' },
        { repoPath: '/tmp/project-2' },
        { projectId: 'project-1' },
        { projectPath: '/tmp/project-3' },
      ],
      (session) => session.projectId || session.projectPath || session.repoPath || '',
    );

    assert.equal(counts.get('project-1'), 2);
    assert.equal(counts.get('/tmp/project-1'), 1);
    assert.equal(counts.get('/tmp/project-2'), 1);
    assert.equal(counts.get('/tmp/project-3'), 1);
  });
});
