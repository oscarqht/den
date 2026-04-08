import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const tempHomes: string[] = [];

afterEach(async () => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;

  while (tempHomes.length > 0) {
    const tempHome = tempHomes.pop();
    if (!tempHome) continue;
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

async function loadMemoryModule() {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'den-memory-home-'));
  tempHomes.push(tempHome);
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  const moduleUrl = new URL(`./memory.ts?case=${Date.now()}-${Math.random()}`, import.meta.url);
  return {
    tempHome,
    memory: await import(moduleUrl.href),
  };
}

function defaultState(): Record<string, unknown> {
  return {
    version: 1,
    projects: {},
    repositories: {},
    appSettings: {},
    appConfig: {
      recentProjects: [],
      homeProjectSort: 'last-update',
      defaultRoot: '',
      selectedIde: 'vscode',
      agentWidth: 66.666,
      pinnedFolderShortcuts: [],
      projectSettings: {},
    },
    gitRepoCredentials: {},
    credentialsMetadata: [],
    agentApiCredentialsMetadata: [],
    sessions: {},
    sessionLaunchContexts: {},
    sessionCanvasLayouts: {},
    sessionWorkspacePreparations: {},
    drafts: {},
    quickCreateDrafts: {},
    sessionAgentHistoryItems: {},
  };
}

describe('memory', () => {
  it('creates and reads the global memory file', async () => {
    const { tempHome, memory } = await loadMemoryModule();

    const result = await memory.readGlobalMemory();

    assert.equal(result.scope, 'global');
    assert.equal(result.content, '# Global Memory\n');
    assert.equal(result.path, path.join(tempHome, '.viba', 'memory', 'global.md'));
    assert.equal(await fs.readFile(result.path, 'utf-8'), '# Global Memory\n');
  });

  it('creates and reads per-project memory files from local state', async () => {
    const { tempHome, memory } = await loadMemoryModule();
    const statePath = path.join(tempHome, '.viba', 'palx-state.json');
    const state = defaultState();
    (state.projects as Record<string, unknown>)['project-1'] = {
      id: 'project-1',
      name: 'Den',
      folderPaths: ['/tmp/den'],
    };
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(state), 'utf-8');

    const result = await memory.readProjectMemory('project-1');

    assert.equal(result.scope, 'project');
    assert.equal(result.projectId, 'project-1');
    assert.equal(result.content, '# Project Memory\n');
    assert.equal(result.path, path.join(tempHome, '.viba', 'memory', 'projects', 'project-1.md'));
  });

  it('returns both global and project memory files when a project is present', async () => {
    const { tempHome, memory } = await loadMemoryModule();
    const statePath = path.join(tempHome, '.viba', 'palx-state.json');
    const state = defaultState();
    (state.projects as Record<string, unknown>)['project-1'] = {
      id: 'project-1',
      name: 'Den',
      folderPaths: ['/tmp/den'],
    };
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(state), 'utf-8');

    const files = await memory.getRelevantMemoryFiles({
      projectId: 'project-1',
      projectPath: '/tmp/den',
    });

    assert.equal(files.length, 2);
    assert.deepEqual(files.map((entry: { scope: string }) => entry.scope), ['global', 'project']);
  });
});
