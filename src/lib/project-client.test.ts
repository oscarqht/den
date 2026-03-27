import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createClientProjectCompatibilityMap,
  resolveClientProjectReference,
  resolveClientProjectActivityKey,
  resolveClientRecentProjects,
} from './project-client.ts';

describe('project-client activity key resolution', () => {
  it('prefers the current recent-project key over stale ids and duplicate folder matches', () => {
    const projects = [
      {
        id: 'a7d8e866-b25f-4666-beaf-306c2320ae7f',
        name: 'AI / Frontend',
        folderPaths: ['/Users/tangqh/Downloads/projects/intelligence/intelligence-frontend'],
      },
      {
        id: 'd3b9338a-c163-4b13-87e6-5e74d8604e1d',
        name: 'AI / Frontend',
        folderPaths: ['/Users/tangqh/Downloads/projects/intelligence/intelligence-frontend'],
      },
    ];
    const preferredKeys = createClientProjectCompatibilityMap(
      resolveClientRecentProjects(projects, ['d3b9338a-c163-4b13-87e6-5e74d8604e1d']),
    );

    const projectKey = resolveClientProjectActivityKey(projects, {
      projectId: '72dfd508-ffbc-4839-8fdc-97f89f1aff87',
      projectPath: '/Users/tangqh/Downloads/projects/intelligence/intelligence-frontend',
      repoPath: '/Users/tangqh/Downloads/projects/intelligence/intelligence-frontend',
    }, preferredKeys);

    assert.equal(projectKey, 'd3b9338a-c163-4b13-87e6-5e74d8604e1d');
  });

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
});
