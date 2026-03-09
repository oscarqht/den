'use client';

import type { AgentProvider, AppStatus, ProviderCatalogEntry } from '@/lib/types';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

type AgentStatusResponse = {
  providers: ProviderCatalogEntry[];
  defaultProvider: AgentProvider;
  status: AppStatus | null;
  error?: string;
};

type ProviderCardState = {
  loading: boolean;
  status: AppStatus | null;
  error: string | null;
};

function formatMetricValue(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return '--';
  }

  if (Math.abs(value) >= 1000) {
    return value.toLocaleString();
  }

  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(2);
}

function providerLabel(entry: ProviderCatalogEntry) {
  return entry.label || entry.id;
}

export default function AgentUsageContent() {
  const router = useRouter();
  const [providers, setProviders] = useState<ProviderCatalogEntry[]>([]);
  const [cards, setCards] = useState<Record<string, ProviderCardState>>({});
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadStatus = useCallback(async (provider: AgentProvider) => {
    setCards((previous) => ({
      ...previous,
      [provider]: {
        loading: true,
        status: previous[provider]?.status ?? null,
        error: null,
      },
    }));

    try {
      const response = await fetch(
        `/api/agent/status?provider=${encodeURIComponent(provider)}&includeUsage=1`,
        { cache: 'no-store' },
      );
      const payload = await response.json().catch(() => null) as AgentStatusResponse | null;
      if (!payload) {
        throw new Error('Failed to load provider status.');
      }

      setCards((previous) => ({
        ...previous,
        [provider]: {
          loading: false,
          status: payload.status,
          error: payload.error || null,
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load provider status.';
      setCards((previous) => ({
        ...previous,
        [provider]: {
          loading: false,
          status: null,
          error: message,
        },
      }));
    }
  }, []);

  const loadAllStatuses = useCallback(async (entries: ProviderCatalogEntry[]) => {
    await Promise.all(entries.map(async (entry) => await loadStatus(entry.id)));
  }, [loadStatus]);

  const loadSupportedProviders = useCallback(async () => {
    setLoadingProviders(true);
    setLoadingError(null);

    try {
      const response = await fetch('/api/agent/status?provider=codex', { cache: 'no-store' });
      const payload = await response.json().catch(() => null) as AgentStatusResponse | null;
      if (!payload) {
        throw new Error('Failed to load agent providers.');
      }

      const availableProviders = payload.providers.filter((entry) => entry.available);
      setProviders(availableProviders);

      if (availableProviders.length === 0) {
        setCards({});
        setLoadingProviders(false);
        return;
      }

      await loadAllStatuses(availableProviders);
      setLoadingProviders(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load agent providers.';
      setLoadingError(message);
      setLoadingProviders(false);
    }
  }, [loadAllStatuses]);

  useEffect(() => {
    void loadSupportedProviders();
  }, [loadSupportedProviders]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadSupportedProviders();
    setRefreshing(false);
  };

  const sortedProviders = useMemo(() => {
    return [...providers].sort((left, right) => left.label.localeCompare(right.label));
  }, [providers]);

  return (
    <main className="min-h-screen bg-[#f6f6f8] px-4 py-8 md:px-8 md:py-12 dark:bg-[#0f1117]">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-2 flex items-center gap-4">
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                onClick={() => router.push('/')}
                aria-label="Back to home"
              >
                <ChevronRight className="h-6 w-6 rotate-180" />
              </button>
              <h1 className="text-3xl font-black tracking-[-0.02em] text-slate-900 md:text-4xl dark:text-white">
                Agent Usage
              </h1>
            </div>
            <p className="ml-14 text-sm text-slate-500 md:text-base dark:text-slate-400">
              View provider login status and current usage/quota details.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            onClick={() => void handleRefresh()}
            disabled={loadingProviders || refreshing}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {loadingError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-900/30 dark:text-red-200">
            {loadingError}
          </div>
        )}

        {loadingProviders ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-700/50 dark:bg-slate-800">
            <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
              <span className="loading loading-spinner loading-sm text-primary"></span>
              Loading provider status...
            </div>
          </div>
        ) : sortedProviders.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm dark:border-slate-700/50 dark:bg-slate-800 dark:text-slate-400">
            No supported agent providers are currently available.
          </div>
        ) : (
          <div className="space-y-4">
            {sortedProviders.map((provider) => {
              const state = cards[provider.id] || {
                loading: true,
                status: null,
                error: null,
              };
              const status = state.status;
              const usage = status?.usage;

              return (
                <section
                  key={provider.id}
                  className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700/50 dark:bg-slate-800"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                        {providerLabel(provider)}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {provider.description}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-700"
                      onClick={() => void loadStatus(provider.id)}
                      disabled={state.loading}
                    >
                      {state.loading ? 'Checking...' : 'Refresh'}
                    </button>
                  </div>

                  {state.error ? (
                    <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/40 dark:bg-red-900/30 dark:text-red-200">
                      {state.error}
                    </div>
                  ) : null}

                  {!state.error && status ? (
                    <div className="mt-4 space-y-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                          {status.installed ? 'Installed' : 'Not installed'}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                          {status.loggedIn ? 'Logged in' : 'Login required'}
                        </span>
                        {status.version ? (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                            {status.version}
                          </span>
                        ) : null}
                        {status.account?.email ? (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                            {status.account.email}
                          </span>
                        ) : null}
                      </div>

                      {!status.loggedIn ? (
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-900/30 dark:text-amber-200">
                          Log in to this provider to check usage and remaining quota.
                        </div>
                      ) : usage?.available && usage.metrics.length > 0 ? (
                        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                          <table className="min-w-full text-left text-xs">
                            <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
                              <tr>
                                <th className="px-3 py-2 font-semibold">Metric</th>
                                <th className="px-3 py-2 font-semibold">Used</th>
                                <th className="px-3 py-2 font-semibold">Remaining</th>
                                <th className="px-3 py-2 font-semibold">Limit</th>
                                <th className="px-3 py-2 font-semibold">Note</th>
                              </tr>
                            </thead>
                            <tbody>
                              {usage.metrics.map((metric) => (
                                <tr
                                  key={metric.id}
                                  className="border-t border-slate-100 text-slate-700 dark:border-slate-700 dark:text-slate-200"
                                >
                                  <td className="px-3 py-2">
                                    {metric.label}
                                    {metric.window ? ` (${metric.window})` : ''}
                                  </td>
                                  <td className="px-3 py-2">{formatMetricValue(metric.used)}</td>
                                  <td className="px-3 py-2">{formatMetricValue(metric.remaining)}</td>
                                  <td className="px-3 py-2">{formatMetricValue(metric.limit)}</td>
                                  <td className="px-3 py-2">{metric.note || '--'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                          {usage?.summary || 'Usage details are currently unavailable for this provider.'}
                        </div>
                      )}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
