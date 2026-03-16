import type { PlanStep } from '../types.ts';

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizePlanStepStatus(value: unknown): string {
  const normalized = trimText(value)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  switch (normalized) {
    case '':
      return 'pending';
    case 'running':
      return 'in_progress';
    case 'done':
      return 'completed';
    case 'canceled':
      return 'cancelled';
    default:
      return normalized;
  }
}

export function normalizePlanSteps(value: unknown): PlanStep[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((step) => {
    if (!step || typeof step !== 'object') {
      return [];
    }

    const current = step as Record<string, unknown>;
    const title = trimText(current.title)
      || trimText(current.step)
      || trimText(current.label)
      || trimText(current.content);

    if (!title) {
      return [];
    }

    return [{
      title,
      status: normalizePlanStepStatus(current.status),
    }];
  });
}

export function buildPlanText(steps: PlanStep[]): string {
  return steps
    .map((step) => `${step.status.replace(/_/g, ' ').toUpperCase()} ${step.title}`)
    .join('\n');
}

export function parsePlanStepsFromText(value: string | null | undefined): PlanStep[] {
  const text = trimText(value);
  if (!text) {
    return [];
  }

  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = /^(pending|in[\s_-]?progress|running|completed|done|failed|cancelled|canceled)\s+(.+)$/i.exec(line);
      if (!match) {
        return [];
      }

      return [{
        status: normalizePlanStepStatus(match[1]),
        title: match[2].trim(),
      }];
    });
}
