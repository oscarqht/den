import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildQuickCreateSessionPrompt,
  countExplicitProjectMentions,
  deriveQuickCreateTitle,
  extractExplicitProjectMentions,
  parseQuickCreateRoutingSelection,
  shouldUseDirectQuickCreatePrompt,
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

  it('counts explicit project mentions across existing and unresolved names', () => {
    const mentions = extractExplicitProjectMentions(
      'Fix @AI Platform and @ak today.',
      [
        {
          projectId: 'ai',
          projectPath: '/workspace/ai',
          labels: ['AI Platform', 'ai'],
        },
      ],
    );

    assert.equal(countExplicitProjectMentions(mentions), 2);
  });
});

describe('buildQuickCreateSessionPrompt', () => {
  it('passes the original prompt through for a single explicit project mention', () => {
    assert.equal(
      buildQuickCreateSessionPrompt({
        originalMessage: 'Fix @AI Platform checkout bugs.',
        targetProjectName: 'AI Platform',
        explicitMentionCount: 1,
        targetCount: 1,
      }),
      'Fix @AI Platform checkout bugs.',
    );
    assert.equal(
      shouldUseDirectQuickCreatePrompt({ explicitMentionCount: 1, targetCount: 1 }),
      true,
    );
  });

  it('rewrites the prompt when the task is split across multiple projects', () => {
    const prompt = buildQuickCreateSessionPrompt({
      originalMessage: 'Fix @AI Platform and @ak checkout bugs.',
      targetProjectName: 'AI Platform',
      explicitMentionCount: 2,
      targetCount: 2,
    });

    assert.match(prompt, /split into 2 project-specific sessions/i);
    assert.match(prompt, /only for project "AI Platform"/i);
    assert.match(prompt, /Original user request:/);
    assert.match(prompt, /Fix @AI Platform and @ak checkout bugs\./);
  });

  it('rewrites the prompt when routing inferred the target project', () => {
    const prompt = buildQuickCreateSessionPrompt({
      originalMessage: 'Fix the checkout bugs.',
      targetProjectName: 'AI Platform',
      explicitMentionCount: 0,
      targetCount: 1,
    });

    assert.match(prompt, /routed to project "AI Platform"/i);
    assert.match(prompt, /do not assume they are visible in this session/i);
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
