import type { Query, UseQueryResult } from '@tanstack/react-query';
import type { AgentProvider } from './types.ts';

export const APP_QUERY_CACHE_STORAGE_KEY = 'palx-query-cache';
export const APP_QUERY_CACHE_BUSTER = 'palx-query-cache-v1';
export const APP_QUERY_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;
export const APP_QUERY_DEFAULT_GC_TIME_MS = APP_QUERY_CACHE_MAX_AGE_MS;
export const APP_QUERY_DEFAULT_STALE_TIME_MS = 1000 * 15;

type QueryResultLike<TData> = Pick<UseQueryResult<TData, unknown>, 'data' | 'dataUpdatedAt' | 'isFetching'>;

export type QueryCacheState = {
  hasCachedData: boolean;
  isRefreshing: boolean;
  lastUpdatedAt: string | null;
};

type LegacyAgentModelCatalogCacheEntry = {
  models: Array<{
    id: string;
    label: string;
    description?: string | null;
    reasoningEfforts?: string[];
  }>;
  defaultModel: string | null;
  updatedAt: string;
};

export const queryKeys = {
  homeBootstrap: () => ['home', 'bootstrap'] as const,
  homeActivity: () => ['home', 'activity'] as const,
  homeQuickCreate: () => ['home', 'quick-create'] as const,
  homeProjectGitRepos: (projectReference: string) => ['home', 'project-git-repos', projectReference] as const,
  projectActivity: (projectReference: string) => ['project', projectReference, 'activity'] as const,
  projectGitRepos: (projectReference: string) => ['project', projectReference, 'git-repos'] as const,
  gitRemotes: (repoPath: string) => ['git', repoPath, 'remotes'] as const,
  gitBranches: (repoPath: string) => ['git', repoPath, 'branches'] as const,
  gitTrackingBranch: (repoPath: string, branch: string) => ['git', repoPath, 'tracking-branch', branch] as const,
  gitRemoteBranches: (repoPath: string, remote: string) => ['git', repoPath, 'remote-branches', remote] as const,
  agentStatus: (provider: AgentProvider) => ['agent', 'status', provider] as const,
};

export function isPersistedQuery(query: Query): boolean {
  return query.meta?.persist === true && query.state.status === 'success';
}

export function isProjectGitRepoDiscoveryQueryKey(queryKey: readonly unknown[]): boolean {
  return (
    (queryKey[0] === 'project' && queryKey[2] === 'git-repos')
    || (queryKey[0] === 'home' && queryKey[1] === 'project-git-repos')
  );
}

export function getQueryCacheState<TData>(query: QueryResultLike<TData>): QueryCacheState {
  const hasCachedData = query.data !== undefined;
  return {
    hasCachedData,
    isRefreshing: hasCachedData && query.isFetching,
    lastUpdatedAt: query.dataUpdatedAt > 0 ? new Date(query.dataUpdatedAt).toISOString() : null,
  };
}

export function getLatestQueryUpdatedAt(...states: QueryCacheState[]): string | null {
  return states.reduce<string | null>((latest, state) => {
    if (!state.lastUpdatedAt) return latest;
    if (!latest || state.lastUpdatedAt > latest) return state.lastUpdatedAt;
    return latest;
  }, null);
}

export function getLegacyAgentStatusStorageKey(provider: AgentProvider): string {
  return `viba:agent-provider-models:${provider}`;
}

export function readLegacyAgentStatusCache(
  storage: Pick<Storage, 'getItem'>,
  provider: AgentProvider,
): LegacyAgentModelCatalogCacheEntry | null {
  try {
    const rawValue = storage.getItem(getLegacyAgentStatusStorageKey(provider));
    if (!rawValue) return null;
    const parsed = JSON.parse(rawValue) as Partial<LegacyAgentModelCatalogCacheEntry>;
    if (!Array.isArray(parsed.models) || typeof parsed.updatedAt !== 'string') {
      return null;
    }
    return {
      models: parsed.models
        .filter((entry): entry is LegacyAgentModelCatalogCacheEntry['models'][number] => (
          Boolean(entry)
          && typeof entry === 'object'
          && typeof entry.id === 'string'
          && entry.id.trim().length > 0
        ))
        .map((entry) => ({
          id: entry.id.trim(),
          label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : entry.id.trim(),
          description: typeof entry.description === 'string' ? entry.description : null,
          reasoningEfforts: Array.isArray(entry.reasoningEfforts)
            ? entry.reasoningEfforts.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            : undefined,
        })),
      defaultModel: typeof parsed.defaultModel === 'string' && parsed.defaultModel.trim()
        ? parsed.defaultModel.trim()
        : null,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}
