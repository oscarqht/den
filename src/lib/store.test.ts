import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type StoreModule = typeof import('./store.ts');
type LocalDbModule = typeof import('./local-db.ts');

let tempHome = '';
let previousHome = '';
let previousUserProfile = '';
let storeModule: StoreModule;
let localDbModule: LocalDbModule;

before(async () => {
  tempHome = await mkdtemp(path.join(os.tmpdir(), 'palx-store-test-'));
  previousHome = process.env.HOME || '';
  previousUserProfile = process.env.USERPROFILE || '';
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  storeModule = await import('./store.ts');
  localDbModule = await import('./local-db.ts');
});

beforeEach(() => {
  const db = localDbModule.getLocalDb();
  db.prepare('DELETE FROM project_entity_folders').run();
  db.prepare('DELETE FROM project_entities').run();
});

after(async () => {
  process.env.HOME = previousHome;
  process.env.USERPROFILE = previousUserProfile;
  if (tempHome) {
    await rm(tempHome, { recursive: true, force: true });
  }
});

describe('resolveProjectStorageScope', () => {
  it('returns both project id and folder paths when resolving a project path', () => {
    const projectPath = path.join(tempHome, 'workspace', 'palx');
    const project = storeModule.addProject({
      name: 'palx',
      folderPaths: [projectPath],
    });

    assert.deepEqual(storeModule.resolveProjectStorageScope(projectPath), {
      projectId: project.id,
      folderPaths: [projectPath],
    });
  });

  it('returns both project id and folder paths when resolving a project id', () => {
    const projectPath = path.join(tempHome, 'workspace', 'palx');
    const project = storeModule.addProject({
      name: 'palx',
      folderPaths: [projectPath],
    });

    assert.deepEqual(storeModule.resolveProjectStorageScope(project.id), {
      projectId: project.id,
      folderPaths: [projectPath],
    });
  });

  it('falls back to a raw folder-path filter for standalone paths', () => {
    const standalonePath = path.join(tempHome, 'workspace', 'standalone');

    assert.deepEqual(storeModule.resolveProjectStorageScope(standalonePath), {
      projectId: null,
      folderPaths: [standalonePath],
    });
  });
});
