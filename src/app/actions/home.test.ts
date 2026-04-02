import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type HomeModule = typeof import('./home.ts');
type ConfigModule = typeof import('./config.ts');
type StoreModule = typeof import('../../lib/store.ts');

let tempHome = '';
let previousHome = '';
let previousUserProfile = '';
let homeModule: HomeModule;
let configModule: ConfigModule;
let storeModule: StoreModule;

before(async () => {
  tempHome = await mkdtemp(path.join(os.tmpdir(), 'palx-home-bootstrap-test-'));
  previousHome = process.env.HOME || '';
  previousUserProfile = process.env.USERPROFILE || '';
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  homeModule = await import('./home.ts');
  configModule = await import('./config.ts');
  storeModule = await import('../../lib/store.ts');
});

after(async () => {
  process.env.HOME = previousHome;
  process.env.USERPROFILE = previousUserProfile;
  if (tempHome) {
    await rm(tempHome, { recursive: true, force: true });
  }
});

describe('getHomeDashboardBootstrap', () => {
  it('returns projects and config from the same state snapshot', async () => {
    const projectRoot = path.join(tempHome, 'workspace', 'alpha');
    const secondaryRoot = path.join(tempHome, 'workspace', 'beta');
    const alpha = storeModule.addProject({
      name: 'Alpha',
      folderPaths: [projectRoot],
      lastOpenedAt: '2026-04-02T09:00:00.000Z',
    });
    const beta = storeModule.addProject({
      name: 'Beta',
      folderPaths: [secondaryRoot],
      lastOpenedAt: '2026-04-02T10:00:00.000Z',
    });

    await configModule.updateProjectSettings(alpha.id, {
      serviceStartCommand: 'npm run dev',
    });
    await configModule.updateConfig({
      homeProjectSort: 'name',
      recentProjects: [beta.id, alpha.id],
    });

    const bootstrap = await homeModule.getHomeDashboardBootstrap();

    assert.deepEqual(
      bootstrap.projects.map((project) => project.id),
      [alpha.id, beta.id],
    );
    assert.equal(bootstrap.config.homeProjectSort, 'name');
    assert.deepEqual(bootstrap.config.recentProjects, [beta.id, alpha.id]);
    assert.equal(bootstrap.config.projectSettings[alpha.id]?.serviceStartCommand, 'npm run dev');
    assert.equal(bootstrap.config.projectSettings[projectRoot]?.serviceStartCommand, 'npm run dev');
  });
});
