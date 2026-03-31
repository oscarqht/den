import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STATE_FILE_NAME = 'palx-state.json';
const VIBA_DIR = path.join(os.homedir(), '.viba');
const STATE_PATH = path.join(VIBA_DIR, STATE_FILE_NAME);

export type LocalProjectRecord = {
  id: string;
  name: string;
  folderPaths: string[];
  iconPath?: string | null;
  lastOpenedAt?: string | null;
};

export type LocalRepositoryRecord = {
  path: string;
  name: string;
  displayName?: string | null;
  expandedFolders?: string[] | null;
  visibilityMap?: Record<string, 'visible' | 'hidden'> | null;
  localGroupExpanded?: boolean | null;
  remotesGroupExpanded?: boolean | null;
  worktreesGroupExpanded?: boolean | null;
};

export type LocalAppSettingsRecord = {
  defaultRootFolder?: string | null;
  sidebarCollapsed?: boolean | null;
  historyPanelHeight?: number | null;
};

export type LocalProjectSettingsRecord = {
  agentProvider?: string | null;
  agentModel?: string | null;
  agentReasoningEffort?: string | null;
  startupScript?: string | null;
  devServerScript?: string | null;
  serviceStartCommand?: string | null;
  serviceStopCommand?: string | null;
  alias?: string | null;
};

export type LocalAppConfigRecord = {
  recentProjects: string[];
  homeProjectSort: string;
  defaultRoot: string;
  selectedIde: string;
  agentWidth: number;
  defaultAgentProvider?: string | null;
  defaultAgentModel?: string | null;
  defaultAgentReasoningEffort?: string | null;
  pinnedFolderShortcuts: string[];
  projectSettings: Record<string, LocalProjectSettingsRecord>;
};

export type LocalCredentialMetadataRecord = {
  id: string;
  type: string;
  username: string;
  serverUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  keytarAccount?: string | null;
};

export type LocalAgentApiCredentialMetadataRecord = {
  agent: string;
  apiProxy?: string | null;
  createdAt: string;
  updatedAt: string;
  keytarAccount?: string | null;
};

export type LocalSessionGitRepoRecord = {
  sourceRepoPath: string;
  relativeRepoPath: string;
  worktreePath: string;
  branchName: string;
  baseBranch?: string | null;
};

export type LocalSessionRecord = {
  sessionName: string;
  projectId?: string | null;
  projectPath: string;
  workspacePath: string;
  workspaceFoldersJson?: string | null;
  workspaceMode: string;
  activeRepoPath?: string | null;
  repoPath?: string | null;
  worktreePath?: string | null;
  branchName?: string | null;
  baseBranch?: string | null;
  agent: string;
  model: string;
  reasoningEffort?: string | null;
  threadId?: string | null;
  activeTurnId?: string | null;
  runState?: string | null;
  lastError?: string | null;
  lastActivityAt?: string | null;
  title?: string | null;
  devServerScript?: string | null;
  initialized?: boolean | null;
  timestamp: string;
  gitRepos: LocalSessionGitRepoRecord[];
};

export type LocalSessionLaunchContextRecord = {
  sessionName: string;
  title?: string | null;
  initialMessage?: string | null;
  rawInitialMessage?: string | null;
  startupScript?: string | null;
  attachmentPathsJson?: string | null;
  attachmentNamesJson?: string | null;
  projectRepoPathsJson?: string | null;
  projectRepoRelativePathsJson?: string | null;
  agentProvider?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  sessionMode?: string | null;
  isResume?: boolean | null;
  timestamp: string;
};

export type LocalSessionCanvasLayoutRecord = {
  sessionName: string;
  layoutJson: string;
  updatedAt: string;
};

export type LocalSessionWorkspacePreparationRecord = {
  preparationId: string;
  projectId?: string | null;
  projectPath: string;
  contextFingerprint: string;
  sessionName: string;
  payloadJson: string;
  status: string;
  cancelRequested: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  consumedAt?: string | null;
  releasedAt?: string | null;
};

export type LocalDraftRecord = {
  id: string;
  projectId?: string | null;
  projectPath?: string | null;
  repoPath?: string | null;
  branchName?: string | null;
  gitContextsJson?: string | null;
  message: string;
  attachmentPathsJson: string;
  agentProvider: string;
  model: string;
  reasoningEffort?: string | null;
  timestamp: string;
  title: string;
  startupScript: string;
  devServerScript: string;
  sessionMode: string;
};

export type LocalQuickCreateDraftRecord = {
  id: string;
  title: string;
  message: string;
  attachmentPathsJson: string;
  lastError: string;
  createdAt: string;
  updatedAt: string;
};

export type LocalSessionAgentHistoryRecord = {
  sessionName: string;
  itemId: string;
  threadId?: string | null;
  turnId?: string | null;
  ordinal: number;
  kind: string;
  status?: string | null;
  payloadJson: string;
  createdAt: string;
  updatedAt: string;
};

export type LocalState = {
  version: 1;
  projects: Record<string, LocalProjectRecord>;
  repositories: Record<string, LocalRepositoryRecord>;
  appSettings: LocalAppSettingsRecord;
  appConfig: LocalAppConfigRecord;
  gitRepoCredentials: Record<string, string>;
  credentialsMetadata: LocalCredentialMetadataRecord[];
  agentApiCredentialsMetadata: LocalAgentApiCredentialMetadataRecord[];
  sessions: Record<string, LocalSessionRecord>;
  sessionLaunchContexts: Record<string, LocalSessionLaunchContextRecord>;
  sessionCanvasLayouts: Record<string, LocalSessionCanvasLayoutRecord>;
  sessionWorkspacePreparations: Record<string, LocalSessionWorkspacePreparationRecord>;
  drafts: Record<string, LocalDraftRecord>;
  quickCreateDrafts: Record<string, LocalQuickCreateDraftRecord>;
  sessionAgentHistoryItems: Record<string, Record<string, LocalSessionAgentHistoryRecord>>;
};

let stateCache: LocalState | null = null;

function createDefaultState(): LocalState {
  return {
    version: 1,
    projects: {},
    repositories: {},
    appSettings: {},
    appConfig: {
      recentProjects: [],
      homeProjectSort: 'last-update',
      defaultRoot: '',
      selectedIde: 'vscode',
      agentWidth: 66.666,
      pinnedFolderShortcuts: [],
      projectSettings: {},
    },
    gitRepoCredentials: {},
    credentialsMetadata: [],
    agentApiCredentialsMetadata: [],
    sessions: {},
    sessionLaunchContexts: {},
    sessionCanvasLayouts: {},
    sessionWorkspacePreparations: {},
    drafts: {},
    quickCreateDrafts: {},
    sessionAgentHistoryItems: {},
  };
}

function cloneState<T>(value: T): T {
  return structuredClone(value);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function normalizeRecord<T>(value: unknown, mapper: (entry: unknown, key: string) => T | null): Record<string, T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const result: Record<string, T> = {};
  for (const [key, entry] of entries) {
    const mapped = mapper(entry, key);
    if (mapped) {
      result[key] = mapped;
    }
  }
  return result;
}

function normalizeState(raw: unknown): LocalState {
  const defaults = createDefaultState();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return defaults;
  }

  const input = raw as Record<string, unknown>;
  const appConfigInput = input.appConfig && typeof input.appConfig === 'object' && !Array.isArray(input.appConfig)
    ? input.appConfig as Record<string, unknown>
    : {};

  return {
    version: 1,
    projects: normalizeRecord(input.projects, (entry, key) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      return {
        id: typeof record.id === 'string' ? record.id : key,
        name: typeof record.name === 'string' ? record.name : key,
        folderPaths: normalizeStringArray(record.folderPaths),
        iconPath: typeof record.iconPath === 'string' || record.iconPath === null ? record.iconPath : undefined,
        lastOpenedAt: typeof record.lastOpenedAt === 'string' || record.lastOpenedAt === null
          ? record.lastOpenedAt
          : undefined,
      };
    }),
    repositories: normalizeRecord(input.repositories, (entry, key) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      return {
        path: typeof record.path === 'string' ? record.path : key,
        name: typeof record.name === 'string' ? record.name : key,
        displayName: typeof record.displayName === 'string' || record.displayName === null
          ? record.displayName
          : undefined,
        expandedFolders: Array.isArray(record.expandedFolders)
          ? normalizeStringArray(record.expandedFolders)
          : undefined,
        visibilityMap: record.visibilityMap && typeof record.visibilityMap === 'object' && !Array.isArray(record.visibilityMap)
          ? record.visibilityMap as Record<string, 'visible' | 'hidden'>
          : undefined,
        localGroupExpanded: typeof record.localGroupExpanded === 'boolean' || record.localGroupExpanded === null
          ? record.localGroupExpanded
          : undefined,
        remotesGroupExpanded: typeof record.remotesGroupExpanded === 'boolean' || record.remotesGroupExpanded === null
          ? record.remotesGroupExpanded
          : undefined,
        worktreesGroupExpanded: typeof record.worktreesGroupExpanded === 'boolean' || record.worktreesGroupExpanded === null
          ? record.worktreesGroupExpanded
          : undefined,
      };
    }),
    appSettings: input.appSettings && typeof input.appSettings === 'object' && !Array.isArray(input.appSettings)
      ? input.appSettings as LocalAppSettingsRecord
      : defaults.appSettings,
    appConfig: {
      recentProjects: normalizeStringArray(appConfigInput.recentProjects),
      homeProjectSort: typeof appConfigInput.homeProjectSort === 'string'
        ? appConfigInput.homeProjectSort
        : defaults.appConfig.homeProjectSort,
      defaultRoot: typeof appConfigInput.defaultRoot === 'string' ? appConfigInput.defaultRoot : defaults.appConfig.defaultRoot,
      selectedIde: typeof appConfigInput.selectedIde === 'string' ? appConfigInput.selectedIde : defaults.appConfig.selectedIde,
      agentWidth: typeof appConfigInput.agentWidth === 'number' ? appConfigInput.agentWidth : defaults.appConfig.agentWidth,
      defaultAgentProvider: typeof appConfigInput.defaultAgentProvider === 'string' || appConfigInput.defaultAgentProvider === null
        ? appConfigInput.defaultAgentProvider
        : undefined,
      defaultAgentModel: typeof appConfigInput.defaultAgentModel === 'string' || appConfigInput.defaultAgentModel === null
        ? appConfigInput.defaultAgentModel
        : undefined,
      defaultAgentReasoningEffort:
        typeof appConfigInput.defaultAgentReasoningEffort === 'string'
        || appConfigInput.defaultAgentReasoningEffort === null
          ? appConfigInput.defaultAgentReasoningEffort
          : undefined,
      pinnedFolderShortcuts: normalizeStringArray(appConfigInput.pinnedFolderShortcuts),
      projectSettings: normalizeRecord(appConfigInput.projectSettings, (entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
        return entry as LocalProjectSettingsRecord;
      }),
    },
    gitRepoCredentials: normalizeRecord(input.gitRepoCredentials, (entry) => (
      typeof entry === 'string' ? entry : null
    )),
    credentialsMetadata: Array.isArray(input.credentialsMetadata)
      ? input.credentialsMetadata.filter((entry): entry is LocalCredentialMetadataRecord => (
        Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
      ))
      : [],
    agentApiCredentialsMetadata: Array.isArray(input.agentApiCredentialsMetadata)
      ? input.agentApiCredentialsMetadata.filter((entry): entry is LocalAgentApiCredentialMetadataRecord => (
        Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
      ))
      : [],
    sessions: normalizeRecord(input.sessions, (entry, key) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      return {
        sessionName: typeof record.sessionName === 'string' ? record.sessionName : key,
        projectId: typeof record.projectId === 'string' || record.projectId === null ? record.projectId : undefined,
        projectPath: typeof record.projectPath === 'string' ? record.projectPath : '',
        workspacePath: typeof record.workspacePath === 'string' ? record.workspacePath : '',
        workspaceFoldersJson: typeof record.workspaceFoldersJson === 'string' || record.workspaceFoldersJson === null
          ? record.workspaceFoldersJson
          : undefined,
        workspaceMode: typeof record.workspaceMode === 'string' ? record.workspaceMode : 'folder',
        activeRepoPath: typeof record.activeRepoPath === 'string' || record.activeRepoPath === null
          ? record.activeRepoPath
          : undefined,
        repoPath: typeof record.repoPath === 'string' || record.repoPath === null ? record.repoPath : undefined,
        worktreePath: typeof record.worktreePath === 'string' || record.worktreePath === null
          ? record.worktreePath
          : undefined,
        branchName: typeof record.branchName === 'string' || record.branchName === null
          ? record.branchName
          : undefined,
        baseBranch: typeof record.baseBranch === 'string' || record.baseBranch === null
          ? record.baseBranch
          : undefined,
        agent: typeof record.agent === 'string' ? record.agent : 'codex',
        model: typeof record.model === 'string' ? record.model : '',
        reasoningEffort: typeof record.reasoningEffort === 'string' || record.reasoningEffort === null
          ? record.reasoningEffort
          : undefined,
        threadId: typeof record.threadId === 'string' || record.threadId === null ? record.threadId : undefined,
        activeTurnId: typeof record.activeTurnId === 'string' || record.activeTurnId === null
          ? record.activeTurnId
          : undefined,
        runState: typeof record.runState === 'string' || record.runState === null ? record.runState : undefined,
        lastError: typeof record.lastError === 'string' || record.lastError === null ? record.lastError : undefined,
        lastActivityAt: typeof record.lastActivityAt === 'string' || record.lastActivityAt === null
          ? record.lastActivityAt
          : undefined,
        title: typeof record.title === 'string' || record.title === null ? record.title : undefined,
        devServerScript: typeof record.devServerScript === 'string' || record.devServerScript === null
          ? record.devServerScript
          : undefined,
        initialized: typeof record.initialized === 'boolean' || record.initialized === null
          ? record.initialized
          : undefined,
        timestamp: typeof record.timestamp === 'string' ? record.timestamp : new Date(0).toISOString(),
        gitRepos: Array.isArray(record.gitRepos)
          ? record.gitRepos.filter((gitRepo): gitRepo is LocalSessionGitRepoRecord => (
            Boolean(gitRepo) && typeof gitRepo === 'object' && !Array.isArray(gitRepo)
          ))
          : [],
      };
    }),
    sessionLaunchContexts: normalizeRecord(input.sessionLaunchContexts, (entry, key) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      return {
        sessionName: typeof record.sessionName === 'string' ? record.sessionName : key,
        title: typeof record.title === 'string' || record.title === null ? record.title : undefined,
        initialMessage: typeof record.initialMessage === 'string' || record.initialMessage === null
          ? record.initialMessage
          : undefined,
        rawInitialMessage: typeof record.rawInitialMessage === 'string' || record.rawInitialMessage === null
          ? record.rawInitialMessage
          : undefined,
        startupScript: typeof record.startupScript === 'string' || record.startupScript === null
          ? record.startupScript
          : undefined,
        attachmentPathsJson:
          typeof record.attachmentPathsJson === 'string' || record.attachmentPathsJson === null
            ? record.attachmentPathsJson
            : undefined,
        attachmentNamesJson:
          typeof record.attachmentNamesJson === 'string' || record.attachmentNamesJson === null
            ? record.attachmentNamesJson
            : undefined,
        projectRepoPathsJson:
          typeof record.projectRepoPathsJson === 'string' || record.projectRepoPathsJson === null
            ? record.projectRepoPathsJson
            : undefined,
        projectRepoRelativePathsJson:
          typeof record.projectRepoRelativePathsJson === 'string' || record.projectRepoRelativePathsJson === null
            ? record.projectRepoRelativePathsJson
            : undefined,
        agentProvider: typeof record.agentProvider === 'string' || record.agentProvider === null
          ? record.agentProvider
          : undefined,
        model: typeof record.model === 'string' || record.model === null ? record.model : undefined,
        reasoningEffort:
          typeof record.reasoningEffort === 'string' || record.reasoningEffort === null
            ? record.reasoningEffort
            : undefined,
        sessionMode: typeof record.sessionMode === 'string' || record.sessionMode === null
          ? record.sessionMode
          : undefined,
        isResume: typeof record.isResume === 'boolean' || record.isResume === null ? record.isResume : undefined,
        timestamp: typeof record.timestamp === 'string' ? record.timestamp : new Date(0).toISOString(),
      };
    }),
    sessionCanvasLayouts: normalizeRecord(input.sessionCanvasLayouts, (entry, key) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      return {
        sessionName: typeof record.sessionName === 'string' ? record.sessionName : key,
        layoutJson: typeof record.layoutJson === 'string' ? record.layoutJson : '',
        updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString(),
      };
    }),
    sessionWorkspacePreparations: normalizeRecord(input.sessionWorkspacePreparations, (entry, key) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      return {
        preparationId: typeof record.preparationId === 'string' ? record.preparationId : key,
        projectId: typeof record.projectId === 'string' || record.projectId === null ? record.projectId : undefined,
        projectPath: typeof record.projectPath === 'string' ? record.projectPath : '',
        contextFingerprint: typeof record.contextFingerprint === 'string' ? record.contextFingerprint : '',
        sessionName: typeof record.sessionName === 'string' ? record.sessionName : '',
        payloadJson: typeof record.payloadJson === 'string' ? record.payloadJson : '',
        status: typeof record.status === 'string' ? record.status : '',
        cancelRequested: Boolean(record.cancelRequested),
        createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date(0).toISOString(),
        updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString(),
        expiresAt: typeof record.expiresAt === 'string' ? record.expiresAt : new Date(0).toISOString(),
        consumedAt: typeof record.consumedAt === 'string' || record.consumedAt === null ? record.consumedAt : undefined,
        releasedAt: typeof record.releasedAt === 'string' || record.releasedAt === null ? record.releasedAt : undefined,
      };
    }),
    drafts: normalizeRecord(input.drafts, (entry, key) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      return {
        id: typeof record.id === 'string' ? record.id : key,
        projectId: typeof record.projectId === 'string' || record.projectId === null ? record.projectId : undefined,
        projectPath: typeof record.projectPath === 'string' || record.projectPath === null
          ? record.projectPath
          : undefined,
        repoPath: typeof record.repoPath === 'string' || record.repoPath === null ? record.repoPath : undefined,
        branchName:
          typeof record.branchName === 'string' || record.branchName === null
            ? record.branchName
            : undefined,
        gitContextsJson:
          typeof record.gitContextsJson === 'string' || record.gitContextsJson === null
            ? record.gitContextsJson
            : undefined,
        message: typeof record.message === 'string' ? record.message : '',
        attachmentPathsJson: typeof record.attachmentPathsJson === 'string' ? record.attachmentPathsJson : '[]',
        agentProvider: typeof record.agentProvider === 'string' ? record.agentProvider : 'codex',
        model: typeof record.model === 'string' ? record.model : '',
        reasoningEffort:
          typeof record.reasoningEffort === 'string' || record.reasoningEffort === null
            ? record.reasoningEffort
            : undefined,
        timestamp: typeof record.timestamp === 'string' ? record.timestamp : new Date(0).toISOString(),
        title: typeof record.title === 'string' ? record.title : '',
        startupScript: typeof record.startupScript === 'string' ? record.startupScript : '',
        devServerScript: typeof record.devServerScript === 'string' ? record.devServerScript : '',
        sessionMode: typeof record.sessionMode === 'string' ? record.sessionMode : 'fast',
      };
    }),
    quickCreateDrafts: normalizeRecord(input.quickCreateDrafts, (entry, key) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      return {
        id: typeof record.id === 'string' ? record.id : key,
        title: typeof record.title === 'string' ? record.title : '',
        message: typeof record.message === 'string' ? record.message : '',
        attachmentPathsJson: typeof record.attachmentPathsJson === 'string' ? record.attachmentPathsJson : '[]',
        lastError: typeof record.lastError === 'string' ? record.lastError : '',
        createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date(0).toISOString(),
        updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString(),
      };
    }),
    sessionAgentHistoryItems: normalizeRecord(input.sessionAgentHistoryItems, (entry) => (
      normalizeRecord(entry, (historyEntry) => {
        if (!historyEntry || typeof historyEntry !== 'object' || Array.isArray(historyEntry)) return null;
        return historyEntry as LocalSessionAgentHistoryRecord;
      })
    )),
  };
}

function ensureVibaDir(): void {
  fs.mkdirSync(VIBA_DIR, { recursive: true });
}

function secureStateFilePermissions(): void {
  try {
    fs.chmodSync(STATE_PATH, 0o600);
  } catch {
    // Ignore permission errors on platforms that do not support POSIX modes.
  }
}

function writeStateToDisk(state: LocalState): void {
  ensureVibaDir();
  const tempPath = `${STATE_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tempPath, STATE_PATH);
  secureStateFilePermissions();
}

function loadStateFromDisk(): LocalState {
  ensureVibaDir();
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    return normalizeState(JSON.parse(raw) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[local-db] Failed to parse local state file, resetting to defaults.', error);
    }
    const nextState = createDefaultState();
    writeStateToDisk(nextState);
    return nextState;
  }
}

function getStateReference(): LocalState {
  if (!stateCache) {
    stateCache = loadStateFromDisk();
  }
  return stateCache;
}

export function readLocalState(): LocalState {
  return cloneState(getStateReference());
}

export function writeLocalState(nextState: LocalState): void {
  const normalized = normalizeState(nextState);
  writeStateToDisk(normalized);
  stateCache = normalized;
}

export function updateLocalState<T>(updater: (state: LocalState) => T): T {
  const draft = cloneState(getStateReference());
  const result = updater(draft);
  writeLocalState(draft);
  return result;
}

export function resetLocalStateForTests(): void {
  stateCache = null;
}

export function getLocalDbPath(): string {
  return STATE_PATH;
}

export function getVibaDirPath(): string {
  return VIBA_DIR;
}
