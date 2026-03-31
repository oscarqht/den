import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatPathsForAgentInput,
  insertPathsIntoAgentInput,
  shouldAutoStartSessionCanvasAgentTurn,
} from './session-canvas-agent.ts';

describe('session canvas agent helpers', () => {
  it('formats and inserts unique absolute paths into the agent input handle', () => {
    const calls: string[] = [];
    const inserted = insertPathsIntoAgentInput({
      insertText(text: string) {
        calls.push(text);
        return true;
      },
    }, [
      ' /tmp/workspace/src/app.tsx ',
      '/tmp/workspace/src/app.tsx',
      '/tmp/workspace/README.md',
    ]);

    assert.equal(inserted, true);
    assert.deepEqual(calls, ['/tmp/workspace/src/app.tsx /tmp/workspace/README.md ']);
  });

  it('returns false when there is no usable handle or path input', () => {
    assert.equal(insertPathsIntoAgentInput(null, ['/tmp/workspace/src/app.tsx']), false);
    assert.equal(insertPathsIntoAgentInput({
      insertText() {
        throw new Error('should not be called');
      },
    }, ['   ']), false);
    assert.equal(formatPathsForAgentInput(['   ']), '');
  });

  it('auto-starts only for fresh sessions with a prompt and no existing run state', () => {
    assert.equal(shouldAutoStartSessionCanvasAgentTurn({
      initialized: false,
      initialPrompt: 'Start the task',
      runState: null,
    }), true);

    assert.equal(shouldAutoStartSessionCanvasAgentTurn({
      initialized: false,
      initialPrompt: 'Start the task',
      runState: 'idle',
    }), true);

    assert.equal(shouldAutoStartSessionCanvasAgentTurn({
      initialized: true,
      initialPrompt: 'Start the task',
      runState: null,
    }), false);

    assert.equal(shouldAutoStartSessionCanvasAgentTurn({
      initialized: false,
      initialPrompt: '   ',
      runState: null,
    }), false);

    assert.equal(shouldAutoStartSessionCanvasAgentTurn({
      initialized: false,
      initialPrompt: 'Start the task',
      runState: 'queued',
    }), false);
  });
});
