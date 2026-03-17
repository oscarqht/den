import type {
  QuickCreateDraft,
  ReasoningEffort,
} from '@/lib/types';

export type { QuickCreateDraft, QuickCreateJobUpdatePayload } from '@/lib/types';

export const KNOWN_QUICK_CREATE_REASONING_EFFORTS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly ReasoningEffort[];

export type QuickCreateRoutingSelection = {
  projectPath: string;
  reasoningEffort: ReasoningEffort;
  reason: string;
};

export function deriveQuickCreateTitle(message: string): string {
  const firstNonEmptyLine = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return (firstNonEmptyLine || 'Untitled Quick Create Task').slice(0, 120);
}

export function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const codeFenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (codeFenceMatch?.[1]?.trim()) {
    return codeFenceMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return trimmed.slice(firstBrace, lastBrace + 1);
}

export function parseQuickCreateRoutingSelection(
  responseText: string,
  validProjectPaths: Set<string>,
): QuickCreateRoutingSelection {
  const jsonObject = extractJsonObject(responseText);
  if (!jsonObject) {
    throw new Error('Routing agent did not return JSON.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonObject);
  } catch {
    throw new Error('Routing agent returned invalid JSON.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Routing agent returned an invalid routing payload.');
  }

  const payload = parsed as Record<string, unknown>;
  const projectPath = typeof payload.projectPath === 'string' ? payload.projectPath.trim() : '';
  if (!projectPath || !validProjectPaths.has(projectPath)) {
    throw new Error('Routing agent selected a project that is not available.');
  }

  const normalizedReasoningEffort = typeof payload.reasoningEffort === 'string'
    ? payload.reasoningEffort.trim()
    : '';
  if (
    !normalizedReasoningEffort
    || !KNOWN_QUICK_CREATE_REASONING_EFFORTS.includes(
      normalizedReasoningEffort as (typeof KNOWN_QUICK_CREATE_REASONING_EFFORTS)[number],
    )
  ) {
    throw new Error('Routing agent did not return a valid reasoning effort.');
  }

  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  if (!reason) {
    throw new Error('Routing agent did not explain the project choice.');
  }

  return {
    projectPath,
    reasoningEffort: normalizedReasoningEffort as ReasoningEffort,
    reason,
  };
}

export function sortQuickCreateDrafts(drafts: QuickCreateDraft[]): QuickCreateDraft[] {
  return [...drafts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
