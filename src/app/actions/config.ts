'use server';

import { getLocalDb } from '@/lib/local-db';

export interface RepoSettings {
  agentProvider?: string;
  agentModel?: string;
  startupScript?: string;
  devServerScript?: string;
  lastBranch?: string;
  credentialId?: string | null;
  credentialPreference?: 'auto' | 'github' | 'gitlab';
}

export interface Config {
  recentRepos: string[];
  defaultRoot: string;
  selectedIde: string;
  agentWidth: number;
  repoSettings: Record<string, RepoSettings>;
  pinnedFolderShortcuts: string[];
}

const DEFAULT_CONFIG: Config = {
  recentRepos: [],
  defaultRoot: '',
  selectedIde: 'vscode',
  agentWidth: 66.666,
  repoSettings: {},
  pinnedFolderShortcuts: [],
};

type ConfigRow = {
  default_root: string;
  selected_ide: string;
  agent_width: number;
};

type RepoSettingsRow = {
  repo_path: string;
  agent_provider: string | null;
  agent_model: string | null;
  startup_script: string | null;
  dev_server_script: string | null;
  last_branch: string | null;
  credential_id: string | null;
  credential_preference: string | null;
};

function normalizeCredentialPreference(
  value: string | null | undefined,
): 'auto' | 'github' | 'gitlab' | undefined {
  return value === 'auto' || value === 'github' || value === 'gitlab' ? value : undefined;
}

function toRepoSettings(row: RepoSettingsRow): RepoSettings {
  const settings: RepoSettings = {};
  if (row.agent_provider !== null) settings.agentProvider = row.agent_provider;
  if (row.agent_model !== null) settings.agentModel = row.agent_model;
  if (row.startup_script !== null) settings.startupScript = row.startup_script;
  if (row.dev_server_script !== null) settings.devServerScript = row.dev_server_script;
  if (row.last_branch !== null) settings.lastBranch = row.last_branch;
  if (row.credential_id !== null) settings.credentialId = row.credential_id;
  const credentialPreference = normalizeCredentialPreference(row.credential_preference);
  if (credentialPreference) settings.credentialPreference = credentialPreference;
  return settings;
}

function writeConfig(config: Config): void {
  const db = getLocalDb();
  const tx = db.transaction((nextConfig: Config) => {
    db.prepare(`
      INSERT OR REPLACE INTO app_config (
        singleton_id, default_root, selected_ide, agent_width
      ) VALUES (
        1, @defaultRoot, @selectedIde, @agentWidth
      )
    `).run({
      defaultRoot: nextConfig.defaultRoot,
      selectedIde: nextConfig.selectedIde,
      agentWidth: nextConfig.agentWidth,
    });

    db.prepare('DELETE FROM app_config_recent_repos').run();
    const insertRecentRepo = db.prepare(`
      INSERT INTO app_config_recent_repos (position, repo_path) VALUES (?, ?)
    `);
    nextConfig.recentRepos.forEach((repoPath, index) => {
      insertRecentRepo.run(index, repoPath);
    });

    db.prepare('DELETE FROM app_config_pinned_folder_shortcuts').run();
    const insertPinnedShortcut = db.prepare(`
      INSERT INTO app_config_pinned_folder_shortcuts (position, folder_path) VALUES (?, ?)
    `);
    nextConfig.pinnedFolderShortcuts.forEach((folderPath, index) => {
      insertPinnedShortcut.run(index, folderPath);
    });

    db.prepare('DELETE FROM app_config_repo_settings').run();
    const insertRepoSettings = db.prepare(`
      INSERT INTO app_config_repo_settings (
        repo_path, agent_provider, agent_model, startup_script, dev_server_script,
        last_branch, credential_id, credential_preference
      ) VALUES (
        @repoPath, @agentProvider, @agentModel, @startupScript, @devServerScript,
        @lastBranch, @credentialId, @credentialPreference
      )
    `);
    for (const [repoPath, repoSettings] of Object.entries(nextConfig.repoSettings)) {
      insertRepoSettings.run({
        repoPath,
        agentProvider: repoSettings.agentProvider ?? null,
        agentModel: repoSettings.agentModel ?? null,
        startupScript: repoSettings.startupScript ?? null,
        devServerScript: repoSettings.devServerScript ?? null,
        lastBranch: repoSettings.lastBranch ?? null,
        credentialId: repoSettings.credentialId ?? null,
        credentialPreference: repoSettings.credentialPreference ?? null,
      });
    }
  });

  tx(config);
}

export async function getConfig(): Promise<Config> {
  const db = getLocalDb();
  const configRow = db.prepare(`
    SELECT default_root, selected_ide, agent_width
    FROM app_config
    WHERE singleton_id = 1
  `).get() as ConfigRow | undefined;

  const recentRepos = db.prepare(`
    SELECT repo_path
    FROM app_config_recent_repos
    ORDER BY position ASC
  `).all() as Array<{ repo_path: string }>;

  const pinnedFolderShortcuts = db.prepare(`
    SELECT folder_path
    FROM app_config_pinned_folder_shortcuts
    ORDER BY position ASC
  `).all() as Array<{ folder_path: string }>;

  const repoSettingsRows = db.prepare(`
    SELECT
      repo_path, agent_provider, agent_model, startup_script, dev_server_script,
      last_branch, credential_id, credential_preference
    FROM app_config_repo_settings
  `).all() as RepoSettingsRow[];

  const repoSettings = Object.fromEntries(
    repoSettingsRows.map((row) => [row.repo_path, toRepoSettings(row)]),
  );

  return {
    ...DEFAULT_CONFIG,
    defaultRoot: configRow?.default_root ?? DEFAULT_CONFIG.defaultRoot,
    selectedIde: configRow?.selected_ide ?? DEFAULT_CONFIG.selectedIde,
    agentWidth: configRow?.agent_width ?? DEFAULT_CONFIG.agentWidth,
    recentRepos: recentRepos.map((entry) => entry.repo_path),
    pinnedFolderShortcuts: pinnedFolderShortcuts.map((entry) => entry.folder_path),
    repoSettings,
  };
}

export async function saveConfig(config: Config): Promise<void> {
  try {
    writeConfig(config);
  } catch (error) {
    console.error('Failed to save config:', error);
    throw new Error('Failed to save configuration.');
  }
}

export async function updateConfig(updates: Partial<Config>): Promise<Config> {
  const currentConfig = await getConfig();
  const newConfig = { ...currentConfig, ...updates };
  await saveConfig(newConfig);
  return newConfig;
}

export async function updateRepoSettings(repoPath: string, updates: Partial<RepoSettings>): Promise<Config> {
  const currentConfig = await getConfig();
  const currentRepoSettings = currentConfig.repoSettings[repoPath] || {};

  const newConfig: Config = {
    ...currentConfig,
    repoSettings: {
      ...currentConfig.repoSettings,
      [repoPath]: { ...currentRepoSettings, ...updates },
    },
  };

  await saveConfig(newConfig);
  return newConfig;
}
