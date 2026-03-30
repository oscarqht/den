import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  sendTerminalDataEvent,
  sendTerminalInput,
  submitTerminalBootstrapCommand,
  type TerminalInputHandle,
} from './terminal-input.ts';

describe('terminal input helpers', () => {
  it('prefers paste for general terminal input when available', () => {
    const calls: string[] = [];
    const term: TerminalInputHandle = {
      paste: (text) => {
        calls.push(`paste:${text}`);
      },
      _core: {
        coreService: {
          triggerDataEvent: (text) => {
            calls.push(`data:${text}`);
          },
        },
      },
    };

    assert.equal(sendTerminalInput(term, 'echo hi'), true);
    assert.deepEqual(calls, ['paste:echo hi']);
  });

  it('sends direct terminal data events when requested', () => {
    const calls: string[] = [];
    const term: TerminalInputHandle = {
      _core: {
        coreService: {
          triggerDataEvent: (text, wasUserInput) => {
            calls.push(`${text}:${String(wasUserInput)}`);
          },
        },
      },
    };

    assert.equal(sendTerminalDataEvent(term, '\r'), true);
    assert.deepEqual(calls, ['\r:true']);
  });

  it('preserves the core service context for direct data events', () => {
    const term: TerminalInputHandle = {
      _core: {
        coreService: {
          _optionsService: { rawOptions: { disableStdin: false } },
          triggerDataEvent(this: {
            _optionsService?: { rawOptions?: { disableStdin?: boolean } };
          }, text, wasUserInput) {
            if (this._optionsService?.rawOptions?.disableStdin) {
              throw new Error('stdin disabled');
            }
            assert.equal(text, 'echo hi\r');
            assert.equal(wasUserInput, true);
          },
        },
      },
    };

    assert.equal(sendTerminalDataEvent(term, 'echo hi\r'), true);
  });

  it('submits bootstrap commands via direct input when supported', () => {
    const calls: string[] = [];
    let enterCalls = 0;
    const term: TerminalInputHandle = {
      paste: (text) => {
        calls.push(`paste:${text}`);
      },
      _core: {
        coreService: {
          triggerDataEvent: (text, wasUserInput) => {
            calls.push(`data:${text}:${String(wasUserInput)}`);
          },
        },
      },
    };

    assert.equal(
      submitTerminalBootstrapCommand(term, 'echo hi', () => {
        enterCalls += 1;
        return true;
      }),
      true,
    );
    assert.deepEqual(calls, ['data:echo hi\r:true']);
    assert.equal(enterCalls, 0);
  });

  it('falls back to paste plus enter when direct input is unavailable', () => {
    const calls: string[] = [];
    let enterCalls = 0;
    const term: TerminalInputHandle = {
      paste: (text) => {
        calls.push(`paste:${text}`);
      },
    };

    assert.equal(
      submitTerminalBootstrapCommand(term, 'echo hi', () => {
        enterCalls += 1;
        return true;
      }),
      true,
    );
    assert.deepEqual(calls, ['paste:echo hi']);
    assert.equal(enterCalls, 1);
  });
});
