import type { AgentReasoningEffort, ModelOption } from "@/lib/agent/types";

// Palx requires web search in Codex sessions. The Codex API rejects
// reasoning.effort="minimal" when web_search is enabled, so do not expose it.
const GPT5_REASONING: AgentReasoningEffort[] = ["low", "medium", "high"];
const CODEX_REASONING: AgentReasoningEffort[] = ["low", "medium", "high", "xhigh"];
const O3_REASONING: AgentReasoningEffort[] = ["low", "medium", "high"];

const CODEX_MODEL_OPTIONS: ModelOption[] = [
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    description: "Balanced frontier GPT-5 model.",
    reasoningEfforts: CODEX_REASONING,
  },
  {
    id: "gpt-5.3-codex",
    label: "GPT-5.3 Codex",
    description: "Agentic coding model tuned for code tasks.",
    reasoningEfforts: CODEX_REASONING,
  },
  {
    id: "gpt-5.2-codex",
    label: "GPT-5.2 Codex",
    description: "Earlier Codex-tuned GPT-5 model.",
    reasoningEfforts: CODEX_REASONING,
  },
  {
    id: "gpt-5.1-codex-max",
    label: "GPT-5.1 Codex Max",
    description: "High-capability Codex variant.",
    reasoningEfforts: CODEX_REASONING,
  },
  {
    id: "gpt-5",
    label: "GPT-5",
    description: "General GPT-5 model.",
    reasoningEfforts: GPT5_REASONING,
  },
  {
    id: "o3",
    label: "o3",
    description: "Reasoning-focused model.",
    reasoningEfforts: O3_REASONING,
  },
];

export function getCodexModelOptions(configuredModel: string | null): ModelOption[] {
  if (!configuredModel || CODEX_MODEL_OPTIONS.some((model) => model.id === configuredModel)) {
    return CODEX_MODEL_OPTIONS;
  }

  return [
    {
      id: configuredModel,
      label: configuredModel,
      description: "Configured locally in ~/.codex/config.toml.",
      reasoningEfforts: undefined,
    },
    ...CODEX_MODEL_OPTIONS,
  ];
}
