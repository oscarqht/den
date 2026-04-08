import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  buildAgentStartupPrompt,
  buildProjectGitInstructionLines,
  buildWorkspaceInstructionLines,
  hasStartupTaskDescription,
} from './agent-startup-prompt.ts';
import type { SessionGitRepoContext, SessionWorkspaceFolder } from './types.ts';

function createGitRepoContext(overrides: Partial<SessionGitRepoContext> = {}): SessionGitRepoContext {
  return {
    sourceRepoPath: '/tmp/project',
    relativeRepoPath: '',
    worktreePath: '/tmp/worktree',
    branchName: 'codex/test',
    ...overrides,
  };
}

function createWorkspaceFolder(overrides: Partial<SessionWorkspaceFolder> = {}): SessionWorkspaceFolder {
  return {
    sourcePath: '/tmp/project',
    workspaceRelativePath: '.',
    workspacePath: '/tmp/project',
    provisioning: 'direct',
    ...overrides,
  };
}

describe('hasStartupTaskDescription', () => {
  it('returns false for empty and whitespace-only task descriptions', () => {
    assert.strictEqual(hasStartupTaskDescription(''), false);
    assert.strictEqual(hasStartupTaskDescription('   \n\t  '), false);
    assert.strictEqual(hasStartupTaskDescription(undefined), false);
  });

  it('returns true when the task description contains text', () => {
    assert.strictEqual(hasStartupTaskDescription('Fix the prompt'), true);
  });
});

describe('buildProjectGitInstructionLines', () => {
  it('describes folder mode when no repositories are detected', () => {
    assert.deepStrictEqual(
      buildProjectGitInstructionLines('folder', [], []),
      [
        'Git context: no Git repositories were detected in this project.',
        'Run file edits in folder mode and skip commit, push, and pull or merge request steps unless the user explicitly asks you to initialize Git.',
      ],
    );
  });

  it('describes a single repository at the project root', () => {
    assert.deepStrictEqual(
      buildProjectGitInstructionLines(
        'single_worktree',
        [createGitRepoContext()],
        [''],
      ),
      [
        'Git context: this project contains one Git repository at `.`.',
        'Your shell already starts in that repository, so run Git commands in `.`.',
      ],
    );
  });

  it('describes a single nested repository in single-worktree mode', () => {
    assert.deepStrictEqual(
      buildProjectGitInstructionLines(
        'single_worktree',
        [createGitRepoContext({ relativeRepoPath: 'apps/api' })],
        ['apps/api'],
      ),
      [
        'Git context: this project contains one Git repository at `apps/api`.',
        'Your shell already starts in that repository\'s worktree, so run Git commands in `.` even though its source-project path is `apps/api`.',
      ],
    );
  });

  it('describes multiple repositories in multi-repo worktree mode', () => {
    assert.deepStrictEqual(
      buildProjectGitInstructionLines(
        'multi_repo_worktree',
        [
          createGitRepoContext({ relativeRepoPath: 'apps/api' }),
          createGitRepoContext({ sourceRepoPath: '/tmp/project/web', relativeRepoPath: 'apps/web', worktreePath: '/tmp/worktree/apps/web' }),
        ],
        ['apps/api', 'apps/web'],
      ),
      [
        'Git context: this project contains 2 Git repositories at `apps/api`, `apps/web`.',
        'Your shell starts at the workspace root. Run each Git command from the matching repository path, not from the workspace root unless `.` is listed.',
        'If your changes span multiple repositories, commit, push, and open or update pull or merge requests separately for each repository.',
      ],
    );
  });

  it('describes multiple repositories in folder mode', () => {
    assert.deepStrictEqual(
      buildProjectGitInstructionLines(
        'folder',
        [],
        ['apps/api', 'apps/web'],
      ),
      [
        'Git context: this project contains 2 Git repositories at `apps/api`, `apps/web`.',
        'Your shell starts at the project root. Before any Git command, `cd` into the repository you are working in; do not assume the project root is itself a Git repository unless `.` is listed.',
        'If your changes span multiple repositories, handle commits, pushes, and pull or merge requests separately for each repository.',
      ],
    );
  });

  it('describes direct source mode', () => {
    assert.deepStrictEqual(
      buildProjectGitInstructionLines(
        'local_source',
        [createGitRepoContext()],
        [''],
      ),
      [
        'Git context: this project contains one Git repository at `.`.',
        'Your shell starts at the selected project source folder. Changes apply directly to that source checkout, so run Git commands in the matching repository path and use extra care with destructive operations.',
      ],
    );
  });
});

describe('buildWorkspaceInstructionLines', () => {
  it('describes a single mapped workspace root', () => {
    assert.deepStrictEqual(
      buildWorkspaceInstructionLines('local_source', [
        createWorkspaceFolder(),
      ]),
      [
        'Workspace layout: your shell starts in `.`, which maps to `/tmp/project` as a direct source folder.',
      ],
    );
  });

  it('describes multiple mapped workspace entries', () => {
    assert.deepStrictEqual(
      buildWorkspaceInstructionLines('multi_repo_worktree', [
        createWorkspaceFolder({
          sourcePath: '/tmp/project/apps/api',
          workspaceRelativePath: 'api',
          workspacePath: '/tmp/workspace/api',
          provisioning: 'worktree',
        }),
        createWorkspaceFolder({
          sourcePath: '/tmp/project/docs',
          workspaceRelativePath: 'docs',
          workspacePath: '/tmp/workspace/docs',
          provisioning: 'copy',
        }),
      ]),
      [
        'Workspace layout: your shell starts at the workspace root in multi_repo_worktree mode with 2 mapped entries.',
        'Workspace entry `api`: `/tmp/project/apps/api` (Git worktree).',
        'Workspace entry `docs`: `/tmp/project/docs` (copied folder).',
      ],
    );
  });
});

describe('buildAgentStartupPrompt', () => {
  it('returns null when the task description is empty', () => {
    assert.strictEqual(
      buildAgentStartupPrompt({
        taskDescription: '   ',
        attachmentPaths: ['/tmp/spec.md'],
        workspaceMode: 'folder',
      }),
      null,
    );
  });

  it('builds a prompt when the task description is present without attachments', () => {
    const prompt = buildAgentStartupPrompt({
      taskDescription: 'Fix the startup prompt',
      workspaceMode: 'single_worktree',
      workspaceFolders: [createWorkspaceFolder({
        workspacePath: '/tmp/worktree',
        provisioning: 'worktree',
      })],
      gitRepos: [createGitRepoContext()],
      discoveredRepoRelativePaths: [''],
    });

    assert.ok(prompt);
    assert.match(prompt!, /^# Instructions/m);
    assert.match(prompt!, /Workspace layout: your shell starts in `\.`/);
    assert.match(prompt!, /Git context: this project contains one Git repository at `\.`\./);
    assert.match(prompt!, /For testing and debugging in web projects, start a fresh dev server before running checks,/);
    assert.match(prompt!, /do not kill the process holding port `3200`; that port belongs to the Den app hosting this session\./);
    assert.match(prompt!, /Start the project on another available port instead unless the user explicitly asks to reuse `3200`\./);
    assert.match(prompt!, /If you are not sure which dev server command or script to use, ask the user to provide the dev server script before proceeding\./);
    assert.match(prompt!, /For visual UI tasks, prioritize Chrome remote-debug MCP tooling to attach to the user's current browser session/);
    assert.match(prompt!, /If that is unavailable, fall back to the `agent-browser` skill/);
    assert.match(prompt!, /For bugfix\/debugging tasks, use the `systematic-debugging` skill/);
    assert.match(prompt!, /you may use `npx skills` to discover and install additional skills at your discretion/);
    assert.match(prompt!, /When a task is large or naturally splits into independent workstreams, break it down into smaller subtasks before implementation\./);
    assert.match(prompt!, /If the runtime supports delegation or subagents, use them for bounded, independent subtasks that can run in parallel/);
    assert.match(prompt!, /# Task\n\nFix the startup prompt$/m);
    assert.doesNotMatch(prompt!, /Attachments:/);
    assert.doesNotMatch(prompt!, /send a notification to the matching Palx session/i);
  });

  it('includes attachments only when a task description is present', () => {
    const prompt = buildAgentStartupPrompt({
      taskDescription: 'Review the attached spec',
      attachmentPaths: ['/tmp/spec.md', '/tmp/spec.md', ''],
      sessionMode: 'plan',
      workspaceMode: 'multi_repo_worktree',
      workspaceFolders: [
        createWorkspaceFolder({
          sourcePath: '/tmp/project/apps/api',
          workspaceRelativePath: 'apps/api',
          workspacePath: '/tmp/worktree/apps/api',
          provisioning: 'worktree',
        }),
        createWorkspaceFolder({
          sourcePath: '/tmp/project/apps/web',
          workspaceRelativePath: 'apps/web',
          workspacePath: '/tmp/worktree/apps/web',
          provisioning: 'worktree',
        }),
      ],
      gitRepos: [createGitRepoContext({ relativeRepoPath: 'apps/api' })],
      discoveredRepoRelativePaths: ['apps/api', 'apps/web'],
    });

    assert.ok(prompt);
    assert.match(prompt!, /Plan mode: in your first response of this session/);
    assert.match(prompt!, /If you encounter ambiguity during planning, ask the user targeted clarification questions and resolve them before presenting the plan\./);
    assert.match(prompt!, /Once the scope is clear, present a concrete implementation plan and wait for explicit user approval/);
    assert.match(prompt!, /After the user approves that initial plan/);
    assert.match(prompt!, /small or trivial follow-up changes directly without re-requesting approval/);
    assert.match(prompt!, /Request approval again only when a proposed change is substantial/);
    assert.match(prompt!, /When a task is large or naturally splits into independent workstreams, break it down into smaller subtasks before implementation\./);
    assert.match(prompt!, /If the runtime supports delegation or subagents, use them for bounded, independent subtasks that can run in parallel/);
    assert.match(prompt!, /Attachments:\n- \/tmp\/spec\.md/);
    assert.doesNotMatch(prompt!, /send a notification to the matching Palx session/i);
  });

  it('includes relevant memory files when provided', () => {
    const prompt = buildAgentStartupPrompt({
      taskDescription: 'Investigate the project',
      workspaceMode: 'folder',
      memoryFiles: [
        { scope: 'global', path: '/tmp/.viba/memory/global.md', label: 'Global memory' },
        { scope: 'project', path: '/tmp/.viba/memory/projects/project-1.md', label: 'Den memory', projectId: 'project-1', projectName: 'Den' },
      ],
    });

    assert.ok(prompt);
    assert.match(prompt!, /Relevant memory files are available in local markdown files\./);
    assert.match(prompt!, /Global memory: `\/tmp\/\.viba\/memory\/global\.md`/);
    assert.match(prompt!, /Den memory: `\/tmp\/\.viba\/memory\/projects\/project-1\.md`/);
  });
});
