import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  deriveQuickCreateTitle,
  extractExplicitProjectMentions,
  parseQuickCreateRoutingSelection,
} from './quick-create.ts';

describe('parseQuickCreateRoutingSelection', () => {
  it('parses a valid routing payload with multiple targets', () => {
    const result = parseQuickCreateRoutingSelection(
      JSON.stringify({
        targets: [
          {
            type: 'existing',
            projectId: 'app',
            projectPath: '/workspace/app',
            reason: 'The task references the app project.',
          },
          {
            type: 'new',
            projectName: 'ak',
            reason: 'The user requested work for a missing project.',
          },
        ],
        reasoningEffort: 'high',
        reason: 'The task spans an existing project and one new project.',
      }),
      new Map([['app', '/workspace/app']]),
    );

    assert.deepStrictEqual(result, {
      targets: [
        {
          type: 'existing',
          projectId: 'app',
          projectPath: '/workspace/app',
          reason: 'The task references the app project.',
        },
        {
          type: 'new',
          projectName: 'ak',
          reason: 'The user requested work for a missing project.',
        },
      ],
      reasoningEffort: 'high',
      reason: 'The task spans an existing project and one new project.',
    });
  });

  it('rejects invalid JSON responses', () => {
    assert.throws(() => parseQuickCreateRoutingSelection('not json', new Map()), /did not return json/i);
  });

  it('rejects payloads without reasoning effort', () => {
    assert.throws(
      () => parseQuickCreateRoutingSelection(
        '{"targets":[{"type":"new","projectName":"ak","reason":"Create it."}],"reason":"Most relevant repo."}',
        new Map(),
      ),
      /reasoning effort/i,
    );
  });
});

describe('extractExplicitProjectMentions', () => {
  it('matches explicit existing project mentions and preserves unresolved names', () => {
    const result = extractExplicitProjectMentions(
      'Fix @AI Platform and @ak today.',
      [
        {
          projectId: 'ai',
          projectPath: '/workspace/ai',
          labels: ['AI Platform', 'ai'],
        },
      ],
    );

    assert.deepStrictEqual(result, {
      existingTargets: [
        {
          projectId: 'ai',
          projectPath: '/workspace/ai',
          matchedLabel: 'AI Platform',
        },
      ],
      newProjectNames: ['ak'],
    });
  });
});

describe('deriveQuickCreateTitle', () => {
  it('uses the first non-empty line', () => {
    assert.equal(
      deriveQuickCreateTitle('\n\nFix checkout total on mobile\nInvestigate tax bug'),
      'Fix checkout total on mobile',
    );
  });
});
