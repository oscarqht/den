import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  buildPlanText,
  normalizePlanStepStatus,
  normalizePlanSteps,
  parsePlanStepsFromText,
} from './plan.ts';

describe('normalizePlanSteps', () => {
  it('accepts step payloads from Codex update_plan events', () => {
    assert.deepStrictEqual(
      normalizePlanSteps([
        { step: 'Inspect session page', status: 'completed' },
        { step: 'Render checklist', status: 'in_progress' },
      ]),
      [
        { title: 'Inspect session page', status: 'completed' },
        { title: 'Render checklist', status: 'in_progress' },
      ],
    );
  });

  it('normalizes alternate status spellings', () => {
    assert.deepStrictEqual(
      normalizePlanSteps([
        { title: 'Apply patch', status: 'running' },
        { content: 'Verify browser', status: 'done' },
      ]),
      [
        { title: 'Apply patch', status: 'in_progress' },
        { title: 'Verify browser', status: 'completed' },
      ],
    );
  });
});

describe('plan text helpers', () => {
  it('builds a readable text fallback from steps', () => {
    assert.equal(
      buildPlanText([
        { title: 'Inspect session page', status: 'completed' },
        { title: 'Render checklist', status: 'in_progress' },
      ]),
      'COMPLETED Inspect session page\nIN PROGRESS Render checklist',
    );
  });

  it('parses text fallbacks back into structured steps', () => {
    assert.deepStrictEqual(
      parsePlanStepsFromText('COMPLETED Inspect session page\nIN PROGRESS Render checklist'),
      [
        { title: 'Inspect session page', status: 'completed' },
        { title: 'Render checklist', status: 'in_progress' },
      ],
    );
  });

  it('maps canceled spellings consistently', () => {
    assert.equal(normalizePlanStepStatus('canceled'), 'cancelled');
  });
});
