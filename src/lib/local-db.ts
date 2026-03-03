import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAppDataDir } from './platform-utils';

type JsonObject = Record<string, unknown>;

const DB_FILE_NAME = 'palx.db';
const LEGACY_MIGRATION_KEY = 'legacy_migration_v1';
const SUPPORTED_AGENT_APIS = new Set(['codex']);
const VIBA_DIR = path.join(os.homedir(), '.viba');
const DB_PATH = path.join(VIBA_DIR, DB_FILE_NAME);

let dbInstance: Database.Database | null = null;

function ensureVibaDir(): void {
  fs.mkdirSync(VIBA_DIR, { recursive: true });
}

function secureDbFilePermissions(): void {
  try {
    fs.chmodSync(DB_PATH, 0o600);
  } catch {
    // Ignore permission errors on platforms that do not support POSIX modes.
  }
}

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS repositories (
      path TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      display_name TEXT,
      last_opened_at TEXT,
      credential_id TEXT,
      custom_scripts_json TEXT,
      expanded_folders_json TEXT,
      visibility_map_json TEXT,
      local_group_expanded INTEGER,
      remotes_group_expanded INTEGER,
      worktrees_group_expanded INTEGER
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      default_root_folder TEXT,
      sidebar_collapsed INTEGER,
      history_panel_height REAL
    );

    CREATE TABLE IF NOT EXISTS app_config (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      default_root TEXT NOT NULL DEFAULT '',
      selected_ide TEXT NOT NULL DEFAULT 'vscode',
      agent_width REAL NOT NULL DEFAULT 66.666
    );

    CREATE TABLE IF NOT EXISTS app_config_recent_repos (
      position INTEGER PRIMARY KEY,
      repo_path TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_config_pinned_folder_shortcuts (
      position INTEGER PRIMARY KEY,
      folder_path TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_config_repo_settings (
      repo_path TEXT PRIMARY KEY,
      agent_provider TEXT,
      agent_model TEXT,
      startup_script TEXT,
      dev_server_script TEXT,
      last_branch TEXT,
      credential_id TEXT,
      credential_preference TEXT
    );

    CREATE TABLE IF NOT EXISTS credentials_metadata (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      username TEXT NOT NULL,
      server_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      keytar_account TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_api_credentials_metadata (
      agent TEXT PRIMARY KEY,
      api_proxy TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      keytar_account TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      session_name TEXT PRIMARY KEY,
      repo_path TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      base_branch TEXT,
      agent TEXT NOT NULL,
      model TEXT NOT NULL,
      title TEXT,
      dev_server_script TEXT,
      initialized INTEGER,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_launch_contexts (
      session_name TEXT PRIMARY KEY,
      title TEXT,
      initial_message TEXT,
      raw_initial_message TEXT,
      startup_script TEXT,
      attachment_paths_json TEXT,
      attachment_names_json TEXT,
      agent_provider TEXT,
      model TEXT,
      session_mode TEXT,
      is_resume INTEGER,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      repo_path TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      message TEXT NOT NULL,
      attachment_paths_json TEXT NOT NULL,
      agent_provider TEXT NOT NULL,
      model TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      title TEXT NOT NULL,
      startup_script TEXT NOT NULL,
      dev_server_script TEXT NOT NULL,
      session_mode TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_repo_path_idx ON sessions(repo_path);
    CREATE INDEX IF NOT EXISTS sessions_timestamp_idx ON sessions(timestamp);
    CREATE INDEX IF NOT EXISTS drafts_repo_path_idx ON drafts(repo_path);
    CREATE INDEX IF NOT EXISTS drafts_timestamp_idx ON drafts(timestamp);
  `);
}

function readJsonFileIfExists(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[local-db] Failed to parse legacy JSON file: ${filePath}`, error);
    }
    return null;
  }
}

function readJsonObjectsFromDir(dirPath: string): JsonObject[] {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => readJsonFileIfExists(path.join(dirPath, entry.name)))
      .filter((value): value is JsonObject => Boolean(value) && typeof value === 'object');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[local-db] Failed to read legacy JSON directory: ${dirPath}`, error);
    }
    return [];
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' ? value : null;
}

function asBooleanOrNull(value: unknown): 1 | 0 | null {
  if (value === true) return 1;
  if (value === false) return 0;
  return null;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getRowCount(db: Database.Database, tableName: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
  return row.count;
}

function migrateLegacyRepositoriesAndSettings(db: Database.Database): void {
  const legacyDataDir = getAppDataDir();
  const reposFiles = [
    path.join(legacyDataDir, 'repos.json'),
    path.join(VIBA_DIR, 'repos.json'),
  ];
  const settingsFiles = [
    path.join(legacyDataDir, 'settings.json'),
    path.join(VIBA_DIR, 'settings.json'),
  ];

  if (getRowCount(db, 'repositories') === 0) {
    const reposInsert = db.prepare(`
      INSERT OR IGNORE INTO repositories (
        path, name, display_name, last_opened_at, credential_id, custom_scripts_json,
        expanded_folders_json, visibility_map_json, local_group_expanded,
        remotes_group_expanded, worktrees_group_expanded
      ) VALUES (
        @path, @name, @displayName, @lastOpenedAt, @credentialId, @customScriptsJson,
        @expandedFoldersJson, @visibilityMapJson, @localGroupExpanded,
        @remotesGroupExpanded, @worktreesGroupExpanded
      )
    `);

    for (const filePath of reposFiles) {
      const raw = readJsonFileIfExists(filePath);
      if (!Array.isArray(raw)) continue;
      for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const row = entry as JsonObject;
        const repoPath = asString(row.path);
        const name = asString(row.name);
        if (!repoPath || !name) continue;
        reposInsert.run({
          path: repoPath,
          name,
          displayName: asOptionalString(row.displayName),
          lastOpenedAt: asOptionalString(row.lastOpenedAt),
          credentialId: asOptionalString(row.credentialId),
          customScriptsJson: Array.isArray(row.customScripts) ? JSON.stringify(row.customScripts) : null,
          expandedFoldersJson: Array.isArray(row.expandedFolders) ? JSON.stringify(row.expandedFolders) : null,
          visibilityMapJson: row.visibilityMap && typeof row.visibilityMap === 'object'
            ? JSON.stringify(row.visibilityMap)
            : null,
          localGroupExpanded: asBooleanOrNull(row.localGroupExpanded),
          remotesGroupExpanded: asBooleanOrNull(row.remotesGroupExpanded),
          worktreesGroupExpanded: asBooleanOrNull(row.worktreesGroupExpanded),
        });
      }
      if (getRowCount(db, 'repositories') > 0) break;
    }
  }

  if (getRowCount(db, 'app_settings') === 0) {
    for (const filePath of settingsFiles) {
      const raw = readJsonFileIfExists(filePath);
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as JsonObject;
      db.prepare(`
        INSERT OR REPLACE INTO app_settings (
          singleton_id, default_root_folder, sidebar_collapsed, history_panel_height
        ) VALUES (1, @defaultRootFolder, @sidebarCollapsed, @historyPanelHeight)
      `).run({
        defaultRootFolder: asOptionalString(row.defaultRootFolder),
        sidebarCollapsed: asBooleanOrNull(row.sidebarCollapsed),
        historyPanelHeight: asNumberOrNull(row.historyPanelHeight),
      });
      break;
    }
  }
}

function migrateLegacyConfig(db: Database.Database): void {
  if (getRowCount(db, 'app_config') > 0) return;

  const configPath = path.join(VIBA_DIR, 'config.json');
  const raw = readJsonFileIfExists(configPath);
  if (!raw || typeof raw !== 'object') return;
  const config = raw as JsonObject;

  db.prepare(`
    INSERT OR REPLACE INTO app_config (
      singleton_id, default_root, selected_ide, agent_width
    ) VALUES (
      1, @defaultRoot, @selectedIde, @agentWidth
    )
  `).run({
    defaultRoot: asString(config.defaultRoot) ?? '',
    selectedIde: asString(config.selectedIde) ?? 'vscode',
    agentWidth: asNumberOrNull(config.agentWidth) ?? 66.666,
  });

  db.prepare('DELETE FROM app_config_recent_repos').run();
  if (Array.isArray(config.recentRepos)) {
    const insertRecent = db.prepare(`
      INSERT INTO app_config_recent_repos (position, repo_path) VALUES (?, ?)
    `);
    config.recentRepos
      .filter((value): value is string => typeof value === 'string')
      .forEach((repoPath, index) => {
        insertRecent.run(index, repoPath);
      });
  }

  db.prepare('DELETE FROM app_config_pinned_folder_shortcuts').run();
  if (Array.isArray(config.pinnedFolderShortcuts)) {
    const insertPinned = db.prepare(`
      INSERT INTO app_config_pinned_folder_shortcuts (position, folder_path) VALUES (?, ?)
    `);
    config.pinnedFolderShortcuts
      .filter((value): value is string => typeof value === 'string')
      .forEach((folderPath, index) => {
        insertPinned.run(index, folderPath);
      });
  }

  db.prepare('DELETE FROM app_config_repo_settings').run();
  if (config.repoSettings && typeof config.repoSettings === 'object') {
    const insertRepoSettings = db.prepare(`
      INSERT INTO app_config_repo_settings (
        repo_path, agent_provider, agent_model, startup_script, dev_server_script,
        last_branch, credential_id, credential_preference
      ) VALUES (
        @repoPath, @agentProvider, @agentModel, @startupScript, @devServerScript,
        @lastBranch, @credentialId, @credentialPreference
      )
    `);
    for (const [repoPath, rawSettings] of Object.entries(config.repoSettings)) {
      if (!rawSettings || typeof rawSettings !== 'object') continue;
      const settings = rawSettings as JsonObject;
      const rawPreference = asString(settings.credentialPreference);
      const credentialPreference = rawPreference === 'auto' || rawPreference === 'github' || rawPreference === 'gitlab'
        ? rawPreference
        : null;
      insertRepoSettings.run({
        repoPath,
        agentProvider: asOptionalString(settings.agentProvider),
        agentModel: asOptionalString(settings.agentModel),
        startupScript: asOptionalString(settings.startupScript),
        devServerScript: asOptionalString(settings.devServerScript),
        lastBranch: asOptionalString(settings.lastBranch),
        credentialId: asOptionalString(settings.credentialId),
        credentialPreference,
      });
    }
  }
}

function migrateLegacyCredentials(db: Database.Database): void {
  if (getRowCount(db, 'credentials_metadata') > 0) return;

  const now = new Date().toISOString();
  const credentialsPath = path.join(VIBA_DIR, 'credentials.json');
  const raw = readJsonFileIfExists(credentialsPath);
  if (!raw) return;

  const insert = db.prepare(`
    INSERT OR REPLACE INTO credentials_metadata (
      id, type, username, server_url, created_at, updated_at, keytar_account
    ) VALUES (
      @id, @type, @username, @serverUrl, @createdAt, @updatedAt, @keytarAccount
    )
  `);

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as JsonObject;
      const id = asString(row.id);
      const type = asString(row.type);
      const username = asString(row.username);
      if (!id || !username || (type !== 'github' && type !== 'gitlab')) continue;
      insert.run({
        id,
        type,
        username,
        serverUrl: type === 'gitlab' ? asOptionalString(row.serverUrl) ?? 'https://gitlab.com' : null,
        createdAt: asString(row.createdAt) ?? now,
        updatedAt: asString(row.updatedAt) ?? now,
        keytarAccount: asOptionalString(row.keytarAccount),
      });
    }
    return;
  }

  if (typeof raw !== 'object') return;
  const legacy = raw as JsonObject;
  const github = legacy.github;
  if (github && typeof github === 'object') {
    const row = github as JsonObject;
    const username = asString(row.username);
    if (username) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      insert.run({
        id,
        type: 'github',
        username,
        serverUrl: null,
        createdAt: asString(row.createdAt) ?? now,
        updatedAt: asString(row.updatedAt) ?? now,
        keytarAccount: 'credential-github',
      });
    }
  }
  const gitlab = legacy.gitlab;
  if (gitlab && typeof gitlab === 'object') {
    const row = gitlab as JsonObject;
    const username = asString(row.username);
    if (username) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      insert.run({
        id,
        type: 'gitlab',
        username,
        serverUrl: asOptionalString(row.serverUrl) ?? 'https://gitlab.com',
        createdAt: asString(row.createdAt) ?? now,
        updatedAt: asString(row.updatedAt) ?? now,
        keytarAccount: 'credential-gitlab',
      });
    }
  }
}

function migrateLegacyAgentApiCredentials(db: Database.Database): void {
  if (getRowCount(db, 'agent_api_credentials_metadata') > 0) return;

  const now = new Date().toISOString();
  const configPath = path.join(VIBA_DIR, 'agent-api-configs.json');
  const raw = readJsonFileIfExists(configPath);
  if (!raw) return;

  const insert = db.prepare(`
    INSERT OR REPLACE INTO agent_api_credentials_metadata (
      agent, api_proxy, created_at, updated_at, keytar_account
    ) VALUES (
      @agent, @apiProxy, @createdAt, @updatedAt, @keytarAccount
    )
  `);

  const migrateEntry = (agent: string, value: unknown) => {
    if (!SUPPORTED_AGENT_APIS.has(agent)) return;
    if (!value || typeof value !== 'object') return;
    const row = value as JsonObject;
    insert.run({
      agent,
      apiProxy: asOptionalString(row.apiProxy),
      createdAt: asString(row.createdAt) ?? now,
      updatedAt: asString(row.updatedAt) ?? now,
      keytarAccount: asOptionalString(row.keytarAccount) ?? `agent-api-${agent}`,
    });
  };

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as JsonObject;
      const agent = asString(row.agent);
      if (!agent) continue;
      migrateEntry(agent, row);
    }
    return;
  }

  if (typeof raw !== 'object') return;
  for (const [agent, value] of Object.entries(raw as JsonObject)) {
    migrateEntry(agent, value);
  }
}

function migrateLegacySessions(db: Database.Database): void {
  if (getRowCount(db, 'sessions') === 0) {
    const sessionsDir = path.join(VIBA_DIR, 'sessions');
    const insert = db.prepare(`
      INSERT OR REPLACE INTO sessions (
        session_name, repo_path, worktree_path, branch_name, base_branch, agent, model,
        title, dev_server_script, initialized, timestamp
      ) VALUES (
        @sessionName, @repoPath, @worktreePath, @branchName, @baseBranch, @agent, @model,
        @title, @devServerScript, @initialized, @timestamp
      )
    `);
    for (const row of readJsonObjectsFromDir(sessionsDir)) {
      const sessionName = asString(row.sessionName);
      const repoPath = asString(row.repoPath);
      const worktreePath = asString(row.worktreePath);
      const branchName = asString(row.branchName);
      const agent = asString(row.agent);
      const model = asString(row.model);
      const timestamp = asString(row.timestamp);
      if (!sessionName || !repoPath || !worktreePath || !branchName || !agent || !model || !timestamp) continue;
      insert.run({
        sessionName,
        repoPath,
        worktreePath,
        branchName,
        baseBranch: asOptionalString(row.baseBranch),
        agent,
        model,
        title: asOptionalString(row.title),
        devServerScript: asOptionalString(row.devServerScript),
        initialized: asBooleanOrNull(row.initialized),
        timestamp,
      });
    }
  }

  if (getRowCount(db, 'session_launch_contexts') === 0) {
    const contextsDir = path.join(VIBA_DIR, 'session-contexts');
    const insert = db.prepare(`
      INSERT OR REPLACE INTO session_launch_contexts (
        session_name, title, initial_message, raw_initial_message, startup_script,
        attachment_paths_json, attachment_names_json, agent_provider, model,
        session_mode, is_resume, timestamp
      ) VALUES (
        @sessionName, @title, @initialMessage, @rawInitialMessage, @startupScript,
        @attachmentPathsJson, @attachmentNamesJson, @agentProvider, @model,
        @sessionMode, @isResume, @timestamp
      )
    `);
    for (const row of readJsonObjectsFromDir(contextsDir)) {
      const sessionName = asString(row.sessionName);
      const timestamp = asString(row.timestamp);
      if (!sessionName || !timestamp) continue;
      insert.run({
        sessionName,
        title: asOptionalString(row.title),
        initialMessage: asOptionalString(row.initialMessage),
        rawInitialMessage: asOptionalString(row.rawInitialMessage),
        startupScript: asOptionalString(row.startupScript),
        attachmentPathsJson: Array.isArray(row.attachmentPaths) ? JSON.stringify(row.attachmentPaths) : null,
        attachmentNamesJson: Array.isArray(row.attachmentNames) ? JSON.stringify(row.attachmentNames) : null,
        agentProvider: asOptionalString(row.agentProvider),
        model: asOptionalString(row.model),
        sessionMode: asOptionalString(row.sessionMode),
        isResume: asBooleanOrNull(row.isResume),
        timestamp,
      });
    }
  }
}

function migrateLegacyDrafts(db: Database.Database): void {
  if (getRowCount(db, 'drafts') > 0) return;

  const draftsDir = path.join(VIBA_DIR, 'drafts');
  const insert = db.prepare(`
    INSERT OR REPLACE INTO drafts (
      id, repo_path, branch_name, message, attachment_paths_json, agent_provider,
      model, timestamp, title, startup_script, dev_server_script, session_mode
    ) VALUES (
      @id, @repoPath, @branchName, @message, @attachmentPathsJson, @agentProvider,
      @model, @timestamp, @title, @startupScript, @devServerScript, @sessionMode
    )
  `);

  for (const row of readJsonObjectsFromDir(draftsDir)) {
    const id = asString(row.id);
    const repoPath = asString(row.repoPath);
    const branchName = asString(row.branchName);
    const message = asString(row.message);
    const agentProvider = asString(row.agentProvider);
    const model = asString(row.model);
    const timestamp = asString(row.timestamp);
    const title = asString(row.title);
    const startupScript = asString(row.startupScript);
    const devServerScript = asString(row.devServerScript);
    const sessionMode = asString(row.sessionMode);
    if (
      !id || !repoPath || !branchName || !message || !agentProvider || !model
      || !timestamp || !title || !startupScript || !devServerScript || !sessionMode
    ) {
      continue;
    }

    insert.run({
      id,
      repoPath,
      branchName,
      message,
      attachmentPathsJson: Array.isArray(row.attachmentPaths) ? JSON.stringify(row.attachmentPaths) : '[]',
      agentProvider,
      model,
      timestamp,
      title,
      startupScript,
      devServerScript,
      sessionMode,
    });
  }
}

function migrateLegacyData(db: Database.Database): void {
  const alreadyMigrated = db.prepare(`
    SELECT value FROM schema_meta WHERE key = ?
  `).get(LEGACY_MIGRATION_KEY) as { value: string } | undefined;

  if (alreadyMigrated?.value === '1') {
    return;
  }

  const migration = db.transaction(() => {
    migrateLegacyRepositoriesAndSettings(db);
    migrateLegacyConfig(db);
    migrateLegacyCredentials(db);
    migrateLegacyAgentApiCredentials(db);
    migrateLegacySessions(db);
    migrateLegacyDrafts(db);
    db.prepare(`
      INSERT INTO schema_meta (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(LEGACY_MIGRATION_KEY, '1');
  });

  migration();
}

function initializeDb(): Database.Database {
  ensureVibaDir();
  const db = new Database(DB_PATH);
  secureDbFilePermissions();

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

  createSchema(db);
  migrateLegacyData(db);
  return db;
}

export function getLocalDb(): Database.Database {
  if (!dbInstance) {
    dbInstance = initializeDb();
  }
  return dbInstance;
}

export function getLocalDbPath(): string {
  return DB_PATH;
}

export function getVibaDirPath(): string {
  return VIBA_DIR;
}
