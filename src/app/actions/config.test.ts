import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type ConfigModule = typeof import('./config.ts');

let tempHome = '';
let previousHome = '';
let previousUserProfile = '';
let configModule: ConfigModule;

before(async () => {
  tempHome = await mkdtemp(path.join(os.tmpdir(), 'palx-config-test-'));
  previousHome = process.env.HOME || '';
  previousUserProfile = process.env.USERPROFILE || '';
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  configModule = await import('./config.ts');
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
});
