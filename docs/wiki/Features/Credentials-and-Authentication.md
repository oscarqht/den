# Settings and Credentials

## What This Feature Does

User-facing behavior:
- Settings UI for default coding agent preferences plus GitHub/GitLab git tokens and Codex API key/proxy.
- Automatic credential selection for clone/push/pull based on remote provider/host.

System-facing behavior:
- Validates tokens against provider APIs before persistence.
- Stores credential metadata in the local JSON state file and secrets in OS keychain via `keytar`.
- Injects credential environment variables into ttyd terminal sessions.

## Key Modules and Responsibilities

- Credential persistence and host matching:
- [src/lib/credentials.ts](../../../src/lib/credentials.ts)
- Agent API credential persistence:
- [src/lib/agent-api-credentials.ts](../../../src/lib/agent-api-credentials.ts)
- Settings page UI:
- [src/app/settings/page.tsx](../../../src/app/settings/page.tsx)
- Credentials routes/actions:
- [src/app/api/credentials/route.ts](../../../src/app/api/credentials/route.ts)
- [src/app/api/credentials/github/repos/route.ts](../../../src/app/api/credentials/github/repos/route.ts)
- [src/app/actions/credentials.ts](../../../src/app/actions/credentials.ts)

## Public Interfaces

### Credential APIs
- `GET /api/credentials`: list metadata.
- `POST /api/credentials`: create `github` or `gitlab` credential.
- `PUT /api/credentials`: rotate token by credential id.
- `DELETE /api/credentials`: remove credential.
- `GET /api/credentials/github/repos?credentialId=...`: list GitHub repos via token.

### Credential server actions
- `saveGitHubCredential`, `saveGitLabCredential`, `removeCredential`.
- `saveAgentApiCredential`, `removeAgentApiCredential`.

All in [src/app/actions/credentials.ts](../../../src/app/actions/credentials.ts).

## Data Model and Storage Touches

- Git credentials metadata: `credentialsMetadata` in `~/.viba/palx-state.json`.
- Agent API metadata: `agentApiCredentialsMetadata` in `~/.viba/palx-state.json`.
- Secrets: OS keychain using services:
- `viba-git-credentials`
- `viba-agent-api-credentials`

Implementation: [src/lib/credentials.ts](../../../src/lib/credentials.ts), [src/lib/agent-api-credentials.ts](../../../src/lib/agent-api-credentials.ts).

## Main Control Flow

```mermaid
sequenceDiagram
  actor User
  participant UI as settings page
  participant API as api_credentials
  participant Cred as lib/credentials
  participant Keytar as OS keychain
  participant Provider as GitHub/GitLab API

  User->>UI: Save token
  UI->>API: POST credential payload
  API->>Cred: create*Credential()
  Cred->>Provider: verify token and read username
  Provider-->>Cred: valid/invalid
  Cred->>Keytar: setPassword(service, account, token)
  Cred->>Cred: persist metadata in local state
  Cred-->>API: credential metadata
  API-->>UI: success/error
```

## Error Handling and Edge Cases

- If `keytar` is unavailable, create/update returns explicit secure-storage error and logs a warning once ([src/lib/credentials.ts](../../../src/lib/credentials.ts), [src/lib/agent-api-credentials.ts](../../../src/lib/agent-api-credentials.ts)).
- Duplicate credentials are blocked per host/user combination.
- Clone/push credential matching handles SSH and HTTPS remotes and GitLab host disambiguation ([src/lib/terminal-session.ts](../../../src/lib/terminal-session.ts), [src/lib/credentials.ts](../../../src/lib/credentials.ts), [src/app/actions/repository.ts](../../../src/app/actions/repository.ts)).
- Clone errors sanitize secret values from messages before returning to UI ([src/app/actions/repository.ts](../../../src/app/actions/repository.ts)).

## Observability

- Credential failures are logged (`console.error`) and surfaced in API/UI messages.

## Tests

No dedicated credential integration tests are present in this branch.
Supporting host parsing/provider detection tests:
- [src/lib/terminal-session.test.ts](../../../src/lib/terminal-session.test.ts).
