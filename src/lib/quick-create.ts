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
  targets: QuickCreateRoutingTarget[];
  reasoningEffort: ReasoningEffort;
  reason: string;
};

export type QuickCreateRoutingTarget =
  | {
      type: 'existing';
      projectId: string;
      projectPath: string;
      reason: string;
    }
  | {
      type: 'new';
      projectName: string;
      reason: string;
    };

export type QuickCreateProjectMentionCandidate = {
  projectId: string;
  projectPath: string;
  labels: string[];
};

export type QuickCreateExplicitProjectMentions = {
  existingTargets: Array<{
    projectId: string;
    projectPath: string;
    matchedLabel: string;
  }>;
  newProjectNames: string[];
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

function isMentionBoundaryCharacter(value: string | undefined): boolean {
  return !value || /[\s([{"'`.,!?;:/\\|<>+=-]/.test(value);
}

function isMentionLabelBoundary(value: string | undefined): boolean {
  return !value || /[\s)\]}.,!?;:'"`/\\|<>+=-]/.test(value);
}

export function extractExplicitProjectMentions(
  message: string,
  candidates: QuickCreateProjectMentionCandidate[],
): QuickCreateExplicitProjectMentions {
  if (!message.trim()) {
    return {
      existingTargets: [],
      newProjectNames: [],
    };
  }

  const uniqueCandidates = candidates
    .map((candidate) => ({
      ...candidate,
      labels: Array.from(new Set(candidate.labels.map((label) => label.trim()).filter(Boolean))),
    }))
    .filter((candidate) => candidate.labels.length > 0)
    .sort((left, right) => {
      const leftLength = Math.max(...left.labels.map((label) => label.length));
      const rightLength = Math.max(...right.labels.map((label) => label.length));
      return rightLength - leftLength;
    });

  const existingTargets: QuickCreateExplicitProjectMentions['existingTargets'] = [];
  const existingTargetIds = new Set<string>();
  const newProjectNames: string[] = [];
  const newProjectNameSet = new Set<string>();

  for (let index = 0; index < message.length; index += 1) {
    if (message[index] !== '@') continue;
    if (!isMentionBoundaryCharacter(message[index - 1])) continue;

    const remainder = message.slice(index + 1);
    const lowerRemainder = remainder.toLowerCase();
    const matchingCandidate = uniqueCandidates.find((candidate) => (
      candidate.labels.some((label) => {
        const normalizedLabel = label.toLowerCase();
        if (!lowerRemainder.startsWith(normalizedLabel)) {
          return false;
        }
        return isMentionLabelBoundary(remainder[label.length]);
      })
    ));

    if (matchingCandidate) {
      if (!existingTargetIds.has(matchingCandidate.projectId)) {
        existingTargetIds.add(matchingCandidate.projectId);
        existingTargets.push({
          projectId: matchingCandidate.projectId,
          projectPath: matchingCandidate.projectPath,
          matchedLabel: matchingCandidate.labels[0]!,
        });
      }
      continue;
    }

    const tokenMatch = remainder.match(/^([^\s.,!?;:()[\]{}"'`/\\|<>+=]+)/);
    const unresolvedName = tokenMatch?.[1]?.trim();
    if (!unresolvedName) continue;

    const normalizedUnresolvedName = unresolvedName.toLowerCase();
    if (newProjectNameSet.has(normalizedUnresolvedName)) continue;
    newProjectNameSet.add(normalizedUnresolvedName);
    newProjectNames.push(unresolvedName);
  }

  return {
    existingTargets,
    newProjectNames,
  };
}

export function parseQuickCreateRoutingSelection(
  responseText: string,
  validProjects: Map<string, string>,
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

  const rawTargets = Array.isArray(payload.targets)
    ? payload.targets
    : ((typeof payload.projectId === 'string' || typeof payload.projectPath === 'string')
        ? [payload]
        : []);
  if (rawTargets.length === 0) {
    throw new Error('Routing agent did not return any target projects.');
  }

  const targets = rawTargets.map((entry): QuickCreateRoutingTarget => {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Routing agent returned an invalid target.');
    }

    const targetPayload = entry as Record<string, unknown>;
    const type = typeof targetPayload.type === 'string'
      ? targetPayload.type.trim().toLowerCase()
      : (typeof targetPayload.kind === 'string' ? targetPayload.kind.trim().toLowerCase() : 'existing');

    const targetReason = typeof targetPayload.reason === 'string' ? targetPayload.reason.trim() : '';
    if (!targetReason) {
      throw new Error('Routing agent did not explain a target choice.');
    }

    if (type === 'new') {
      const projectName = typeof targetPayload.projectName === 'string'
        ? targetPayload.projectName.trim()
        : '';
      if (!projectName) {
        throw new Error('Routing agent returned an invalid new project target.');
      }

      return {
        type: 'new',
        projectName,
        reason: targetReason,
      };
    }

    const projectId = typeof targetPayload.projectId === 'string' ? targetPayload.projectId.trim() : '';
    const validProjectPath = validProjects.get(projectId);
    if (!projectId || !validProjectPath) {
      throw new Error('Routing agent selected a project that is not available.');
    }

    const projectPath = typeof targetPayload.projectPath === 'string'
      ? targetPayload.projectPath.trim()
      : validProjectPath;
    if (projectPath && projectPath !== validProjectPath) {
      throw new Error('Routing agent returned an unexpected project path.');
    }

    return {
      type: 'existing',
      projectId,
      projectPath: validProjectPath,
      reason: targetReason,
    };
  });

  return {
    targets,
    reasoningEffort: normalizedReasoningEffort as ReasoningEffort,
    reason,
  };
}

export function sortQuickCreateDrafts(drafts: QuickCreateDraft[]): QuickCreateDraft[] {
  return [...drafts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
