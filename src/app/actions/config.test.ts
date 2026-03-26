import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type ConfigModule = typeof import('./config.ts');
type StoreModule = typeof import('../../lib/store.ts');

let tempHome = '';
let previousHome = '';
let previousUserProfile = '';
let configModule: ConfigModule;
let storeModule: StoreModule;

before(async () => {
  tempHome = await mkdtemp(path.join(os.tmpdir(), 'palx-config-test-'));
  previousHome = process.env.HOME || '';
  previousUserProfile = process.env.USERPROFILE || '';
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

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

describe('config global agent defaults', () => {
  it('defaults home project sort to last-update', async () => {
    const config = await configModule.getConfig();

    assert.equal(config.homeProjectSort, 'last-update');
  });

  it('round-trips the home project sort preference', async () => {
    const updated = await configModule.updateConfig({
      homeProjectSort: 'name',
    });

    assert.equal(updated.homeProjectSort, 'name');

    const loaded = await configModule.getConfig();
    assert.equal(loaded.homeProjectSort, 'name');
  });

  it('round-trips global default agent settings', async () => {
    const updated = await configModule.updateConfig({
      defaultAgentProvider: 'codex',
      defaultAgentModel: 'gpt-5.4',
      defaultAgentReasoningEffort: 'high',
    });

    assert.equal(updated.defaultAgentProvider, 'codex');
    assert.equal(updated.defaultAgentModel, 'gpt-5.4');
    assert.equal(updated.defaultAgentReasoningEffort, 'high');

    const loaded = await configModule.getConfig();
    assert.equal(loaded.defaultAgentProvider, 'codex');
    assert.equal(loaded.defaultAgentModel, 'gpt-5.4');
    assert.equal(loaded.defaultAgentReasoningEffort, 'high');
  });

  it('keeps recentProjects as project ids while exposing recentRepos as folder paths', async () => {
    const projectRoot = path.join(tempHome, 'project-a');
    const project = storeModule.addProject({
      name: 'Project A',
      folderPaths: [projectRoot],
    });

    const updated = await configModule.updateConfig({
      recentProjects: [project.id],
    });

    assert.deepEqual(updated.recentProjects, [project.id]);
    assert.deepEqual(updated.recentRepos, [projectRoot]);

    const loaded = await configModule.getConfig();
    assert.deepEqual(loaded.recentProjects, [project.id]);
    assert.deepEqual(loaded.recentRepos, [projectRoot]);
  });

  it('normalizes default reasoning by provider', async () => {
    const geminiConfig = await configModule.updateConfig({
      defaultAgentProvider: 'gemini',
      defaultAgentModel: 'gemini-2.5-pro',
      defaultAgentReasoningEffort: 'high',
    });
    assert.equal(geminiConfig.defaultAgentProvider, 'gemini');
    assert.equal(geminiConfig.defaultAgentReasoningEffort, 'high');

    const codexConfig = await configModule.updateConfig({
      defaultAgentProvider: 'codex',
      defaultAgentReasoningEffort: 'minimal',
    });
    assert.equal(codexConfig.defaultAgentProvider, 'codex');
    assert.equal(codexConfig.defaultAgentReasoningEffort, 'low');
  });

  it('clears project runtime fields when undefined updates are provided', async () => {
    const projectRoot = path.join(tempHome, 'project-runtime-clear');
    const project = storeModule.addProject({
      name: 'Project Runtime Clear',
      folderPaths: [projectRoot],
    });

    await configModule.updateProjectSettings(project.id, {
      agentProvider: 'codex',
      agentModel: 'gpt-5.4',
      agentReasoningEffort: 'low',
    });

    const updated = await configModule.updateProjectSettings(project.id, {
      agentProvider: 'gemini',
      agentModel: 'gemini-2.5-pro',
      agentReasoningEffort: undefined,
    });

    assert.equal(updated.projectSettings[project.id]?.agentProvider, 'gemini');
    assert.equal(updated.projectSettings[project.id]?.agentModel, 'gemini-2.5-pro');
    assert.equal(updated.projectSettings[project.id]?.agentReasoningEffort, undefined);
    assert.equal(updated.projectSettings[projectRoot]?.agentReasoningEffort, undefined);
  });
});
