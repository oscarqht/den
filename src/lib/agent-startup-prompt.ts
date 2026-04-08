import type { SessionGitRepoContext, SessionWorkspaceFolder, SessionWorkspaceMode } from './types.ts';
import type { MemoryFileInfo } from './memory.ts';

const PLAN_MODE_STARTUP_INSTRUCTION =
  'Plan mode: in your first response of this session, inspect the relevant code. If you encounter ambiguity during planning, ask the user targeted clarification questions and resolve them before presenting the plan. Once the scope is clear, present a concrete implementation plan and wait for explicit user approval before any file edits or write commands. After the user approves that initial plan, execute small or trivial follow-up changes directly without re-requesting approval. Request approval again only when a proposed change is substantial (for example meaningfully expands scope, changes approach, or introduces material risk).';
const AUTO_COMMIT_INSTRUCTION =
  'If you changed files inside a Git repository and the work for that repository is complete, commit that repository without confirmation. Use a commit message with a clear title and a detailed body explaining what changed and why. If multiple repositories changed, handle each repository separately. If no repository applies, skip Git-only steps. If GITHUB_TOKEN or GITLAB_TOKEN is set, push each changed repository after committed rounds and create or update a pull or merge request for each changed repository; include the repository path and link in the first push reply. Prefer provider-native CLIs when available: for GitHub, `gh auth setup-git` can wire `GITHUB_TOKEN` into `git push`; for GitLab, use `glab` with `GITLAB_TOKEN` and honor `GITLAB_HOST` for self-hosted instances.';
const DEV_SERVER_TESTING_INSTRUCTION =
  'For testing and debugging in web projects, start a fresh dev server before running checks, but do not kill the process holding port `3200`; that port belongs to the Den app hosting this session. Start the project on another available port instead unless the user explicitly asks to reuse `3200`. If you are not sure which dev server command or script to use, ask the user to provide the dev server script before proceeding.';
const AGENT_BROWSER_SKILL_INSTRUCTION =
  'For visual UI tasks, prioritize Chrome remote-debug MCP tooling to attach to the user\'s current browser session. If that is unavailable, fall back to the `agent-browser` skill (https://skills.sh/vercel-labs/agent-browser/agent-browser), which may run in a standalone browser session.';
const SYSTEMATIC_DEBUGGING_SKILL_INSTRUCTION =
  'For bugfix/debugging tasks, use the `systematic-debugging` skill (https://github.com/obra/superpowers).';
const OPTIONAL_SKILL_DISCOVERY_INSTRUCTION =
  'If this task would benefit from another specialized workflow, you may use `npx skills` to discover and install additional skills at your discretion. Prefer trusted sources, install only what is needed, read the installed `SKILL.md` before using it, and avoid unnecessary overlapping skills.';
const TASK_BREAKDOWN_INSTRUCTION =
  'When a task is large or naturally splits into independent workstreams, break it down into smaller subtasks before implementation. If the runtime supports delegation or subagents, use them for bounded, independent subtasks that can run in parallel when that improves throughput or keeps the critical path moving.';
const VISUAL_EVIDENCE_INSTRUCTION =
  'When working on a visual-related feature or bugfix in a web project, after coding is complete, use Chrome remote-debug MCP tooling first to test the relevant page and capture screenshot(s) in the user\'s current browser session. If the current session is unavailable, fall back to `agent-browser` or another standalone browser automation option. Do not commit evidence files to the repository; upload them as pull or merge request attachments or comments via GitHub or GitLab APIs.';

export type BuildAgentStartupPromptOptions = {
  taskDescription?: string | null;
  attachmentPaths?: string[];
  memoryFiles?: MemoryFileInfo[];
  sessionMode?: 'fast' | 'plan';
  workspaceMode: SessionWorkspaceMode;
  workspaceFolders?: SessionWorkspaceFolder[];
  gitRepos?: SessionGitRepoContext[];
  discoveredRepoRelativePaths?: string[];
};

function normalizeRepoPath(value: string | null | undefined): string {
  const trimmed = value?.trim() || '';
  if (!trimmed || trimmed === '.') return '.';
  return trimmed.replace(/^\.\/+/, '').replace(/\/+$/, '') || '.';
}

function uniqueRepoPaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((path) => normalizeRepoPath(path)).filter(Boolean))).sort((a, b) => {
    if (a === b) return 0;
    if (a === '.') return -1;
    if (b === '.') return 1;
    return a.localeCompare(b);
  });
}

function formatRepoPaths(paths: string[]): string {
  return paths.map((path) => `\`${path}\``).join(', ');
}

function getKnownRepoPaths(
  discoveredRepoRelativePaths: string[] | undefined,
  gitRepos: SessionGitRepoContext[] | undefined,
): string[] {
  const discoveredPaths = uniqueRepoPaths(discoveredRepoRelativePaths || []);
  if (discoveredPaths.length > 0) return discoveredPaths;
  return uniqueRepoPaths((gitRepos || []).map((repo) => repo.relativeRepoPath));
}

function formatWorkspaceFolderProvisioning(provisioning: SessionWorkspaceFolder['provisioning']): string {
  switch (provisioning) {
    case 'direct':
      return 'direct source folder';
    case 'link':
      return 'linked source folder';
    case 'copy':
      return 'copied folder';
    case 'worktree':
      return 'Git worktree';
  }
}

export function buildWorkspaceInstructionLines(
  workspaceMode: SessionWorkspaceMode,
  workspaceFolders: SessionWorkspaceFolder[] = [],
): string[] {
  if (workspaceFolders.length === 0) {
    return [];
  }

  const normalizedWorkspaceFolders = [...workspaceFolders].sort((left, right) => (
    left.workspaceRelativePath.localeCompare(right.workspaceRelativePath)
  ));

  if (normalizedWorkspaceFolders.length === 1 && normalizedWorkspaceFolders[0]?.workspaceRelativePath === '.') {
    const onlyFolder = normalizedWorkspaceFolders[0];
    return [
      `Workspace layout: your shell starts in \`.\`, which maps to \`${onlyFolder.sourcePath}\` as a ${formatWorkspaceFolderProvisioning(onlyFolder.provisioning)}.`,
    ];
  }

  return [
    `Workspace layout: your shell starts at the workspace root in ${workspaceMode} mode with ${normalizedWorkspaceFolders.length} mapped entries.`,
    ...normalizedWorkspaceFolders.map((workspaceFolder) => (
      `Workspace entry \`${workspaceFolder.workspaceRelativePath}\`: \`${workspaceFolder.sourcePath}\` (${formatWorkspaceFolderProvisioning(workspaceFolder.provisioning)}).`
    )),
  ];
}

export function hasStartupTaskDescription(taskDescription?: string | null): boolean {
  return Boolean(taskDescription?.trim());
}

export function buildProjectGitInstructionLines(
  workspaceMode: SessionWorkspaceMode,
  gitRepos: SessionGitRepoContext[] = [],
  discoveredRepoRelativePaths: string[] = [],
): string[] {
  const repoPaths = getKnownRepoPaths(discoveredRepoRelativePaths, gitRepos);

  if (repoPaths.length === 0) {
    return [
      'Git context: no Git repositories were detected in this project.',
      'Run file edits in folder mode and skip commit, push, and pull or merge request steps unless the user explicitly asks you to initialize Git.',
    ];
  }

  if (workspaceMode === 'single_worktree' && gitRepos.length === 1) {
    const sourceRepoPath = normalizeRepoPath(gitRepos[0]?.relativeRepoPath);
    if (sourceRepoPath === '.') {
      return [
        'Git context: this project contains one Git repository at `.`.',
        'Your shell already starts in that repository, so run Git commands in `.`.',
      ];
    }

    return [
      `Git context: this project contains one Git repository at ${formatRepoPaths([sourceRepoPath])}.`,
      `Your shell already starts in that repository's worktree, so run Git commands in \`.\` even though its source-project path is \`${sourceRepoPath}\`.`,
    ];
  }

  if (workspaceMode === 'multi_repo_worktree') {
    return [
      `Git context: this project contains ${repoPaths.length} Git repositories at ${formatRepoPaths(repoPaths)}.`,
      'Your shell starts at the workspace root. Run each Git command from the matching repository path, not from the workspace root unless `.` is listed.',
      'If your changes span multiple repositories, commit, push, and open or update pull or merge requests separately for each repository.',
    ];
  }

  if (workspaceMode === 'local_source') {
    const repoSummary = repoPaths.length === 1
      ? `this project contains one Git repository at ${formatRepoPaths(repoPaths)}.`
      : `this project contains ${repoPaths.length} Git repositories at ${formatRepoPaths(repoPaths)}.`;
    return [
      `Git context: ${repoSummary}`,
      'Your shell starts at the selected project source folder. Changes apply directly to that source checkout, so run Git commands in the matching repository path and use extra care with destructive operations.',
      ...(repoPaths.length > 1 || !repoPaths.includes('.')
        ? ['If your changes span multiple repositories, handle commits, pushes, and pull or merge requests separately for each repository.']
        : []),
    ];
  }

  return [
    `Git context: this project contains ${repoPaths.length} Git repositories at ${formatRepoPaths(repoPaths)}.`,
    'Your shell starts at the project root. Before any Git command, `cd` into the repository you are working in; do not assume the project root is itself a Git repository unless `.` is listed.',
    ...(repoPaths.length > 1
      ? ['If your changes span multiple repositories, handle commits, pushes, and pull or merge requests separately for each repository.']
      : []),
  ];
}

export function buildAgentStartupPrompt({
  taskDescription,
  attachmentPaths = [],
  memoryFiles = [],
  sessionMode = 'fast',
  workspaceMode,
  workspaceFolders = [],
  gitRepos = [],
  discoveredRepoRelativePaths = [],
}: BuildAgentStartupPromptOptions): string | null {
  if (!hasStartupTaskDescription(taskDescription)) {
    return null;
  }

  const trimmedTaskDescription = taskDescription!.trim();
  const normalizedAttachmentPaths = Array.from(
    new Set(attachmentPaths.map((entry) => entry.trim()).filter(Boolean)),
  );
  const normalizedMemoryFiles = Array.from(new Map<string, MemoryFileInfo>(
    memoryFiles
      .map((entry) => {
        const normalizedPath = entry.path.trim();
        if (!normalizedPath) return null;
        return [
          normalizedPath,
          {
            ...entry,
            path: normalizedPath,
            label: entry.label.trim() || 'Memory',
          },
        ] as const;
      })
      .filter((entry): entry is readonly [string, MemoryFileInfo] => Boolean(entry)),
  ).values());

  const instructionLines: string[] = [];
  if (sessionMode === 'plan') {
    instructionLines.push(PLAN_MODE_STARTUP_INSTRUCTION);
  }
  instructionLines.push(...buildWorkspaceInstructionLines(workspaceMode, workspaceFolders));
  instructionLines.push(...buildProjectGitInstructionLines(workspaceMode, gitRepos, discoveredRepoRelativePaths));
  instructionLines.push(AUTO_COMMIT_INSTRUCTION);
  instructionLines.push(DEV_SERVER_TESTING_INSTRUCTION);
  instructionLines.push(AGENT_BROWSER_SKILL_INSTRUCTION);
  instructionLines.push(SYSTEMATIC_DEBUGGING_SKILL_INSTRUCTION);
  instructionLines.push(OPTIONAL_SKILL_DISCOVERY_INSTRUCTION);
  instructionLines.push(TASK_BREAKDOWN_INSTRUCTION);
  instructionLines.push(VISUAL_EVIDENCE_INSTRUCTION);
  if (normalizedMemoryFiles.length > 0) {
    instructionLines.push('Relevant memory files are available in local markdown files. Read them before substantial work when relevant, and update them only with durable, high-value notes that will help future tasks.');
    for (const memoryFile of normalizedMemoryFiles) {
      instructionLines.push(`${memoryFile.label}: \`${memoryFile.path}\``);
    }
  }

  const taskSections: string[] = [trimmedTaskDescription];
  if (normalizedAttachmentPaths.length > 0) {
    taskSections.push([
      'Attachments:',
      ...normalizedAttachmentPaths.map((attachmentPath) => `- ${attachmentPath}`),
    ].join('\n'));
  }

  return [
    '# Instructions',
    '',
    instructionLines.map((line) => `- ${line}`).join('\n'),
    '',
    '# Task',
    '',
    taskSections.join('\n\n'),
  ].join('\n');
}
