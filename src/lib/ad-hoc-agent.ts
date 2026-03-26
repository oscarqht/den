import { normalizeProviderReasoningEffort } from './agent/reasoning.ts';
import { buildShellSetDirectoryCommand, joinShellStatements, quoteShellArg } from './shell.ts';
import { type TerminalShellKind } from './terminal-session.ts';
import type { AgentProvider, ReasoningEffort } from './types.ts';

const SESSION_AGENT_CODEX_BASE_FLAGS = [
  '-c approval_policy="never"',
  '--color never',
  '--sandbox danger-full-access',
  '--skip-git-repo-check',
];
const SESSION_AGENT_CODEX_EXEC_FLAGS = [
  ...SESSION_AGENT_CODEX_BASE_FLAGS,
  'exec',
  '-',
];
const CONFLICT_AGENT_CODEX_FLAGS = [
  '-c tui.theme="ansi"',
  '--sandbox danger-full-access',
  '--ask-for-approval on-request',
  '--search',
];

export type ConflictAgentOperation =
  | {
      kind: 'merge';
      sourceBranch: string;
      targetBranch: string;
      rebaseBeforeMerge: boolean;
      squash: boolean;
      fastForward: boolean;
      squashMessage: string;
    }
  | {
      kind: 'rebase';
      sourceBranch: string;
      targetBranch: string;
      stashChanges: boolean;
    };

type BuildProviderCommandOptions = {
  provider: AgentProvider;
  model: string;
  reasoningEffort?: ReasoningEffort;
  shellKind: TerminalShellKind;
  prompt: string;
  codexArgs: string[];
  codexMode: 'pipe' | 'inline';
};

export type BuildSessionAgentTerminalCommandOptions = {
  provider: AgentProvider;
  model: string;
  reasoningEffort?: ReasoningEffort;
  shellKind: TerminalShellKind;
  workingDirectory: string;
  prompt?: string | null;
};

function buildCodexReasoningArgs(
  shellKind: TerminalShellKind,
  reasoningEffort: ReasoningEffort | undefined,
): string[] {
  if (!reasoningEffort) {
    return [];
  }

  return [
    '-c',
    quoteShellArg(
      `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`,
      shellKind,
    ),
  ];
}

function buildProviderCommand({
  provider,
  model,
  reasoningEffort,
  shellKind,
  prompt,
  codexArgs,
  codexMode,
}: BuildProviderCommandOptions): string {
  const normalizedModel = model.trim();
  const promptArg = quoteShellArg(prompt, shellKind);
  const normalizedReasoning = normalizeProviderReasoningEffort(
    provider,
    reasoningEffort,
  );

  if (provider === 'gemini') {
    return [
      'gemini --yolo',
      normalizedModel
        ? `--model ${quoteShellArg(normalizedModel, shellKind)}`
        : null,
      `-p ${promptArg}`,
    ]
      .filter(Boolean)
      .join(' ');
  }

  if (provider === 'cursor') {
    return [
      'cursor-agent -f',
      normalizedModel
        ? `--model ${quoteShellArg(normalizedModel, shellKind)}`
        : null,
      `-p ${promptArg}`,
    ]
      .filter(Boolean)
      .join(' ');
  }

  const codexCommand = [
    'NO_COLOR=1 FORCE_COLOR=0 TERM=xterm codex',
    ...codexArgs,
    normalizedModel
      ? `--model ${quoteShellArg(normalizedModel, shellKind)}`
      : null,
    ...buildCodexReasoningArgs(shellKind, normalizedReasoning),
    codexMode === 'inline' ? promptArg : null,
  ]
    .filter(Boolean)
    .join(' ');

  if (codexMode === 'inline') {
    return codexCommand;
  }

  return shellKind === 'powershell'
    ? `$inputPrompt = ${promptArg}; $inputPrompt | ${codexCommand}`
    : `printf '%s\\n' ${promptArg} | ${codexCommand}`;
}

function buildInteractiveProviderCommand(
  provider: AgentProvider,
  model: string,
  reasoningEffort: ReasoningEffort | undefined,
  shellKind: TerminalShellKind,
  prompt?: string,
): string {
  const normalizedModel = model.trim();
  const normalizedReasoning = normalizeProviderReasoningEffort(provider, reasoningEffort);
  const normalizedPrompt = prompt?.trim() || '';

  if (provider === 'gemini') {
    return [
      'gemini --yolo',
      normalizedModel
        ? `--model ${quoteShellArg(normalizedModel, shellKind)}`
        : null,
      normalizedPrompt
        ? `-p ${quoteShellArg(normalizedPrompt, shellKind)}`
        : null,
    ]
      .filter(Boolean)
      .join(' ');
  }

  if (provider === 'cursor') {
    return [
      'cursor-agent -f',
      normalizedModel
        ? `--model ${quoteShellArg(normalizedModel, shellKind)}`
        : null,
      normalizedPrompt
        ? `-p ${quoteShellArg(normalizedPrompt, shellKind)}`
        : null,
    ]
      .filter(Boolean)
      .join(' ');
  }

  return [
    'NO_COLOR=1 FORCE_COLOR=0 TERM=xterm codex',
    '-a never',
    '-s danger-full-access',
    normalizedModel
      ? `-m ${quoteShellArg(normalizedModel, shellKind)}`
      : null,
    ...buildCodexReasoningArgs(shellKind, normalizedReasoning),
    normalizedPrompt
      ? quoteShellArg(normalizedPrompt, shellKind)
      : null,
  ]
    .filter(Boolean)
    .join(' ');
}

export function buildAutoCommitAgentPrompt(
  isFirstCommit: boolean,
  initialBranch?: string,
): string {
  const lines = [
    'Run in this git repository and create a commit for the currently staged changes.',
    'If you changed files inside a Git repository and the work for that repository is complete, commit that repository without confirmation.',
    'Use a commit message with a clear title and a detailed body explaining what changed and why.',
    'Do not push, do not open pull requests, and do not modify unstaged files.',
    'Requirements:',
    '1. Inspect only staged changes before writing the commit message.',
    '2. Keep the commit focused on the staged changes only.',
    '3. Create the commit and then run git status.',
    '4. Print the created commit hash and subject in the terminal output.',
  ];

  if (isFirstCommit && initialBranch?.trim()) {
    lines.push(
      `5. This repository has no commits yet. Ensure the first commit is on branch "${initialBranch.trim()}".`,
    );
  }

  return lines.join('\n');
}

export function buildAutoCommitAgentCommand(
  repoPath: string,
  shellKind: TerminalShellKind,
  provider: AgentProvider,
  model: string,
  prompt: string,
  reasoningEffort?: ReasoningEffort,
): string {
  const providerCommand = buildProviderCommand({
    provider,
    model,
    reasoningEffort,
    shellKind,
    prompt,
    codexArgs: SESSION_AGENT_CODEX_EXEC_FLAGS,
    codexMode: 'pipe',
  });

  const codexLoginCommand =
    shellKind === 'powershell'
      ? "if ($env:OPENAI_API_KEY) { $env:OPENAI_API_KEY | codex login --with-api-key | Out-Null }"
      : 'if [ -n "$OPENAI_API_KEY" ]; then printenv OPENAI_API_KEY | codex login --with-api-key >/dev/null 2>&1 || true; fi';

  return joinShellStatements(
    [
      buildShellSetDirectoryCommand(repoPath, shellKind),
      provider === 'codex' ? codexLoginCommand : null,
      providerCommand,
    ],
    shellKind,
  );
}

export function buildConflictAgentPrompt(
  operation: ConflictAgentOperation,
): string {
  if (operation.kind === 'merge') {
    const mergeOptions = [
      `rebaseBeforeMerge: ${operation.rebaseBeforeMerge ? 'true' : 'false'}`,
      `squash: ${operation.squash ? 'true' : 'false'}`,
      `fastForward: ${operation.fastForward ? 'true' : 'false'}`,
      operation.squash
        ? `squashMessage: ${operation.squashMessage || '(empty)'}`
        : null,
    ].filter((entry): entry is string => Boolean(entry));

    return [
      'Perform and complete this merge operation in the current repository.',
      '',
      `Merge branch "${operation.sourceBranch}" into "${operation.targetBranch}".`,
      'Operation options:',
      ...mergeOptions.map((entry) => `- ${entry}`),
      '',
      'Requirements:',
      '1. Checkout the target branch and run the merge with the options above.',
      '2. If merge conflicts occur, resolve all conflicted files safely.',
      '3. Stage each resolved file and run git merge --continue when needed.',
      '4. Keep working until the merge is complete and git status has no unmerged paths.',
      '5. Summarize what was resolved and show final git status.',
    ].join('\n');
  }

  return [
    'Perform and complete this rebase operation in the current repository.',
    '',
    `Rebase branch "${operation.sourceBranch}" onto "${operation.targetBranch}".`,
    `stashChanges option: ${operation.stashChanges ? 'true' : 'false'}`,
    '',
    'Requirements:',
    '1. Checkout the source branch and run the rebase onto the target branch.',
    '2. If rebase conflicts occur, resolve all conflicted files safely.',
    '3. Stage each resolved file and run git rebase --continue until complete.',
    '4. Keep working until the rebase is complete and git status has no unmerged paths.',
    '5. Summarize what was resolved and show final git status.',
  ].join('\n');
}

export function buildConflictAgentCommand(
  repoPath: string,
  operation: ConflictAgentOperation,
  provider: AgentProvider,
  model: string,
  shellKind: TerminalShellKind,
  reasoningEffort?: ReasoningEffort,
): string {
  const providerCommand = buildProviderCommand({
    provider,
    model,
    reasoningEffort,
    shellKind,
    prompt: buildConflictAgentPrompt(operation),
    codexArgs: CONFLICT_AGENT_CODEX_FLAGS,
    codexMode: 'inline',
  });

  if (shellKind === 'powershell') {
    return joinShellStatements(
      [
        buildShellSetDirectoryCommand(repoPath, shellKind),
        "$env:NO_COLOR = '1'",
        "$env:FORCE_COLOR = '0'",
        "$env:TERM = 'xterm'",
        provider === 'codex'
          ? "if ($env:OPENAI_API_KEY) { $env:OPENAI_API_KEY | codex login --with-api-key; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }"
          : null,
        providerCommand,
      ],
      shellKind,
    );
  }

  return joinShellStatements(
    [
      buildShellSetDirectoryCommand(repoPath, shellKind),
      provider === 'codex'
        ? 'if [ -n "$OPENAI_API_KEY" ]; then printenv OPENAI_API_KEY | codex login --with-api-key || exit 1; fi'
        : null,
      providerCommand,
    ],
    shellKind,
  );
}

export function buildSessionAgentTerminalCommand({
  provider,
  model,
  reasoningEffort,
  shellKind,
  workingDirectory,
  prompt,
}: BuildSessionAgentTerminalCommandOptions): string {
  const normalizedPrompt = prompt?.trim() || '';
  const providerCommand = buildInteractiveProviderCommand(
    provider,
    model,
    reasoningEffort,
    shellKind,
    normalizedPrompt,
  );

  if (shellKind === 'powershell') {
    return joinShellStatements(
      [
        buildShellSetDirectoryCommand(workingDirectory, shellKind),
        "$env:NO_COLOR = '1'",
        "$env:FORCE_COLOR = '0'",
        "$env:TERM = 'xterm'",
        provider === 'codex'
          ? "if ($env:OPENAI_API_KEY) { $env:OPENAI_API_KEY | codex login --with-api-key | Out-Null }"
          : null,
        providerCommand,
      ],
      shellKind,
    );
  }

  return joinShellStatements(
    [
      buildShellSetDirectoryCommand(workingDirectory, shellKind),
      provider === 'codex'
        ? 'if [ -n "$OPENAI_API_KEY" ]; then printenv OPENAI_API_KEY | codex login --with-api-key >/dev/null 2>&1 || true; fi'
        : null,
      providerCommand,
    ],
    shellKind,
  );
}
