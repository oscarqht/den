# Data Model

## Persistence Overview

Palx now uses a local JSON state file for metadata/config persistence.

Primary storage location:
- `~/.viba/palx-state.json` (single-file JSON state store), initialized by [src/lib/local-db.ts](../../src/lib/local-db.ts).

What is persisted in the state file:
- repository records and UI repository state.
- app settings and app config.
- per-repo settings.
- session metadata and launch context.
- draft metadata.
- git credential metadata.
- agent API credential metadata.

What remains file-based:
- session prompt text files at `~/.viba/session-prompts/*.txt` ([src/app/actions/session.ts](../../src/app/actions/session.ts)).
- repository clones and worktree directories on disk ([src/app/actions/repository.ts](../../src/app/actions/repository.ts), [src/app/actions/git.ts](../../src/app/actions/git.ts)).

Secret material:
- secrets are still stored in OS keychain via `keytar` (tokens/API keys), not in the JSON state file ([src/lib/credentials.ts](../../src/lib/credentials.ts), [src/lib/agent-api-credentials.ts](../../src/lib/agent-api-credentials.ts)).

## State File Groups

Defined in [src/lib/local-db.ts](../../src/lib/local-db.ts).

- Repository/settings sections:
  - `repositories`
  - `appSettings`
- App config sections:
  - `appConfig`
  - `gitRepoCredentials`
- Credential metadata sections:
  - `credentialsMetadata`
  - `agentApiCredentialsMetadata`
- Session/draft sections:
  - `sessions`
  - `sessionLaunchContexts`
  - `sessionCanvasLayouts`
  - `sessionWorkspacePreparations`
  - `drafts`
  - `quickCreateDrafts`
  - `sessionAgentHistoryItems`
- Versioning:
  - top-level `version`

## Entities and Schemas

### Repository record
Defined in [src/lib/types.ts](../../src/lib/types.ts), persisted by [src/lib/store.ts](../../src/lib/store.ts) into `repositories`.

Key fields:
- `path`, `name`, optional `displayName`
- `lastOpenedAt`
- `credentialId`
- tree visibility/expansion fields (`visibilityMap`, `expandedFolders`, etc.)

### App settings (store)
Defined in [src/lib/types.ts](../../src/lib/types.ts), persisted by [src/lib/store.ts](../../src/lib/store.ts) into `appSettings`.

Key fields:
- `defaultRootFolder`
- `sidebarCollapsed`
- `historyPanelHeight`

### App config
Defined in [src/app/actions/config.ts](../../src/app/actions/config.ts), persisted into:
- `appConfig`
- `gitRepoCredentials`

Key fields:
- `recentRepos[]`
- `defaultRoot`
- `selectedIde`
- `agentWidth`
- `repoSettings` map
- `pinnedFolderShortcuts[]`

`repoSettings` entries include:
- `agentProvider`, `agentModel`, `startupScript`, `devServerScript`, `lastBranch`, `credentialId`, `credentialPreference`.

### Session metadata
Defined in [src/app/actions/session.ts](../../src/app/actions/session.ts), persisted in `sessions`.

Key fields:
- `sessionName`
- `repoPath`, `worktreePath`, `branchName`, `baseBranch`
- `agent`, `model`, optional `title`, optional `devServerScript`
- `initialized`
- `timestamp`

### Session launch context
Defined in [src/app/actions/session.ts](../../src/app/actions/session.ts), persisted in `sessionLaunchContexts`.

Key fields:
- `initialMessage`, `rawInitialMessage`
- `startupScript`
- `attachmentPaths[]`, `attachmentNames[]`
- `agentProvider`, `model`, `sessionMode`, `isResume`

### Draft metadata
Defined in [src/app/actions/draft.ts](../../src/app/actions/draft.ts), persisted in `drafts`.

### Git credential metadata
Defined in [src/lib/credentials.ts](../../src/lib/credentials.ts), persisted in `credentialsMetadata`.

Key fields:
- `id`, `type`, `username`, optional `serverUrl`
- timestamps
- optional `keytarAccount`

Secret value (token) is stored in keychain service `viba-git-credentials`.

### Agent API credential metadata
Defined in [src/lib/agent-api-credentials.ts](../../src/lib/agent-api-credentials.ts), persisted in `agentApiCredentialsMetadata`.

Secret value (api key) is stored in keychain service `viba-agent-api-credentials`.

## Relationships

```mermaid
erDiagram
  REPOSITORY ||--o{ SESSION : source_repoPath
  SESSION ||--|| SESSION_CONTEXT : sessionName
  SESSION ||--o{ DRAFT : seeds_new_drafts
  REPOSITORY ||--o| REPO_SETTINGS : config_repoSettings_path
  REPOSITORY }o--o| CREDENTIAL : credentialId
  AGENT_API_CREDENTIAL ||--o{ SESSION_CONTEXT : agentProvider_model_hints

  REPOSITORY {
    string path
    string name
    string displayName
    string credentialId
  }
  SESSION {
    string sessionName
    string repoPath
    string worktreePath
    string branchName
    string baseBranch
    string agent
    boolean initialized
    string timestamp
  }
  SESSION_CONTEXT {
    string sessionName
    string initialMessage
    string startupScript
    string sessionMode
  }
  DRAFT {
    string id
    string repoPath
    string branchName
    string sessionMode
  }
  REPO_SETTINGS {
    string repoPath
    string startupScript
    string devServerScript
    string credentialId
  }
  CREDENTIAL {
    string id
    string type
    string username
    string serverUrl
  }
  AGENT_API_CREDENTIAL {
    string agent
    string apiProxy
  }
```

## Concurrency and Consistency Notes

- Writes are centralized through the local state layer in [src/lib/local-db.ts](../../src/lib/local-db.ts).
- State writes are atomic at the file level: the new payload is written to a temporary file and then renamed into place.
- The in-process cache is authoritative during a running server action, so concurrent multi-process writes are weaker than the old SQLite transactions.
- In-memory global maps are still used for long-lived process state:
  - preview proxy instances (`__vibaPreviewProxyStates`)
  - notification socket state (`__vibaSessionNotificationServerState`)
  - git client instance cache (`gitInstances` in [src/lib/git.ts](../../src/lib/git.ts))

## Normalization and Versioning

- `src/lib/local-db.ts` normalizes partial or malformed state back to the current `version: 1` structure when reading.
- There are no relational indexes; callers work against in-memory objects and arrays after the file is loaded.
- There is no SQLite migration layer anymore. If the state file is missing, Palx recreates defaults on first write.

## Gotchas

- Session prompts intentionally remain text files (`~/.viba/session-prompts`), so session persistence is split between JSON metadata and prompt files.
- Credential metadata may exist without keychain secret if keytar is unavailable or secrets were removed; callers treat missing token as unauthenticated.
