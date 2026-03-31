import type { ModelOption, ReasoningEffort } from './types';

function normalizeValue(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function getModelReasoningEffortOptions(
  models: ModelOption[],
  modelId: string | null | undefined,
  fallbackModelId?: string | null,
): ReasoningEffort[] {
  const normalizedModelId = normalizeValue(modelId);
  if (normalizedModelId) {
    const activeModel = models.find((model) => model.id === normalizedModelId);
    return activeModel?.reasoningEfforts?.length ? activeModel.reasoningEfforts : [];
  }

  const normalizedFallbackModelId = normalizeValue(fallbackModelId);
  if (!normalizedFallbackModelId) return [];

  const fallbackModel = models.find((model) => model.id === normalizedFallbackModelId);
  return fallbackModel?.reasoningEfforts?.length ? fallbackModel.reasoningEfforts : [];
}

export function resolveReasoningEffortSelection(
  options: ReasoningEffort[],
  persistedReasoningEffort: string | null | undefined,
  selectedReasoningEffort: string | null | undefined,
): string {
  const normalizedSelection = normalizeValue(selectedReasoningEffort);
  if (options.length === 0) {
    return normalizedSelection || normalizeValue(persistedReasoningEffort);
  }

  if (normalizedSelection && options.includes(normalizedSelection as ReasoningEffort)) {
    return normalizedSelection;
  }

  const normalizedPersisted = normalizeValue(persistedReasoningEffort);
  if (normalizedPersisted && options.includes(normalizedPersisted as ReasoningEffort)) {
    return normalizedPersisted;
  }

  return options[0] || '';
}
