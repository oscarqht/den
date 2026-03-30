import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveClientProjectReference,
  resolveClientRecentProjects,
  getClientProjectCompatibilityKeys,
} from './project-client.ts';

describe('project-client compatibility keys', () => {
  it('includes both project id and folder paths', () => {
    const compatibilityKeys = getClientProjectCompatibilityKeys({
      id: 'project-123',
      name: 'Test Project',
      folderPaths: ['/tmp/test-project'],
    });

    assert.deepEqual(compatibilityKeys, ['project-123', '/tmp/test-project']);
  });
});

describe('project-client recent project resolution', () => {
  it('deduplicates recent project references by canonical key', () => {
    const resolved = resolveClientRecentProjects([{
      id: 'project-123',
      name: 'Test Project',
      folderPaths: ['/tmp/test-project'],
    }], ['project-123', '/tmp/test-project']);

    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]?.key, 'project-123');
  });
});

describe('project-client reference resolution', () => {
  it('keeps folderless projects openable by session reference while reporting no associated folders', () => {
    const resolved = resolveClientProjectReference([{
      id: 'project-123',
      name: 'Metadata Only',
      folderPaths: [],
    }], 'project-123');

    assert.equal(resolved.project?.id, 'project-123');
    assert.equal(resolved.primaryPath, null);
    assert.equal(resolved.sessionReference, 'project-123');
    assert.equal(resolved.hasAssociatedFolders, false);
    assert.equal(resolved.isOpenable, true);
    assert.equal(resolved.secondaryLabel, 'No folders associated');
  });

  it('prefers the newest matching project when duplicate folder paths exist', () => {
    const duplicatePath = '/tmp/test-project';
    const resolved = resolveClientProjectReference([
      {
        id: 'project-older',
        name: 'Older Project',
        folderPaths: [duplicatePath],
        lastOpenedAt: '2026-03-27T05:10:16.473Z',
      },
      {
        id: 'project-newer',
        name: 'Newer Project',
        folderPaths: [duplicatePath],
        iconPath: '/tmp/icon.png',
        lastOpenedAt: '2026-03-27T09:57:17.978Z',
      },
    ], duplicatePath);

    assert.equal(resolved.project?.id, 'project-newer');
    assert.equal(resolved.key, 'project-newer');
    assert.equal(resolved.displayName, 'Newer Project');
  });
});
