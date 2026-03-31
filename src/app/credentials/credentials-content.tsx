'use client';

import { getConfig, updateConfig } from '@/app/actions/config';
import {
  listAgentApiCredentials,
  listCredentials,
  removeAgentApiCredential,
  removeCredential,
  saveAgentApiCredential,
  saveGitHubCredential,
  saveGitLabCredential,
} from '@/app/actions/credentials';
import type {
  AgentApiCredential,
  AgentApiCredentialAgent,
} from '@/lib/agent-api-credentials';
import type {
  Credential,
  CredentialType,
  GitLabCredential,
} from '@/lib/credentials';
import { normalizeProviderReasoningEffort } from '@/lib/agent/reasoning';
import { resolveReasoningEffortSelection } from '@/lib/session-reasoning';
import type {
  AgentProvider,
  AppStatus,
  ModelOption,
  ProviderCatalogEntry,
  ReasoningEffort,
} from '@/lib/types';
import { useAppDialog } from '@/hooks/use-app-dialog';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Trash2,
} from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  APP_PAGE_PANEL_CLASS,
  APP_PAGE_TOOLBAR_CLASS,
} from '@/components/app-shell/AppPageSurface';

const DEFAULT_GITLAB_SERVER_URL = 'https://gitlab.com';
const PROVIDER_ICON_URLS = {
  github: 'https://www.google.com/s2/favicons?domain=github.com&sz=64',
  gitlab: 'https://www.google.com/s2/favicons?domain=gitlab.com&sz=64',
} as const;
const AGENT_API_LABELS: Record<AgentApiCredentialAgent, string> = {
  codex: 'Codex CLI',
};
const AGENT_API_KEY_PLACEHOLDERS: Record<AgentApiCredentialAgent, string> = {
  codex: 'sk-...',
};
const AGENT_API_PROXY_PLACEHOLDERS: Record<AgentApiCredentialAgent, string> = {
  codex: 'https://proxy.example.com/v1',
};
const AGENT_API_ORDER: AgentApiCredentialAgent[] = ['codex'];
const SUPPORTED_AGENT_PROVIDERS = ['codex', 'gemini', 'cursor'] as const;
const AGENT_PROVIDER_FALLBACK_LABELS: Record<string, string> = {
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  cursor: 'Cursor Agent CLI',
};
const DEFAULT_MODEL_OPTION: ModelOption = {
  id: '',
  label: 'Default model',
  description: 'Use the provider default model.',
};

type FlashMessage = {
  tone: 'success' | 'error';
  text: string;
} | null;

type AgentStatusResponse = {
  providers?: ProviderCatalogEntry[];
  defaultProvider?: AgentProvider;
  status: AppStatus | null;
  error?: string;
};

function formatCredentialSubtitle(credential: Credential): string {
  if (credential.type === 'gitlab') {
    return `${credential.username} @ ${credential.serverUrl}`;
  }
  return credential.username;
}

function formatProviderLabel(type: CredentialType): string {
  return type === 'github' ? 'GitHub' : 'GitLab';
}

function ProviderIcon({ type }: { type: CredentialType }) {
  return (
    <Image
      src={PROVIDER_ICON_URLS[type]}
      alt={`${formatProviderLabel(type)} icon`}
      width={20}
      height={20}
      className="h-5 w-5 rounded-sm"
      unoptimized
    />
  );
}

function normalizeAgentProvider(value: string | null | undefined): AgentProvider {
  return value === 'codex' || value === 'gemini' || value === 'cursor'
    ? value
    : 'codex';
}

function agentProviderLabel(
  provider: string,
  providers: ProviderCatalogEntry[] = [],
): string {
  return providers.find((entry) => entry.id === provider)?.label
    || AGENT_PROVIDER_FALLBACK_LABELS[provider]
    || provider;
}

export default function SettingsContent() {
  const router = useRouter();

  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [agentApiCredentials, setAgentApiCredentials] = useState<
    AgentApiCredential[]
  >([]);
  const [loading, setLoading] = useState(true);

  const [githubToken, setGitHubToken] = useState('');
  const [gitlabToken, setGitLabToken] = useState('');
  const [gitlabServerUrl, setGitLabServerUrl] = useState(
    DEFAULT_GITLAB_SERVER_URL,
  );
  const [agentApiKeyInputs, setAgentApiKeyInputs] = useState<
    Record<AgentApiCredentialAgent, string>
  >({
    codex: '',
  });
  const [agentApiProxyInputs, setAgentApiProxyInputs] = useState<
    Record<AgentApiCredentialAgent, string>
  >({
    codex: '',
  });

  const [savingType, setSavingType] = useState<CredentialType | null>(null);
  const [savingAgent, setSavingAgent] =
    useState<AgentApiCredentialAgent | null>(null);
  const [savingAgentDefaults, setSavingAgentDefaults] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingAgent, setDeletingAgent] =
    useState<AgentApiCredentialAgent | null>(null);
  const [agentProviders, setAgentProviders] = useState<ProviderCatalogEntry[]>([]);
  const [selectedDefaultAgentProvider, setSelectedDefaultAgentProvider] =
    useState<AgentProvider>('codex');
  const [selectedDefaultAgentModel, setSelectedDefaultAgentModel] =
    useState('');
  const [selectedDefaultAgentReasoningEffort, setSelectedDefaultAgentReasoningEffort] =
    useState<ReasoningEffort | ''>('');
  const [agentStatus, setAgentStatus] = useState<AppStatus | null>(null);
  const [loadingAgentStatus, setLoadingAgentStatus] = useState(false);
  const [agentDefaultsError, setAgentDefaultsError] = useState<string | null>(null);
  const [flashMessage, setFlashMessage] = useState<FlashMessage>(null);
  const { confirm: confirmDialog, dialog } = useAppDialog();

  const githubCredentials = useMemo(
    () => credentials.filter((credential) => credential.type === 'github'),
    [credentials],
  );

  const gitlabCredentials = useMemo(
    () =>
      credentials.filter(
        (credential) => credential.type === 'gitlab',
      ) as GitLabCredential[],
    [credentials],
  );

  const agentApiCredentialMap = useMemo(() => {
    return new Map(
      agentApiCredentials.map((credential) => [credential.agent, credential]),
    );
  }, [agentApiCredentials]);

  const fetchAgentStatus = async (provider: AgentProvider) => {
    setLoadingAgentStatus(true);
    setAgentDefaultsError(null);

    try {
      const response = await fetch(
        `/api/agent/status?provider=${encodeURIComponent(provider)}`,
        { cache: 'no-store' },
      );
      const payload =
        (await response.json().catch(() => null)) as AgentStatusResponse | null;
      if (!payload) {
        throw new Error('Failed to load agent runtime status.');
      }

      setAgentProviders(payload.providers ?? []);
      setAgentStatus(payload.status);
      setAgentDefaultsError(payload.error ?? null);
    } catch (error) {
      console.error('Failed to load default agent status:', error);
      setAgentProviders([]);
      setAgentStatus(null);
      setAgentDefaultsError(
        error instanceof Error
          ? error.message
          : 'Failed to load agent runtime status.',
      );
    } finally {
      setLoadingAgentStatus(false);
    }
  };

  const reloadCredentials = async () => {
    const [gitResult, agentResult] = await Promise.all([
      listCredentials(),
      listAgentApiCredentials(),
    ]);

    if (!gitResult.success) {
      setFlashMessage({ tone: 'error', text: gitResult.error });
      setLoading(false);
      return;
    }

    if (!agentResult.success) {
      setFlashMessage({ tone: 'error', text: agentResult.error });
      setLoading(false);
      return;
    }

    setCredentials(gitResult.credentials);
    setAgentApiCredentials(agentResult.credentials);
    setAgentApiProxyInputs((previous) => {
      const next = { ...previous };
      for (const agent of AGENT_API_ORDER) {
        next[agent] =
          agentResult.credentials.find(
            (credential) => credential.agent === agent,
          )?.apiProxy || '';
      }
      return next;
    });
    setLoading(false);
  };

  useEffect(() => {
    let isActive = true;

    void (async () => {
      const [gitResult, agentResult, config] = await Promise.all([
        listCredentials(),
        listAgentApiCredentials(),
        getConfig(),
      ]);
      if (!isActive) return;

      if (!gitResult.success) {
        setFlashMessage({ tone: 'error', text: gitResult.error });
        setLoading(false);
        return;
      }

      if (!agentResult.success) {
        setFlashMessage({ tone: 'error', text: agentResult.error });
        setLoading(false);
        return;
      }

      setCredentials(gitResult.credentials);
      setAgentApiCredentials(agentResult.credentials);
      setAgentApiProxyInputs((previous) => {
        const next = { ...previous };
        for (const agent of AGENT_API_ORDER) {
          next[agent] =
            agentResult.credentials.find(
              (credential) => credential.agent === agent,
            )?.apiProxy || '';
        }
        return next;
      });
      const resolvedProvider = normalizeAgentProvider(
        config.defaultAgentProvider,
      );
      setSelectedDefaultAgentProvider(resolvedProvider);
      setSelectedDefaultAgentModel(config.defaultAgentModel || '');
      setSelectedDefaultAgentReasoningEffort(
        normalizeProviderReasoningEffort(
          resolvedProvider,
          config.defaultAgentReasoningEffort,
        ) || '',
      );
      setLoading(false);
    })();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    void fetchAgentStatus(selectedDefaultAgentProvider);
  }, [selectedDefaultAgentProvider]);

  const displayedAgentProviders = useMemo(
    () =>
      agentProviders.length > 0
        ? agentProviders.filter((provider) => provider.available)
        : SUPPORTED_AGENT_PROVIDERS.map((provider) => ({
            id: provider,
            label: agentProviderLabel(provider),
            description: '',
            available: true,
          })),
    [agentProviders],
  );

  const modelOptions = useMemo(() => {
    const models = agentStatus?.models ?? [];
    const options = [DEFAULT_MODEL_OPTION, ...models];
    if (
      selectedDefaultAgentModel.trim()
      && !options.some((entry) => entry.id === selectedDefaultAgentModel)
    ) {
      options.push({
        id: selectedDefaultAgentModel,
        label: selectedDefaultAgentModel,
        description: 'Currently saved model.',
      });
    }
    return options;
  }, [agentStatus?.models, selectedDefaultAgentModel]);

  const effectiveDefaultModelId = useMemo(
    () =>
      selectedDefaultAgentModel
      || agentStatus?.defaultModel
      || agentStatus?.models[0]?.id
      || '',
    [agentStatus?.defaultModel, agentStatus?.models, selectedDefaultAgentModel],
  );

  const selectedModelOption = useMemo(
    () =>
      modelOptions.find((entry) => entry.id === effectiveDefaultModelId)
      || DEFAULT_MODEL_OPTION,
    [effectiveDefaultModelId, modelOptions],
  );

  const reasoningEffortOptions = useMemo(() => {
    if (selectedDefaultAgentProvider !== 'codex') return [];
    return selectedModelOption.reasoningEfforts || [];
  }, [selectedDefaultAgentProvider, selectedModelOption]);

  useEffect(() => {
    if (selectedDefaultAgentProvider !== 'codex') {
      if (selectedDefaultAgentReasoningEffort) {
        setSelectedDefaultAgentReasoningEffort('');
      }
      return;
    }

    const nextReasoning = resolveReasoningEffortSelection(
      reasoningEffortOptions,
      '',
      selectedDefaultAgentReasoningEffort,
    );
    if (nextReasoning !== selectedDefaultAgentReasoningEffort) {
      setSelectedDefaultAgentReasoningEffort(nextReasoning);
    }
  }, [
    reasoningEffortOptions,
    selectedDefaultAgentProvider,
    selectedDefaultAgentReasoningEffort,
  ]);

  const handleSaveGitHub = async () => {
    setFlashMessage(null);
    setSavingType('github');

    const result = await saveGitHubCredential(githubToken);
    if (!result.success) {
      setFlashMessage({ tone: 'error', text: result.error });
      setSavingType(null);
      return;
    }

    setGitHubToken('');
    setFlashMessage({ tone: 'success', text: 'GitHub credential added.' });
    await reloadCredentials();
    setSavingType(null);
  };

  const handleSaveGitLab = async () => {
    setFlashMessage(null);
    setSavingType('gitlab');

    const result = await saveGitLabCredential(gitlabServerUrl, gitlabToken);
    if (!result.success) {
      setFlashMessage({ tone: 'error', text: result.error });
      setSavingType(null);
      return;
    }

    setGitLabToken('');
    setFlashMessage({ tone: 'success', text: 'GitLab credential added.' });
    await reloadCredentials();
    setSavingType(null);
  };

  const handleSaveAgentApi = async (agent: AgentApiCredentialAgent) => {
    setFlashMessage(null);
    setSavingAgent(agent);

    const result = await saveAgentApiCredential(
      agent,
      agentApiKeyInputs[agent],
      agentApiProxyInputs[agent],
    );
    if (!result.success) {
      setFlashMessage({ tone: 'error', text: result.error });
      setSavingAgent(null);
      return;
    }

    setAgentApiKeyInputs((previous) => ({ ...previous, [agent]: '' }));
    setAgentApiProxyInputs((previous) => ({
      ...previous,
      [agent]: result.credential.apiProxy || '',
    }));
    setFlashMessage({
      tone: 'success',
      text: `${AGENT_API_LABELS[agent]} credential saved.`,
    });
    await reloadCredentials();
    setSavingAgent(null);
  };

  const handleSaveAgentDefaults = async () => {
    setFlashMessage(null);
    setSavingAgentDefaults(true);

    try {
      const normalizedReasoning =
        selectedDefaultAgentProvider === 'codex'
          ? normalizeProviderReasoningEffort(
              selectedDefaultAgentProvider,
              selectedDefaultAgentReasoningEffort,
            )
          : undefined;
      const nextConfig = await updateConfig({
        defaultAgentProvider: selectedDefaultAgentProvider,
        defaultAgentModel: selectedDefaultAgentModel || undefined,
        defaultAgentReasoningEffort: normalizedReasoning,
      });
      const resolvedProvider = normalizeAgentProvider(
        nextConfig.defaultAgentProvider,
      );
      setSelectedDefaultAgentProvider(resolvedProvider);
      setSelectedDefaultAgentModel(nextConfig.defaultAgentModel || '');
      setSelectedDefaultAgentReasoningEffort(
        normalizeProviderReasoningEffort(
          resolvedProvider,
          nextConfig.defaultAgentReasoningEffort,
        ) || '',
      );
      setFlashMessage({
        tone: 'success',
        text: 'Default coding agent settings saved.',
      });
    } catch (error) {
      console.error('Failed to save default agent settings:', error);
      setFlashMessage({
        tone: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Failed to save default agent settings.',
      });
    } finally {
      setSavingAgentDefaults(false);
    }
  };

  const handleDelete = async (credential: Credential) => {
    const providerLabel = formatProviderLabel(credential.type);
    const confirmed = await confirmDialog({
      title: `Delete ${providerLabel} credential?`,
      description: `Delete the saved credential for ${formatCredentialSubtitle(credential)}?`,
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    setFlashMessage(null);
    setDeletingId(credential.id);

    const result = await removeCredential(credential.id);
    if (!result.success) {
      setFlashMessage({ tone: 'error', text: result.error });
      setDeletingId(null);
      return;
    }

    setFlashMessage({
      tone: 'success',
      text: `${providerLabel} credential deleted.`,
    });
    await reloadCredentials();
    setDeletingId(null);
  };

  const handleDeleteAgentApi = async (agent: AgentApiCredentialAgent) => {
    const confirmed = await confirmDialog({
      title: `Delete ${AGENT_API_LABELS[agent]} credential?`,
      description: `Delete the saved ${AGENT_API_LABELS[agent]} API credential?`,
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    setFlashMessage(null);
    setDeletingAgent(agent);

    const result = await removeAgentApiCredential(agent);
    if (!result.success) {
      setFlashMessage({ tone: 'error', text: result.error });
      setDeletingAgent(null);
      return;
    }

    setAgentApiKeyInputs((previous) => ({ ...previous, [agent]: '' }));
    setAgentApiProxyInputs((previous) => ({ ...previous, [agent]: '' }));
    setFlashMessage({
      tone: 'success',
      text: `${AGENT_API_LABELS[agent]} credential deleted.`,
    });
    await reloadCredentials();
    setDeletingAgent(null);
  };

  const panelClass = `overflow-hidden ${APP_PAGE_PANEL_CLASS}`;
  const sectionHeaderClass =
    'flex flex-col gap-3 border-b border-slate-200/80 bg-white/35 px-5 py-4 md:flex-row md:items-center md:justify-between dark:border-slate-800 dark:bg-slate-950/35';
  const subsectionHeaderClass =
    'flex flex-col gap-3 bg-white/20 px-5 py-4 md:flex-row md:items-center md:justify-between dark:bg-slate-950/20';
  const inputClass =
    'block h-10 w-full rounded-lg border border-slate-200/90 bg-white/85 px-3 text-sm text-slate-900 placeholder-slate-400 transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/85 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-primary/50';
  const secondaryButtonClass =
    'inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-slate-200/90 bg-white/85 px-3 text-[12px] font-medium text-slate-700 shadow-sm transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/85 dark:text-slate-200 dark:hover:bg-slate-800';
  const warningButtonClass =
    'inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 text-[12px] font-medium text-amber-800 shadow-sm transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/25';
  const rowActionButtonClass =
    'inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-all hover:bg-red-50 hover:text-red-500 dark:text-slate-400 dark:hover:bg-red-900/30 dark:hover:text-red-400';

  return (
    <div className="mx-auto w-full max-w-[1380px] space-y-5">
      <div className={`flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 ${APP_PAGE_TOOLBAR_CLASS}`}>
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            onClick={() => router.push('/')}
            aria-label="Back to home"
          >
            <ChevronRight className="h-4 w-4 rotate-180" />
          </button>
          <div className="min-w-0">
            <div className="text-base font-semibold tracking-tight text-slate-900 dark:text-white">
              Settings
            </div>
            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
              Default coding agent preferences, API keys, and service credentials.
            </p>
          </div>
        </div>
      </div>

      {flashMessage && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            flashMessage.tone === 'error'
              ? 'border-red-200 bg-red-50/90 text-red-700 dark:border-red-500/40 dark:bg-red-900/30 dark:text-red-200'
              : 'border-emerald-200 bg-emerald-50/90 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-900/30 dark:text-emerald-200'
          }`}
        >
          {flashMessage.text}
        </div>
      )}

      {loading ? (
        <div className={`${panelClass} p-10`}>
          <div className="flex flex-col items-center gap-3">
            <span className="loading loading-spinner loading-md text-primary"></span>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Loading settings...
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <section className={panelClass}>
            <div className={sectionHeaderClass}>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-sky-100 p-1.5 text-sky-600 dark:border dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-400">
                  <Bot className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                    Coding Agent Defaults
                  </h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Use these defaults for ad-hoc agent tasks and as the
                    fallback when a project has no saved runtime settings.
                  </p>
                </div>
              </div>
              <button
                className={secondaryButtonClass}
                onClick={() => void handleSaveAgentDefaults()}
                disabled={savingAgentDefaults}
              >
                {savingAgentDefaults ? (
                  <span className="loading loading-spinner loading-xs"></span>
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
                Save Defaults
              </button>
            </div>

            <div className="space-y-6 p-5">
              <div
                className={`grid gap-4 ${
                  reasoningEffortOptions.length > 0
                    ? 'md:grid-cols-3'
                    : 'md:grid-cols-2'
                }`}
              >
                <label className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Provider
                  </span>
                  <div className="relative">
                    <select
                      className="h-10 w-full appearance-none rounded-lg border border-slate-300 bg-white/90 px-3 pr-10 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900/85 dark:text-slate-100"
                      value={selectedDefaultAgentProvider}
                      onChange={(event) => {
                        setSelectedDefaultAgentProvider(
                          normalizeAgentProvider(event.target.value),
                        );
                        setSelectedDefaultAgentModel('');
                        setSelectedDefaultAgentReasoningEffort('');
                      }}
                    >
                      {displayedAgentProviders.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-500" />
                  </div>
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Model
                  </span>
                  <div className="relative">
                    <select
                      className="h-10 w-full appearance-none rounded-lg border border-slate-300 bg-white/90 px-3 pr-10 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900/85 dark:text-slate-100"
                      value={selectedDefaultAgentModel}
                      onChange={(event) =>
                        setSelectedDefaultAgentModel(event.target.value)
                      }
                    >
                      {modelOptions.map((model) => (
                        <option key={model.id || 'default-model'} value={model.id}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-500" />
                  </div>
                  {selectedModelOption.description ? (
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      {selectedModelOption.description}
                    </span>
                  ) : null}
                </label>

                {reasoningEffortOptions.length > 0 && (
                  <label className="flex flex-col gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Reasoning Effort
                    </span>
                    <div className="relative">
                      <select
                        className="h-10 w-full appearance-none rounded-lg border border-slate-300 bg-white/90 px-3 pr-10 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900/85 dark:text-slate-100"
                        value={selectedDefaultAgentReasoningEffort}
                        onChange={(event) =>
                          setSelectedDefaultAgentReasoningEffort(
                            event.target.value as ReasoningEffort | '',
                          )
                        }
                      >
                        {reasoningEffortOptions.map((effort) => (
                          <option key={effort} value={effort}>
                            {effort}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-500" />
                    </div>
                  </label>
                )}
              </div>

              <div className="rounded-lg border border-slate-200/90 bg-white/70 px-3 py-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                <div className="space-y-1">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {agentProviderLabel(
                      selectedDefaultAgentProvider,
                      agentProviders,
                    )}
                  </div>
                  <div>
                    {loadingAgentStatus
                      ? 'Checking runtime status...'
                      : agentStatus
                        ? [
                            agentStatus.installed
                              ? 'Installed'
                              : 'Not installed',
                            agentStatus.loggedIn
                              ? 'Logged in'
                              : 'Login required',
                            agentStatus.version
                              ? `v${agentStatus.version}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' • ')
                        : 'Runtime status unavailable'}
                  </div>
                  <div>
                    Effective model:{' '}
                    {effectiveDefaultModelId || 'Provider default'}
                  </div>
                </div>
                {agentDefaultsError ? (
                  <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
                    {agentDefaultsError}
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className={panelClass}>
            <div className={sectionHeaderClass}>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-amber-100 p-1.5 text-amber-600 dark:border dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">
                  <KeyRound className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                    Credentials
                  </h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Manage Git access tokens and agent API credentials stored in
                    your local keychain.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <div className={subsectionHeaderClass}>
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                    GitHub Credentials
                  </h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Access private repositories and Gists.
                  </p>
                </div>
                <button
                  className={secondaryButtonClass}
                  onClick={() => void handleSaveGitHub()}
                  disabled={savingType === 'github'}
                >
                  {savingType === 'github' ? (
                    <span className="loading loading-spinner loading-xs"></span>
                  ) : (
                    <KeyRound className="h-4 w-4" />
                  )}
                  Add Token
                </button>
              </div>
              <div className="bg-slate-50/20 px-5 py-4 dark:bg-slate-950/20">
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Personal Access Token
                </label>
                <input
                  type="password"
                  className={inputClass}
                  placeholder="ghp_xxx"
                  value={githubToken}
                  onChange={(event) => setGitHubToken(event.target.value)}
                  disabled={savingType === 'github'}
                />
              </div>
                {githubCredentials.length === 0 ? (
                  <div className="px-6 py-6 text-sm text-slate-500 dark:text-slate-400">
                    No GitHub credentials saved.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
                    {githubCredentials.map((credential) => (
                      <div
                        key={credential.id}
                        className="group flex items-center justify-between gap-4 px-6 py-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      >
                        <div className="flex min-w-0 items-center gap-4">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700/60">
                            <ProviderIcon type="github" />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                              {credential.username}
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                              Updated{' '}
                              {new Date(credential.updatedAt).toLocaleString()}
                            </div>
                          </div>
                        </div>
                        <button
                          className={`${rowActionButtonClass} opacity-0 group-hover:opacity-100 disabled:opacity-40`}
                          onClick={() => void handleDelete(credential)}
                          disabled={deletingId === credential.id}
                          title="Delete"
                        >
                          {deletingId === credential.id ? (
                            <span className="loading loading-spinner loading-xs"></span>
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-200 dark:border-slate-700/50">
                <div className={subsectionHeaderClass}>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                      GitLab Credentials
                    </h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Connect to self-hosted or cloud GitLab instances.
                    </p>
                  </div>
                  <button
                    className={secondaryButtonClass}
                    onClick={() => void handleSaveGitLab()}
                    disabled={savingType === 'gitlab'}
                  >
                    {savingType === 'gitlab' ? (
                      <span className="loading loading-spinner loading-xs"></span>
                    ) : (
                      <KeyRound className="h-4 w-4" />
                    )}
                    Add Instance
                  </button>
                </div>

                <div className="space-y-4 bg-slate-50/40 px-6 py-4 dark:bg-slate-900/35">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Server URL
                    </label>
                    <input
                      type="url"
                      className={inputClass}
                      placeholder={DEFAULT_GITLAB_SERVER_URL}
                      value={gitlabServerUrl}
                      onChange={(event) => setGitLabServerUrl(event.target.value)}
                      disabled={savingType === 'gitlab'}
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Personal Access Token
                    </label>
                    <input
                      type="password"
                      className={inputClass}
                      placeholder="glpat-xxx"
                      value={gitlabToken}
                      onChange={(event) => setGitLabToken(event.target.value)}
                      disabled={savingType === 'gitlab'}
                    />
                  </div>
                </div>

                {gitlabCredentials.length === 0 ? (
                  <div className="px-6 py-6 text-sm text-slate-500 dark:text-slate-400">
                    No GitLab credentials saved.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
                    {gitlabCredentials.map((credential) => (
                      <div
                        key={credential.id}
                        className="group flex items-center justify-between gap-4 px-6 py-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      >
                        <div className="flex min-w-0 items-center gap-4">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 dark:border dark:border-orange-500/20 dark:bg-orange-500/10">
                            <ProviderIcon type="gitlab" />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                              {credential.username}
                            </div>
                            <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                              {credential.serverUrl}
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                              Updated{' '}
                              {new Date(credential.updatedAt).toLocaleString()}
                            </div>
                          </div>
                        </div>
                        <button
                          className={`${rowActionButtonClass} opacity-0 group-hover:opacity-100 disabled:opacity-40`}
                          onClick={() => void handleDelete(credential)}
                          disabled={deletingId === credential.id}
                          title="Delete"
                        >
                          {deletingId === credential.id ? (
                            <span className="loading loading-spinner loading-xs"></span>
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {AGENT_API_ORDER.map((agent) => {
              const configuredCredential = agentApiCredentialMap.get(agent);
              const isSaving = savingAgent === agent;
              const isDeleting = deletingAgent === agent;

              return (
                <section key={agent} className={panelClass}>
                  <div className={sectionHeaderClass}>
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-emerald-100 p-1.5 text-emerald-600 dark:border dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400">
                        <KeyRound className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                          {AGENT_API_LABELS[agent]} Configuration
                        </h2>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          Configure access for LLM capabilities.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {configuredCredential && (
                        <button
                          className={warningButtonClass}
                          onClick={() => void handleDeleteAgentApi(agent)}
                          disabled={isSaving || isDeleting}
                        >
                          {isDeleting ? (
                            <span className="loading loading-spinner loading-xs"></span>
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                          Remove
                        </button>
                      )}
                      <button
                        className={secondaryButtonClass}
                        onClick={() => void handleSaveAgentApi(agent)}
                        disabled={isSaving || isDeleting}
                      >
                        {isSaving ? (
                          <span className="loading loading-spinner loading-xs"></span>
                        ) : (
                          <KeyRound className="h-4 w-4" />
                        )}
                        {configuredCredential ? 'Save Changes' : 'Save'}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-6 p-6">
                    <div className="w-full space-y-4">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                          API Key
                        </label>
                        <input
                          type="password"
                          className={inputClass}
                          placeholder={AGENT_API_KEY_PLACEHOLDERS[agent]}
                          value={agentApiKeyInputs[agent]}
                          onChange={(event) =>
                            setAgentApiKeyInputs((previous) => ({
                              ...previous,
                              [agent]: event.target.value,
                            }))
                          }
                          disabled={isSaving || isDeleting}
                        />
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Your API key is stored locally and never shared.
                        </p>
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                          API Proxy{' '}
                          <span className="font-normal text-slate-400 dark:text-slate-500">
                            (Optional)
                          </span>
                        </label>
                        <input
                          type="url"
                          className={inputClass}
                          placeholder={AGENT_API_PROXY_PLACEHOLDERS[agent]}
                          value={agentApiProxyInputs[agent]}
                          onChange={(event) =>
                            setAgentApiProxyInputs((previous) => ({
                              ...previous,
                              [agent]: event.target.value,
                            }))
                          }
                          disabled={isSaving || isDeleting}
                        />
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Override this when using a proxy or a compatible
                          endpoint.
                        </p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                      {configuredCredential ? (
                        <div className="space-y-1">
                          <div>API key configured.</div>
                          <div>
                            Updated{' '}
                            {new Date(
                              configuredCredential.updatedAt,
                            ).toLocaleString()}
                          </div>
                          <div>
                            Proxy{' '}
                            {configuredCredential.apiProxy
                              ? configuredCredential.apiProxy
                              : 'not set'}
                          </div>
                        </div>
                      ) : (
                        <div>No API credential saved.</div>
                      )}
                    </div>
                  </div>
                </section>
              );
            })}

            <div className="pb-2 pt-4 text-center text-xs text-slate-400 dark:text-slate-500">
              Credentials are encrypted at rest using your system keychain.
            </div>
          </div>
        )}
      {dialog}
    </div>
  );
}
