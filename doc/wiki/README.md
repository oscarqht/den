# Palx Code Wiki

This wiki documents the Palx codebase from architecture to implementation details. It is intended for both human engineers and coding agents.

## How To Use This Wiki

1. Start with [Architecture](./Architecture.md) for system boundaries and runtime flows.
2. Read [Project Layout](./Project-Layout.md) to map responsibilities to directories/files.
3. Read feature pages under [Features](./Features/) for user-facing and subsystem behavior.
4. Use [API and Interfaces](./API-and-Interfaces.md) and [Data Model](./Data-Model.md) when building integrations or migrations.
5. Use [Operations](./Operations.md) and [Contributing](./Contributing.md) for day-to-day development and release work.

All claims in this wiki are grounded in concrete code references.

## Table Of Contents

- [Architecture](./Architecture.md)
- [Project Layout](./Project-Layout.md)
- [API and Interfaces](./API-and-Interfaces.md)
- [Data Model](./Data-Model.md)
- [Operations](./Operations.md)
- [Contributing](./Contributing.md)
- Features
- [Repository Onboarding and Selection](./Features/Repository-Onboarding-and-Selection.md)
- [Session Lifecycle and Worktrees](./Features/Session-Lifecycle-and-Worktrees.md)
- [Terminal Orchestration and Agent Bootstrap](./Features/Terminal-Orchestration-and-Agent-Bootstrap.md)
- [Git Workspace Operations](./Features/Git-Workspace-Operations.md)
- [Credentials and Authentication](./Features/Credentials-and-Authentication.md)
- [Preview Proxy and Element Picker](./Features/Preview-Proxy-and-Element-Picker.md)
- [Notifications and Session Signals](./Features/Notifications-and-Session-Signals.md)
- [CLI Launch and Packaging](./Features/CLI-Launch-and-Packaging.md)

## Glossary

- `Repository`: A source repository recorded by Palx, persisted in `repos.json` ([src/lib/store.ts](../../src/lib/store.ts)).
- `Session`: A task workspace with metadata (`~/.viba/sessions/<session>.json`) and launch context (`~/.viba/session-contexts/<session>.json`) ([src/app/actions/session.ts](../../src/app/actions/session.ts)).
- `Worktree`: The git worktree created per session under `<repo-parent>/.viba/<repo-name>/<session>` ([src/app/actions/git.ts](../../src/app/actions/git.ts)).
- `Session Branch`: Branch named `palx/<session>` created with each worktree ([src/app/actions/git.ts](../../src/app/actions/git.ts)).
- `Base Branch`: Branch from which the session branch/worktree is created and later merged/rebased ([src/app/actions/session.ts](../../src/app/actions/session.ts)).
- `Agent Terminal`: Left ttyd/tmux-backed terminal used to run Codex ([src/components/SessionView.tsx](../../src/components/SessionView.tsx)).
- `Floating Terminal`: Secondary ttyd/tmux terminal panel for dev server and ad-hoc commands ([src/components/SessionView.tsx](../../src/components/SessionView.tsx)).
- `Preview Proxy`: Local HTTP proxy used to load app previews and inject a DOM picker script ([src/lib/previewProxyServer.ts](../../src/lib/previewProxyServer.ts)).
- `Session Notification`: Event delivered via local WebSocket keyed by `sessionId` ([src/lib/sessionNotificationServer.ts](../../src/lib/sessionNotificationServer.ts)).
- `Repo Settings`: Per-repo preferences in `~/.viba/config.json` (`agentProvider`, scripts, credential selection, etc.) ([src/app/actions/config.ts](../../src/app/actions/config.ts)).
- `Credential`: Git host credentials metadata in `~/.viba/credentials.json` and token in OS keychain via `keytar` ([src/lib/credentials.ts](../../src/lib/credentials.ts)).
- `Agent API Credential`: API key/proxy metadata in `~/.viba/agent-api-configs.json` and secret in keychain ([src/lib/agent-api-credentials.ts](../../src/lib/agent-api-credentials.ts)).
