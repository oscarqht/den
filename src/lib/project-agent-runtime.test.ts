import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getEffectiveProjectAgentRuntimeSettings } from './project-agent-runtime.ts';

describe('project agent runtime settings', () => {
  it('does not inherit defaults from a different provider', () => {
    const settings = getEffectiveProjectAgentRuntimeSettings({
      defaultAgentProvider: 'codex',
      defaultAgentModel: 'gpt-5.4',
      defaultAgentReasoningEffort: 'low',
      projectSettings: {
        '/workspace/project': {
          agentProvider: 'gemini',
        },
      },
    }, '/workspace/project');

    assert.equal(settings.provider, 'gemini');
    assert.equal(settings.model, '');
    assert.equal(settings.reasoningEffort, '');
  });

  it('inherits defaults when the project has no explicit provider override', () => {
    const settings = getEffectiveProjectAgentRuntimeSettings({
      defaultAgentProvider: 'codex',
      defaultAgentModel: 'gpt-5.4',
      defaultAgentReasoningEffort: 'low',
      projectSettings: {
        '/workspace/project': {},
      },
    }, '/workspace/project');

    assert.equal(settings.provider, 'codex');
    assert.equal(settings.model, 'gpt-5.4');
    assert.equal(settings.reasoningEffort, 'low');
  });
});
