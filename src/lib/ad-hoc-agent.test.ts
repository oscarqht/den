import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAutoCommitAgentCommand,
  buildConflictAgentCommand,
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
});
