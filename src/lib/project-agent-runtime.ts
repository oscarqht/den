import { normalizeProviderReasoningEffort } from './agent/reasoning.ts';
import type { AgentProvider, ReasoningEffort } from './types.ts';

type ProjectAgentSettings = {
  agentProvider?: AgentProvider;
  agentModel?: string;
  agentReasoningEffort?: ReasoningEffort;
  startupScript?: string;
  devServerScript?: string;
  alias?: string | null;
};

type ProjectAgentRuntimeConfig = {
  defaultAgentProvider?: AgentProvider;
  defaultAgentModel?: string;
  defaultAgentReasoningEffort?: ReasoningEffort;
  projectSettings: Record<string, ProjectAgentSettings>;
};

function normalizeAgentProvider(value: string | null | undefined): AgentProvider {
  return value === 'codex' || value === 'gemini' || value === 'cursor' ? value : 'codex';
}

export function getEffectiveProjectAgentRuntimeSettings(
  config: ProjectAgentRuntimeConfig,
  projectKey: string,
) {
  const projectSettings = config.projectSettings[projectKey] || {};
  const resolvedProvider = normalizeAgentProvider(
    projectSettings.agentProvider ?? config.defaultAgentProvider,
  );
  const canUseProviderDefaults = !projectSettings.agentProvider
    || config.defaultAgentProvider === resolvedProvider;
  const resolvedModel = projectSettings.agentModel
    ?? (canUseProviderDefaults ? (config.defaultAgentModel ?? '') : '');
  const resolvedReasoningEffort = normalizeProviderReasoningEffort(
    resolvedProvider,
    projectSettings.agentReasoningEffort
      ?? (canUseProviderDefaults ? config.defaultAgentReasoningEffort : undefined),
  ) || '';

  return {
    provider: resolvedProvider,
    model: resolvedModel,
    reasoningEffort: resolvedReasoningEffort,
    projectSettings,
  };
}
