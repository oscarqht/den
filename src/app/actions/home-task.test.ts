import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { createHomeTaskInternal } from './home-task.ts';

import type { Config } from './config.ts';
import type { AppStatus, ModelOption, Project } from '../../lib/types.ts';

function createConfig(overrides: Partial<Config> = {}): Config {
  return {
    recentProjects: ['/work/apps/alpha'],
    recentRepos: ['/work/apps/alpha'],
    defaultRoot: '',
    selectedIde: 'vscode',
    agentWidth: 66.666,
    defaultAgentProvider: 'codex',
    defaultAgentModel: 'gpt-5.4',
    defaultAgentReasoningEffort: 'high',
    projectSettings: {},
    repoSettings: {},
    pinnedFolderShortcuts: [],
    ...overrides,
  };
}

function createStatus(
  provider: AppStatus['provider'],
  overrides: Partial<AppStatus> = {},
): AppStatus {
  const defaultModels: Record<string, ModelOption[]> = {
    codex: [
      {
        id: 'gpt-5.4',
        label: 'GPT-5.4',
        reasoningEfforts: ['low', 'medium', 'high'],
      },
    ],
    gemini: [
      {
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
      },
    ],
    cursor: [
      {
        id: 'auto',
        label: 'Auto',
      },
    ],
  };

  return {
    provider,
    installed: true,
    version: '1.0.0',
    loggedIn: true,
    account: null,
    installCommand: `${provider} install`,
    models: defaultModels[provider] ?? [],
    defaultModel: defaultModels[provider]?.[0]?.id ?? null,
    ...overrides,
  };
}

function createProjects(): Project[] {
  return [
    {
      path: '/work/apps/alpha',
      name: 'alpha',
      displayName: 'Alpha',
    },
    {
      path: '/work/apps/beta',
      name: 'beta',
      displayName: 'Beta',
    },
  ];
}

describe('createHomeTaskInternal', () => {
  it('creates a task when the project match is confident', async () => {
    const runAdHocAgentText = mock.fn(async ({ provider }: { provider: string }) => {
      if (provider === 'codex') {
        return {
          threadId: 'thread-project',
          assistantText: JSON.stringify({
            selectedProjectPath: '/work/apps/beta',
            needsUserChoice: false,
            candidates: [
              {
                projectPath: '/work/apps/beta',
                confidence: 0.93,
                rationale: 'The task clearly targets Beta.',
              },
            ],
          }),
        };
      }

      return {
        threadId: 'thread-runtime',
        assistantText: JSON.stringify({
          model: 'gemini-2.5-pro',
          reasoningEffort: null,
          rationale: 'Gemini Pro is enough for this task.',
        }),
      };
    });
    const updateConfig = mock.fn(async (updates: Partial<Config>) => createConfig(updates));
    const createAndLaunchTaskSession = mock.fn(async (input: Record<string, unknown>) => ({
      success: true,
      sessionName: 'session-123',
      title: 'Fix Beta sync bug',
      input,
    }));

    const result = await createHomeTaskInternal({
      description: 'Fix the Beta sync bug in the payment worker.',
      attachmentPaths: ['/tmp/repro.txt'],
    }, {
      getConfig: async () => createConfig({
        projectSettings: {
          '/work/apps/beta': {
            agentProvider: 'gemini',
            remoteResources: [
              {
                provider: 'notion',
                resourceType: 'document',
                uri: 'https://workspace.notion.site/Beta-Task-Context-abc123',
              },
            ],
          },
        },
      }),
      updateConfig,
      getProjects: createProjects,
      getDefaultAgentProvider: () => 'codex',
      getAgentStatus: async (provider) => createStatus(provider),
      runAdHocAgentText,
      createAndLaunchTaskSession,
      getRecommendationWorkspacePath: () => '/tmp',
    });

    assert.deepStrictEqual(result, {
      status: 'created',
      sessionName: 'session-123',
      projectPath: '/work/apps/beta',
      title: 'Fix Beta sync bug',
    });
    assert.strictEqual(runAdHocAgentText.mock.callCount(), 2);
    assert.strictEqual(updateConfig.mock.callCount(), 1);
    assert.deepStrictEqual(updateConfig.mock.calls[0].arguments[0], {
      recentProjects: ['/work/apps/beta', '/work/apps/alpha'],
    });
    assert.strictEqual(createAndLaunchTaskSession.mock.callCount(), 1);
    const taskInput = createAndLaunchTaskSession.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(taskInput.projectPath, '/work/apps/beta');
    assert.equal(taskInput.agentProvider, 'gemini');
    assert.equal(taskInput.model, 'gemini-2.5-pro');
    assert.equal(taskInput.sessionMode, 'plan');
    assert.equal(taskInput.workspacePreference, 'workspace');
    assert.deepStrictEqual(taskInput.remoteResources, [
      {
        provider: 'notion',
        resourceType: 'document',
        uri: 'https://workspace.notion.site/Beta-Task-Context-abc123',
      },
    ]);
  });

  it('returns project suggestions without creating a task when the match is ambiguous', async () => {
    const runAdHocAgentText = mock.fn(async () => ({
      threadId: 'thread-project',
      assistantText: JSON.stringify({
        selectedProjectPath: '/work/apps/alpha',
        needsUserChoice: true,
        candidates: [
          {
            projectPath: '/work/apps/alpha',
            confidence: 0.61,
            rationale: 'The task could belong to Alpha.',
          },
          {
            projectPath: '/work/apps/beta',
            confidence: 0.57,
            rationale: 'Beta is also plausible.',
          },
        ],
      }),
    }));
    const createAndLaunchTaskSession = mock.fn(async () => ({
      success: true,
      sessionName: 'should-not-happen',
    }));

    const result = await createHomeTaskInternal({
      description: 'Investigate the flaky dashboard test.',
      attachmentPaths: [],
    }, {
      getConfig: async () => createConfig(),
      updateConfig: async (updates) => createConfig(updates),
      getProjects: createProjects,
      getDefaultAgentProvider: () => 'codex',
      getAgentStatus: async (provider) => createStatus(provider),
      runAdHocAgentText,
      createAndLaunchTaskSession,
      getRecommendationWorkspacePath: () => '/tmp',
    });

    assert.equal(result.status, 'needs_project_choice');
    assert.equal(runAdHocAgentText.mock.callCount(), 1);
    assert.strictEqual(createAndLaunchTaskSession.mock.callCount(), 0);
  });

  it('auto-creates when confidence is above eighty percent even if the agent flags ambiguity', async () => {
    const runAdHocAgentText = mock.fn(async ({ provider }: { provider: string }) => {
      if (provider === 'codex') {
        return {
          threadId: 'thread-project',
          assistantText: JSON.stringify({
            selectedProjectPath: '/work/apps/alpha',
            needsUserChoice: true,
            candidates: [
              {
                projectPath: '/work/apps/alpha',
                confidence: 0.81,
                rationale: 'Alpha is still the strongest match.',
              },
              {
                projectPath: '/work/apps/beta',
                confidence: 0.79,
                rationale: 'Beta is somewhat plausible.',
              },
            ],
          }),
        };
      }

      return {
        threadId: 'thread-runtime',
        assistantText: JSON.stringify({
          model: 'gpt-5.4',
          reasoningEffort: 'high',
          rationale: 'Use the default Codex runtime.',
        }),
      };
    });
    const createAndLaunchTaskSession = mock.fn(async () => ({
      success: true,
      sessionName: 'session-789',
    }));

    const result = await createHomeTaskInternal({
      description: 'Fix the Alpha onboarding flow.',
      attachmentPaths: [],
    }, {
      getConfig: async () => createConfig(),
      updateConfig: async (updates) => createConfig(updates),
      getProjects: createProjects,
      getDefaultAgentProvider: () => 'codex',
      getAgentStatus: async (provider) => createStatus(provider),
      runAdHocAgentText,
      createAndLaunchTaskSession,
      getRecommendationWorkspacePath: () => '/tmp',
    });

    assert.equal(result.status, 'created');
    assert.strictEqual(runAdHocAgentText.mock.callCount(), 2);
    assert.strictEqual(createAndLaunchTaskSession.mock.callCount(), 1);
  });

  it('skips project analysis when the user provides a project choice', async () => {
    const runAdHocAgentText = mock.fn(async () => ({
      threadId: 'thread-runtime',
      assistantText: JSON.stringify({
        model: 'gpt-5.4',
        reasoningEffort: 'high',
        rationale: 'Use the saved Codex default.',
      }),
    }));
    const createAndLaunchTaskSession = mock.fn(async () => ({
      success: true,
      sessionName: 'session-456',
    }));

    const result = await createHomeTaskInternal({
      description: 'Add search filters to Alpha.',
      attachmentPaths: [],
      selectedProjectPath: '/work/apps/alpha',
    }, {
      getConfig: async () => createConfig(),
      updateConfig: async (updates) => createConfig(updates),
      getProjects: createProjects,
      getDefaultAgentProvider: () => 'codex',
      getAgentStatus: async (provider) => createStatus(provider),
      runAdHocAgentText,
      createAndLaunchTaskSession,
      getRecommendationWorkspacePath: () => '/tmp',
    });

    assert.equal(result.status, 'created');
    assert.strictEqual(runAdHocAgentText.mock.callCount(), 1);
    assert.strictEqual(createAndLaunchTaskSession.mock.callCount(), 1);
  });

  it('blocks creation when the default analysis provider is unavailable', async () => {
    const result = await createHomeTaskInternal({
      description: 'Route this task somewhere.',
      attachmentPaths: [],
    }, {
      getConfig: async () => createConfig(),
      updateConfig: async (updates) => createConfig(updates),
      getProjects: createProjects,
      getDefaultAgentProvider: () => 'codex',
      getAgentStatus: async () => createStatus('codex', {
        loggedIn: false,
      }),
      runAdHocAgentText: async () => {
        throw new Error('Should not run analysis');
      },
      createAndLaunchTaskSession: async () => ({
        success: true,
        sessionName: 'should-not-happen',
      }),
      getRecommendationWorkspacePath: () => '/tmp',
    });

    assert.deepStrictEqual(result, {
      status: 'error',
      error: 'Log in to codex before creating a home task.',
    });
  });

  it('blocks creation when the chosen project provider is unavailable', async () => {
    const result = await createHomeTaskInternal({
      description: 'Create the task directly in Beta.',
      attachmentPaths: [],
      selectedProjectPath: '/work/apps/beta',
    }, {
      getConfig: async () => createConfig({
        projectSettings: {
          '/work/apps/beta': {
            agentProvider: 'gemini',
          },
        },
      }),
      updateConfig: async (updates) => createConfig(updates),
      getProjects: createProjects,
      getDefaultAgentProvider: () => 'codex',
      getAgentStatus: async (provider) => {
        if (provider === 'gemini') {
          return createStatus('gemini', {
            installed: false,
          });
        }
        return createStatus(provider);
      },
      runAdHocAgentText: async () => {
        throw new Error('Should not run runtime analysis');
      },
      createAndLaunchTaskSession: async () => ({
        success: true,
        sessionName: 'should-not-happen',
      }),
      getRecommendationWorkspacePath: () => '/tmp',
    });

    assert.deepStrictEqual(result, {
      status: 'error',
      error: 'Install gemini before creating a home task.',
    });
  });
});
