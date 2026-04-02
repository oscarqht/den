import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type QuickCreateModule = typeof import('./quick-create.ts');
type ConfigModule = typeof import('./config.ts');
type LocalDbModule = typeof import('../../lib/local-db.ts');

let tempHome = '';
let previousHome = '';
let previousUserProfile = '';
let quickCreateModule: QuickCreateModule;
let configModule: ConfigModule;
let localDbModule: LocalDbModule;

function getWorkspaceRoot() {
  return path.join(tempHome, 'workspace');
}

function getProjectPath() {
  return path.join(getWorkspaceRoot(), 'project-a');
}

function getProjectId() {
  return 'project-a-id';
}

function getSessionWorkspacePath() {
  return path.join(getWorkspaceRoot(), '.palx', 'session-1', 'workspace');
}

before(async () => {
  tempHome = await mkdtemp(path.join(os.tmpdir(), 'palx-quick-create-test-'));
  previousHome = process.env.HOME || '';
  previousUserProfile = process.env.USERPROFILE || '';
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  configModule = await import('./config.ts');
  localDbModule = await import('../../lib/local-db.ts');
  quickCreateModule = await import('./quick-create.ts');
});

beforeEach(async () => {
  await mkdir(getProjectPath(), { recursive: true });
  localDbModule.resetLocalStateForTests();
  localDbModule.updateLocalState((state) => {
    state.quickCreateDrafts = {};
  });
  await configModule.updateConfig({
    recentProjects: [getProjectId()],
    defaultRoot: getWorkspaceRoot(),
    defaultAgentProvider: 'codex',
    defaultAgentModel: 'gpt-5.4',
  });
});

after(async () => {
  process.env.HOME = previousHome;
  process.env.USERPROFILE = previousUserProfile;
  if (tempHome) {
    await rm(tempHome, { recursive: true, force: true });
  }
});

function createWorkflowDependencies(overrides: Record<string, unknown> = {}) {
  let currentConfigPromise = configModule.getConfig();

  const dependencies = {
    getConfig: mock.fn(async () => await currentConfigPromise),
    updateConfig: mock.fn(async (updates: Parameters<typeof configModule.updateConfig>[0]) => {
      const nextConfig = await configModule.updateConfig(updates);
      currentConfigPromise = Promise.resolve(nextConfig);
      return nextConfig;
    }),
    getProjects: mock.fn(() => [{
      id: getProjectId(),
      name: 'project-a',
      folderPaths: [getProjectPath()],
    }]),
    getDefaultAgentProvider: mock.fn(async () => 'codex'),
    loadAgentStatus: mock.fn(async () => ({
      provider: 'codex',
      installed: true,
      version: '1.0.0',
      loggedIn: true,
      account: null,
      installCommand: 'codex install',
      models: [{ id: 'gpt-5.4', label: 'GPT-5.4', reasoningEfforts: ['low', 'medium', 'high'] }],
      defaultModel: 'gpt-5.4',
    })),
    discoverProjectGitReposWithBranches: mock.fn(async () => ({
      repos: [{
        repoPath: getProjectPath(),
        relativePath: '',
      }],
      truncated: false,
      scannedDirs: 1,
      overlapDetected: false,
      branchesByRepo: {
        [getProjectPath()]: [{ name: 'main', current: true }],
      },
    })),
    createSession: mock.fn(async () => ({
      success: true,
      sessionName: 'session-1',
      workspacePath: getSessionWorkspacePath(),
      workspaceMode: 'single_worktree',
      activeRepoPath: getProjectPath(),
      gitRepos: [{
        sourceRepoPath: getProjectPath(),
        relativeRepoPath: '',
        worktreePath: getSessionWorkspacePath(),
        branchName: 'palx/session-1',
        baseBranch: 'main',
      }],
    })),
    deleteSession: mock.fn(async () => ({ success: true })),
    saveSessionLaunchContext: mock.fn(async () => ({ success: true })),
    startSessionTurn: mock.fn(async () => ({ success: true, runtime: null })),
    registerAgentSession: mock.fn(() => ({ snapshot: {} as never, history: [] })),
    startAgentSessionTurn: mock.fn(async () => ({ snapshot: {} as never, history: [] })),
    waitForAgentSessionRun: mock.fn(async () => ({ snapshot: {} as never, history: [] })),
    hydrateAgentSessionHistory: mock.fn(async () => ({
      snapshot: {} as never,
      history: [{
        kind: 'assistant',
        id: 'assistant-1',
        text: JSON.stringify({
          projectId: getProjectId(),
          projectPath: getProjectPath(),
          reasoningEffort: 'minimal',
          reason: 'Closest project match.',
        }),
        phase: null,
      }],
    })),
    unregisterAgentSession: mock.fn(() => true),
    createProjectFromDefaultRoot: mock.fn(async (projectName: string) => ({
      projectId: `${projectName}-id`,
      projectPath: path.join(getWorkspaceRoot(), projectName),
      projectName,
    })),
    ...overrides,
  };

  return dependencies;
}

describe('executeQuickCreateTaskJob', () => {
  it('creates a plan session and normalizes codex minimal reasoning to low', async () => {
    const dependencies = createWorkflowDependencies();

    const result = await quickCreateModule.executeQuickCreateTaskJob({
      message: 'Fix the checkout total on mobile.',
      attachmentPaths: ['/tmp/screenshot.png'],
    }, dependencies as never);

    assert.deepStrictEqual(result, {
      status: 'succeeded',
      sessionId: 'session-1',
      sessionIds: ['session-1'],
      projectId: getProjectId(),
      projectIds: [getProjectId()],
      projectPath: getProjectPath(),
      projectPaths: [getProjectPath()],
      projectNames: ['project-a'],
      draftId: undefined,
    });

    assert.equal(dependencies.createSession.mock.callCount(), 1);
    const createSessionCall = dependencies.createSession.mock.calls[0];
    const createSessionArgs = (createSessionCall?.arguments ?? []) as unknown as [string, unknown, { reasoningEffort?: string }?];
    assert.equal(createSessionArgs[2]?.reasoningEffort, 'low');

    assert.equal(dependencies.startSessionTurn.mock.callCount(), 1);
    assert.equal(dependencies.deleteSession.mock.callCount(), 0);

    const state = await quickCreateModule.getHomeQuickCreateState();
    assert.equal(state.drafts.length, 0);
  });

  it('cleans up orphaned sessions and saves a failed quick create draft when task startup fails', async () => {
    const dependencies = createWorkflowDependencies({
      startSessionTurn: mock.fn(async () => ({ success: false, error: 'Failed to queue agent turn.' })),
    });

    const result = await quickCreateModule.executeQuickCreateTaskJob({
      message: 'Investigate the failing payment webhook.',
      attachmentPaths: ['/tmp/webhook-log.txt'],
    }, dependencies as never);

    assert.equal(result.status, 'failed');
    assert.match(result.error, /failed to queue agent turn/i);
    assert.equal(dependencies.deleteSession.mock.callCount(), 1);

    const drafts = await quickCreateModule.listQuickCreateDrafts();
    assert.equal(drafts.length, 1);
    assert.match(drafts[0]!.lastError, /failed to queue agent turn/i);

    const deleteResult = await quickCreateModule.deleteQuickCreateDraft(drafts[0]!.id);
    assert.equal(deleteResult.success, true);
    assert.equal((await quickCreateModule.listQuickCreateDrafts()).length, 0);
  });

  it('creates one session per routed project target', async () => {
    await mkdir(path.join(getWorkspaceRoot(), 'project-b'), { recursive: true });
    let createSessionCount = 0;
    const dependencies = createWorkflowDependencies({
      getProjects: mock.fn(() => [
        {
          id: getProjectId(),
          name: 'project-a',
          folderPaths: [getProjectPath()],
        },
        {
          id: 'project-b-id',
          name: 'project-b',
          folderPaths: [path.join(getWorkspaceRoot(), 'project-b')],
        },
      ]),
      hydrateAgentSessionHistory: mock.fn(async () => ({
        snapshot: {} as never,
        history: [{
          kind: 'assistant',
          id: 'assistant-1',
          text: JSON.stringify({
            targets: [
              {
                type: 'existing',
                projectId: getProjectId(),
                projectPath: getProjectPath(),
                reason: 'The task references project a.',
              },
              {
                type: 'existing',
                projectId: 'project-b-id',
                projectPath: path.join(getWorkspaceRoot(), 'project-b'),
                reason: 'The task also references project b.',
              },
            ],
            reasoningEffort: 'minimal',
            reason: 'The task spans two projects.',
          }),
          phase: null,
        }],
      })),
      createSession: mock.fn(async () => {
        createSessionCount += 1;
        return {
          success: true,
          sessionName: `session-${createSessionCount}`,
          workspacePath: getSessionWorkspacePath(),
          workspaceMode: 'single_worktree',
          activeRepoPath: getProjectPath(),
          gitRepos: [{
            sourceRepoPath: getProjectPath(),
            relativeRepoPath: '',
            worktreePath: getSessionWorkspacePath(),
            branchName: 'palx/session-1',
            baseBranch: 'main',
          }],
        };
      }),
    });

    const result = await quickCreateModule.executeQuickCreateTaskJob({
      message: 'Fix bug in ai and ak project.',
    }, dependencies as never);

    assert.deepStrictEqual(result, {
      status: 'succeeded',
      sessionId: 'session-1',
      sessionIds: ['session-1', 'session-2'],
      projectId: getProjectId(),
      projectIds: [getProjectId(), 'project-b-id'],
      projectPath: getProjectPath(),
      projectPaths: [getProjectPath(), path.join(getWorkspaceRoot(), 'project-b')],
      projectNames: ['project-a', 'project-b'],
      draftId: undefined,
    });

    assert.equal(dependencies.createSession.mock.callCount(), 2);
  });

  it('creates a new project under the default root when routing returns a new target', async () => {
    const dependencies = createWorkflowDependencies({
      getProjects: mock.fn(() => []),
      hydrateAgentSessionHistory: mock.fn(async () => ({
        snapshot: {} as never,
        history: [{
          kind: 'assistant',
          id: 'assistant-1',
          text: JSON.stringify({
            targets: [{
              type: 'new',
              projectName: 'ak',
              reason: 'No suitable existing project matches.',
            }],
            reasoningEffort: 'medium',
            reason: 'This task needs a new project.',
          }),
          phase: null,
        }],
      })),
    });

    const result = await quickCreateModule.executeQuickCreateTaskJob({
      message: 'Create a new task for the ak project.',
    }, dependencies as never);

    assert.equal(result.status, 'succeeded');
    assert.deepStrictEqual(result.projectNames, ['ak']);
    assert.equal(dependencies.createProjectFromDefaultRoot.mock.callCount(), 1);
    assert.equal(dependencies.createProjectFromDefaultRoot.mock.calls[0]?.arguments[0], 'ak');
  });
});
