'use client';

import { getConfig } from '@/app/actions/config';
import { startTtydProcess } from '@/app/actions/git';
import { useEscapeDismiss } from '@/hooks/use-escape-dismiss';
import type { TerminalWindow } from '@/hooks/useTerminalLink';
import { normalizeProviderReasoningEffort } from '@/lib/agent/reasoning';
import { buildTtydTerminalSrc, type TerminalShellKind } from '@/lib/terminal-session';
import {
  applyThemeToTerminalWindow,
  resolveShouldUseDarkTheme,
  TERMINAL_THEME_DARK,
  TERMINAL_THEME_LIGHT,
} from '@/lib/ttyd-theme';
import type { AgentProvider, AppStatus, ProviderCatalogEntry, ReasoningEffort } from '@/lib/types';
import { useTheme } from 'next-themes';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

const AGENT_PROVIDER_FALLBACK_LABELS: Record<string, string> = {
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  cursor: 'Cursor Agent CLI',
};

type AgentStatusResponse = {
  providers?: ProviderCatalogEntry[];
  defaultProvider?: AgentProvider;
  status: AppStatus | null;
  error?: string;
};

type BuildAdHocAgentCommandArgs = {
  provider: AgentProvider;
  model: string;
  reasoningEffort?: ReasoningEffort;
  shellKind: TerminalShellKind;
};

export type AdHocAgentTerminalModalProps = {
  isOpen: boolean;
  scenarioKey: string;
  title: string;
  description: ReactNode;
  workingDirectory: string;
  confirmLabel?: string;
  onClose: () => void;
  buildCommand: (args: BuildAdHocAgentCommandArgs) => string;
};

function normalizeProvider(value: string | null | undefined): AgentProvider {
  return value === 'codex' || value === 'gemini' || value === 'cursor'
    ? value
    : 'codex';
}

function providerLabel(provider: string, providers: ProviderCatalogEntry[] = []): string {
  return providers.find((entry) => entry.id === provider)?.label
    || AGENT_PROVIDER_FALLBACK_LABELS[provider]
    || provider;
}

export default function AdHocAgentTerminalModal({
  isOpen,
  title,
  description,
  workingDirectory,
  onClose,
  buildCommand,
}: AdHocAgentTerminalModalProps) {
  const { resolvedTheme } = useTheme();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [agentProviders, setAgentProviders] = useState<ProviderCatalogEntry[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<AgentProvider>('codex');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<ReasoningEffort | ''>('');
  const [agentStatus, setAgentStatus] = useState<AppStatus | null>(null);
  const [isLoadingDefaults, setIsLoadingDefaults] = useState(false);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [terminalSrc, setTerminalSrc] = useState('/terminal');
  const [terminalCommand, setTerminalCommand] = useState('');
  const [terminalProvider, setTerminalProvider] = useState<AgentProvider>('codex');
  const [terminalModel, setTerminalModel] = useState('');
  const [terminalReasoningEffort, setTerminalReasoningEffort] = useState<ReasoningEffort | ''>('');
  const [isLaunching, setIsLaunching] = useState(false);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [isCommandInjected, setIsCommandInjected] = useState(false);
  const [hasStartedTerminal, setHasStartedTerminal] = useState(false);
  const [hasAutoStartAttempted, setHasAutoStartAttempted] = useState(false);

  const resetState = useCallback(() => {
    setTerminalSrc('/terminal');
    setTerminalCommand('');
    setTerminalProvider('codex');
    setTerminalModel('');
    setTerminalReasoningEffort('');
    setTerminalError(null);
    setIsCommandInjected(false);
    setIsLaunching(false);
    setHasStartedTerminal(false);
    iframeRef.current = null;
  }, []);

  useEffect(() => {
    if (!isOpen) {
      resetState();
      return;
    }

    let cancelled = false;

    setIsLoadingDefaults(true);
    setSelectedProvider('codex');
    setSelectedModel('');
    setSelectedReasoningEffort('');
    setStatusError(null);
    setAgentStatus(null);
    setAgentProviders([]);
    setHasAutoStartAttempted(false);
    resetState();

    void (async () => {
      try {
        const config = await getConfig();
        if (cancelled) return;

        const resolvedProvider = normalizeProvider(config.defaultAgentProvider);
        setSelectedProvider(resolvedProvider);
        setSelectedModel(config.defaultAgentModel || '');
        setSelectedReasoningEffort(
          normalizeProviderReasoningEffort(
            resolvedProvider,
            config.defaultAgentReasoningEffort,
          ) || '',
        );
      } catch (error) {
        console.error('Failed to load default ad-hoc agent settings:', error);
        if (!cancelled) {
          setStatusError(
            error instanceof Error
              ? error.message
              : 'Failed to load default agent settings.',
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingDefaults(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, resetState]);

  const fetchAgentStatus = useCallback(async (provider: AgentProvider) => {
    setIsLoadingStatus(true);
    setStatusError(null);

    try {
      const response = await fetch(`/api/agent/status?provider=${encodeURIComponent(provider)}`, {
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null) as AgentStatusResponse | null;
      if (!payload) {
        throw new Error('Failed to load agent runtime status.');
      }

      setAgentProviders(payload.providers ?? []);
      setAgentStatus(payload.status);
      setStatusError(payload.error ?? null);
    } catch (error) {
      console.error('Failed to load ad-hoc agent status:', error);
      setAgentProviders([]);
      setAgentStatus(null);
      setStatusError(error instanceof Error ? error.message : 'Failed to load agent runtime status.');
    } finally {
      setIsLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || isLoadingDefaults) return;
    void fetchAgentStatus(selectedProvider);
  }, [fetchAgentStatus, isLoadingDefaults, isOpen, selectedProvider]);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  useEscapeDismiss(isOpen, handleClose);

  const handleStart = useCallback(async () => {
    setIsLaunching(true);
    setTerminalError(null);
    setIsCommandInjected(false);

    try {
      const ttydResult = await startTtydProcess();
      if (!ttydResult.success) {
        throw new Error(ttydResult.error || 'Failed to start ttyd.');
      }

      const shellKind = ttydResult.shellKind === 'powershell' ? 'powershell' : 'posix';
      const resolvedModel = selectedModel.trim()
        || agentStatus?.defaultModel
        || agentStatus?.models[0]?.id
        || '';
      const resolvedProvider = normalizeProvider(selectedProvider);
      const resolvedReasoningEffort = normalizeProviderReasoningEffort(
        resolvedProvider,
        selectedReasoningEffort,
      );
      const command = buildCommand({
        provider: resolvedProvider,
        model: resolvedModel,
        reasoningEffort: resolvedReasoningEffort,
        shellKind,
      });

      setTerminalProvider(resolvedProvider);
      setTerminalModel(resolvedModel);
      setTerminalReasoningEffort(resolvedReasoningEffort || '');
      setTerminalCommand(command);
      setTerminalSrc(buildTtydTerminalSrc(`adhoc-${Date.now()}`, 'terminal', undefined, {
        persistenceMode: 'shell',
        shellKind,
        workingDirectory,
      }));
      setHasStartedTerminal(true);
    } catch (error) {
      setTerminalError(error instanceof Error ? error.message : 'Failed to initialize ad-hoc agent session.');
    } finally {
      setIsLaunching(false);
    }
  }, [agentStatus?.defaultModel, agentStatus?.models, buildCommand, selectedModel, selectedProvider, selectedReasoningEffort, workingDirectory]);

  useEffect(() => {
    if (!isOpen || isLoadingDefaults || isLoadingStatus || hasStartedTerminal || isLaunching || hasAutoStartAttempted) {
      return;
    }
    if (statusError) {
      return;
    }
    if (!agentStatus) {
      return;
    }

    if (!agentStatus.installed) {
      setTerminalError(`Install ${providerLabel(selectedProvider, agentProviders)} before continuing.`);
      return;
    }

    if (!agentStatus.loggedIn) {
      setTerminalError(`Log in to ${providerLabel(selectedProvider, agentProviders)} before continuing.`);
      return;
    }

    setHasAutoStartAttempted(true);
    void handleStart();
  }, [
    agentProviders,
    agentStatus,
    handleStart,
    hasAutoStartAttempted,
    hasStartedTerminal,
    isLaunching,
    isLoadingDefaults,
    isLoadingStatus,
    isOpen,
    selectedProvider,
    statusError,
  ]);

  const handleTerminalLoad = useCallback(() => {
    if (!hasStartedTerminal || !terminalCommand || !iframeRef.current || isCommandInjected) {
      return;
    }

    const iframe = iframeRef.current;
    const checkAndInject = (attempts = 0) => {
      if (attempts > 40) {
        setTerminalError('Timed out while waiting for terminal to initialize.');
        return;
      }

      try {
        const win = iframe.contentWindow as TerminalWindow | null;
        if (win?.term) {
          const shouldUseDark = resolveShouldUseDarkTheme(
            resolvedTheme === 'light' || resolvedTheme === 'dark' ? resolvedTheme : 'auto',
            window.matchMedia('(prefers-color-scheme: dark)').matches,
          );
          applyThemeToTerminalWindow(
            win,
            shouldUseDark ? TERMINAL_THEME_DARK : TERMINAL_THEME_LIGHT,
          );
          win.term.paste(`${terminalCommand}\r`);
          setIsCommandInjected(true);
          setTerminalError(null);
          win.focus();
          return;
        }

        window.setTimeout(() => checkAndInject(attempts + 1), 300);
      } catch (error) {
        console.error('Failed to inject ad-hoc agent command into terminal iframe:', error);
        setTerminalError('Could not access ttyd terminal. Ensure ttyd is running and try again.');
      }
    };

    window.setTimeout(() => checkAndInject(), 500);
  }, [hasStartedTerminal, isCommandInjected, resolvedTheme, terminalCommand]);

  if (!isOpen) {
    return null;
  }

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-w-5xl p-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-[#30363d]">
          <div>
            <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">{title}</h3>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-400">{description}</div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-500 break-all">
              Repository: {workingDirectory}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={handleClose}
          >
            Close
          </button>
        </div>

        {!hasStartedTerminal ? (
          <div className="space-y-4 p-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 dark:border-[#30363d] dark:bg-[#0d1117]/55">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {providerLabel(selectedProvider, agentProviders)}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Model: {selectedModel || agentStatus?.defaultModel || 'Default model'}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Reasoning: {selectedReasoningEffort || 'Provider default'}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {isLoadingDefaults
                      ? 'Loading saved settings...'
                      : isLoadingStatus
                      ? 'Checking runtime status...'
                      : agentStatus
                        ? [
                          agentStatus.installed ? 'Installed' : 'Not installed',
                          agentStatus.loggedIn ? 'Logged in' : 'Login required',
                          agentStatus.version ? `v${agentStatus.version}` : null,
                        ].filter(Boolean).join(' • ')
                        : 'Runtime status unavailable'}
                  </div>
                  {agentStatus?.account?.email ? (
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {agentStatus.account.email}
                      {agentStatus.account.planType ? ` • ${agentStatus.account.planType}` : ''}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#30363d] dark:bg-[#0d1117] dark:text-slate-200 dark:hover:bg-[#161b22]"
                  onClick={() => {
                    setTerminalError(null);
                    setHasAutoStartAttempted(false);
                    void fetchAgentStatus(selectedProvider);
                  }}
                  disabled={isLoadingDefaults || isLoadingStatus || isLaunching}
                >
                  Retry
                </button>
              </div>
              {statusError ? (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
                  {statusError}
                </div>
              ) : null}
              {terminalError ? (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
                  {terminalError}
                </div>
              ) : null}
            </div>

            <div className="modal-action mt-0">
              <button className="btn" onClick={handleClose}>
                Cancel
              </button>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {isLoadingDefaults || isLoadingStatus
                  ? 'Preparing agent runtime...'
                  : isLaunching
                    ? 'Starting automatically...'
                    : hasAutoStartAttempted
                      ? 'Retry if the runtime state changed.'
                      : 'Waiting for runtime checks...'}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {providerLabel(terminalProvider, agentProviders)}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Model: {terminalModel || 'Default model'}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Reasoning: {terminalReasoningEffort || 'Provider default'}
                </div>
              </div>
            </div>

            {terminalError ? (
              <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
                {terminalError}
              </div>
            ) : null}

            <div className="h-[420px] overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-[#30363d] dark:bg-[#0d1117]">
              <iframe
                key={terminalSrc}
                ref={iframeRef}
                src={terminalSrc}
                className="h-full w-full border-none"
                allow="clipboard-read; clipboard-write"
                onLoad={handleTerminalLoad}
              />
            </div>

            <div className="mt-4 text-xs text-slate-500 dark:text-slate-400">
              {isCommandInjected
                ? 'Agent command was sent to the terminal automatically.'
                : 'Waiting for terminal to initialize...'}
            </div>
          </div>
        )}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={handleClose}>close</button>
      </form>
    </dialog>
  );
}
