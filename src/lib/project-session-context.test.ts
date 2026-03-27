import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import {
  resolveProjectWorkspacePreference,
  resolveStoredProjectSessionContext,
} from './project-session-context.ts';

describe('project-session-context', () => {
  it('uses the user home directory for projects without associated folders', () => {
    const context = resolveStoredProjectSessionContext({
      id: 'project-123',
      folderPaths: [],
    });

    assert.equal(context.projectId, 'project-123');
    assert.equal(context.normalizedProjectPath, path.resolve(os.homedir()));
    assert.deepEqual(context.normalizedFolderPaths, []);
  });

  it('forces local workspace preference when no associated folders exist', () => {
    assert.equal(resolveProjectWorkspacePreference([], 'workspace'), 'local');
    assert.equal(resolveProjectWorkspacePreference([], 'local'), 'local');
    assert.equal(resolveProjectWorkspacePreference(['/tmp/project'], 'workspace'), 'workspace');
  });
});
