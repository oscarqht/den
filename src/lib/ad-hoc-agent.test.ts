import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAutoCommitAgentCommand,
  buildConflictAgentCommand,
  buildSessionAgentTerminalCommand,
} from './ad-hoc-agent.ts';

describe('ad-hoc agent commands', () => {
  it('adds Codex reasoning overrides to auto-commit commands', () => {
    const command = buildAutoCommitAgentCommand(
      '/tmp/repo',
      'posix',
      'codex',
      'gpt-5.4',
      'Commit the staged changes.',
      'high',
    );

    assert.match(command, /model_reasoning_effort="high"/);
    assert.match(command, /--model 'gpt-5\.4'/);
  });

  it('does not add reasoning overrides for ACP providers', () => {
    const command = buildAutoCommitAgentCommand(
      '/tmp/repo',
      'posix',
      'gemini',
      'gemini-2.5-pro',
      'Commit the staged changes.',
      'high',
    );

    assert.doesNotMatch(command, /model_reasoning_effort/);
    assert.match(command, /gemini --yolo --model 'gemini-2\.5-pro'/);
  });

  it('adds Codex reasoning overrides to conflict-resolution commands', () => {
    const command = buildConflictAgentCommand(
      '/tmp/repo',
      {
        kind: 'rebase',
        sourceBranch: 'feature',
        targetBranch: 'main',
        stashChanges: false,
      },
      'codex',
      'gpt-5.4',
      'posix',
      'medium',
    );

    assert.match(command, /model_reasoning_effort="medium"/);
    assert.match(command, /Rebase branch "feature" onto "main"\./);
  });

  it('builds session agent terminal commands with workspace bootstrap', () => {
    const command = buildSessionAgentTerminalCommand({
      provider: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      shellKind: 'posix',
      workingDirectory: '/tmp/workspace',
      prompt: 'Implement the requested change.',
    });

    assert.match(command, /cd '\/tmp\/workspace'/);
    assert.match(command, /model_reasoning_effort="high"/);
    assert.match(command, /codex .* -m 'gpt-5\.4'/);
    assert.match(command, /'Implement the requested change\.'$/);
    assert.doesNotMatch(command, /exec/);
  });

  it('loads the initial prompt from a file before launching the session agent', () => {
    const command = buildSessionAgentTerminalCommand({
      provider: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      shellKind: 'posix',
      workingDirectory: '/tmp/workspace',
      prompt: 'Implement the requested change.',
      promptFilePath: '/tmp/prompt.txt',
    });

    assert.match(command, /__palx_prompt="\$\(cat '\/tmp\/prompt\.txt'\)"/);
    assert.match(command, /codex .* -m 'gpt-5\.4'/);
    assert.match(command, /"\$__palx_prompt"$/);
    assert.doesNotMatch(command, /'Implement the requested change\.'$/);
  });

  it('builds interactive session agent commands when no initial prompt is provided', () => {
    const command = buildSessionAgentTerminalCommand({
      provider: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
      shellKind: 'posix',
      workingDirectory: '/tmp/workspace',
      prompt: '',
    });

    assert.match(command, /cd '\/tmp\/workspace'/);
    assert.match(command, /codex .* -m 'gpt-5\.4'/);
    assert.doesNotMatch(command, /exec/);
  });

  it('builds PowerShell session agent commands without POSIX env prefixes', () => {
    const command = buildSessionAgentTerminalCommand({
      provider: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      shellKind: 'powershell',
      workingDirectory: 'C:\\workspace',
      prompt: 'Implement the requested change.',
    });

    assert.match(command, /Set-Location -LiteralPath 'C:\\workspace'/);
    assert.match(command, /\$env:NO_COLOR = '1'/);
    assert.match(command, /(?:^|; )codex -a never -s danger-full-access -m 'gpt-5\.4'/);
    assert.doesNotMatch(command, /NO_COLOR=1 FORCE_COLOR=0 TERM=xterm codex/);
  });

  it('builds PowerShell session agent commands that read prompt files via Get-Content', () => {
    const command = buildSessionAgentTerminalCommand({
      provider: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      shellKind: 'powershell',
      workingDirectory: 'C:\\workspace',
      promptFilePath: 'C:\\temp\\prompt.txt',
    });

    assert.match(command, /\$__palxPrompt = Get-Content -Raw -LiteralPath 'C:\\temp\\prompt\.txt'/);
    assert.match(command, /(?:^|; )codex -a never -s danger-full-access -m 'gpt-5\.4'/);
    assert.match(command, /\$__palxPrompt$/);
  });
});
