import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type ConfigModule = typeof import('./config.ts');
type ProjectServiceModule = typeof import('./project-service.ts');
type StoreModule = typeof import('../../lib/store.ts');

let tempHome = '';
let previousHome = '';
let previousUserProfile = '';
let configModule: ConfigModule;
let projectServiceModule: ProjectServiceModule;
let storeModule: StoreModule;

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for condition.');
}

before(async () => {
  tempHome = await mkdtemp(path.join(os.tmpdir(), 'palx-project-service-test-'));
  previousHome = process.env.HOME || '';
  previousUserProfile = process.env.USERPROFILE || '';
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  configModule = await import('./config.ts');
  projectServiceModule = await import('./project-service.ts');
  storeModule = await import('../../lib/store.ts');
});

after(async () => {
  process.env.HOME = previousHome;
  process.env.USERPROFILE = previousUserProfile;
  if (tempHome) {
    await rm(tempHome, { recursive: true, force: true });
  }
});

describe('project service manager', () => {
  it('starts, reports, logs, and stops a managed project service', async () => {
    const projectRoot = path.join(tempHome, 'service-project');
    await mkdir(projectRoot, { recursive: true });

    const project = storeModule.addProject({
      name: 'Service Project',
      folderPaths: [projectRoot],
    });

    await configModule.updateProjectSettings(project.id, {
      serviceStartCommand: 'node -e "console.log(\'service boot\'); setInterval(() => console.log(\'tick\'), 200)"',
      serviceStopCommand: 'node -e "console.log(\'service stop command\')"',
    });

    const startResult = await projectServiceModule.startProjectService(project.id);
    assert.equal(startResult.success, true);
    assert.equal(startResult.status?.running, true);

    await waitFor(async () => {
      const logResult = await projectServiceModule.getProjectServiceLog(project.id);
      return Boolean(logResult.output?.includes('service boot'));
    });

    const statuses = await projectServiceModule.getProjectServiceStatuses([project.id]);
    assert.equal(statuses[project.id]?.configured, true);
    assert.equal(statuses[project.id]?.running, true);

    const stopResult = await projectServiceModule.stopProjectService(project.id);
    assert.equal(stopResult.success, true);
    assert.equal(stopResult.status?.running, false);

    await waitFor(async () => {
      const logResult = await projectServiceModule.getProjectServiceLog(project.id);
      return Boolean(logResult.output?.includes('service stop command'));
    });

    const finalStatuses = await projectServiceModule.getProjectServiceStatuses([project.id]);
    assert.equal(finalStatuses[project.id]?.running, false);
  });
});
