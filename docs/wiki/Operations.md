# Operations

## Local Development Setup

Prerequisites (from README and launcher logic):
- Node.js + npm ([README.md](../../README.md), [package.json](../../package.json)).
- `ttyd` installed and available in `PATH`.
- `tmux` for persistent terminal mode.
- No built-in application login layer is configured.

Install and run:

```bash
npm install
npm run dev
```

Alternative CLI run:

```bash
npm run cli
# or
npx den-ai
```

CLI can auto-install missing `ttyd`/`tmux` depending on platform strategy ([bin/viba.mjs](../../bin/viba.mjs)).

## Build, Test, and Lint

From [package.json](../../package.json):

```bash
npm run lint
npm test
npm run build
npm run start
```

Other useful scripts:

```bash
npm run prepack
npm run pack:preview
npm run tailscale
npm run tailscale:stop
```

Test entrypoints:
- Node tests over TS + MJS: `node --experimental-strip-types --test src/**/*.test.ts test/**/*.test.mjs`.

## Runtime Ports and Processes

- App default port: `3200`.
- Dev mode can auto-select next free port if `3200` is occupied (launcher behavior).
- ttyd port: `7681` (started by server action and proxied by Next rewrite `/terminal/*`).
- Preview proxy and notification socket servers use dynamic ephemeral ports on `127.0.0.1`.

### Tailscale exposure

- `npm run tailscale` expects Palx to already be reachable at `127.0.0.1:3200`.
- If the local machine is not connected to Tailscale yet, the script runs `tailscale up` so the user can complete login.
- Exposure uses Tailscale Serve to publish `http://127.0.0.1:3200` to the same tailnet and prints the MagicDNS/IP URLs returned by `tailscale status --json`.
- `npm run tailscale:stop` removes the Tailscale Serve mapping. It only runs `tailscale down` when the matching `npm run tailscale` invocation had to bring the machine onto the tailnet first.
- The script stores its stop-state at `.artifacts/tailscale-state.json`.

References:
- [bin/viba.mjs](../../bin/viba.mjs)
- [scripts/tailscale.mjs](../../scripts/tailscale.mjs)
- [src/app/actions/git.ts](../../src/app/actions/git.ts)
- [next.config.mjs](../../next.config.mjs)
- [src/lib/previewProxyServer.ts](../../src/lib/previewProxyServer.ts)
- [src/lib/sessionNotificationServer.ts](../../src/lib/sessionNotificationServer.ts)

## Deploy/Release Process

This repository uses GitHub Actions release automation:
- On `main` push, workflow bumps minor version, tags, and pushes:
- [.github/workflows/release-on-main-merge.yml](../../.github/workflows/release-on-main-merge.yml)
- Publish workflow publishes to npm from release tag context:
- [.github/workflows/publish-on-tag.yml](../../.github/workflows/publish-on-tag.yml)

NPM package expectations:
- Package includes prebuilt `.next` artifacts per `files` list in [package.json](../../package.json).
- `den-ai` production start assumes `.next/BUILD_ID` exists ([bin/viba.mjs](../../bin/viba.mjs)).

## Config, Secrets, and Environments

### Environment variables

Remote access note:
- Den no longer includes built-in app authentication.
- If you expose it beyond localhost, secure that access at the network or reverse-proxy layer.

Runtime/launcher:
- `PORT`
- `BROWSER` (`none|false|0` disables auto-open)
- `CODEX_HOME` (skills path override)

Session terminal env injection (derived at runtime):
- `GITHUB_TOKEN` or `GITLAB_TOKEN` for git auth.
- `OPENAI_API_KEY` and optional `OPENAI_BASE_URL` for Codex API access.

References:
- [README.md](../../README.md)
- [src/app/actions/git.ts](../../src/app/actions/git.ts)
- [src/lib/terminal-session.ts](../../src/lib/terminal-session.ts)

### Local state locations

- `~/.viba/palx-state.json` (local metadata/config state file)
- `~/.viba/session-prompts/*`
- `~/.viba/repos/*` (default clone destination for remote repository onboarding)

Legacy note:
- `palx-state.json` is the runtime source of truth for local metadata. Prompt text files and keychain secrets remain separate on purpose.

## Troubleshooting Guide

### App inaccessible / unauthorized
- If the app is exposed remotely, verify your network or proxy restrictions separately because Den does not enforce a login gate itself.

### Terminal not loading
- Check `ttyd` availability and process startup errors from `startTtydProcess` ([src/app/actions/git.ts](../../src/app/actions/git.ts)).
- Missing `tmux` degrades to shell mode; persistence features differ.
- Verify Next rewrite for `/terminal` is active ([next.config.mjs](../../next.config.mjs)).

### Git operations failing with lock file
- UI exposes lock cleanup action that triggers `cleanup-lock-file` API action ([src/hooks/use-git.ts](../../src/hooks/use-git.ts), [src/lib/git.ts](../../src/lib/git.ts)).

### Credential-related push/clone failures
- Ensure keytar is available; metadata without keychain secret behaves like missing token.
- Re-save credential from credentials page to verify token with provider API.
- Check repository-level `credentialId` selection in config/repo settings.

### Local metadata state issues
- Verify `~/.viba/palx-state.json` exists or can be created by the current user.
- If the file becomes corrupted, stop Palx, back up or remove `palx-state.json`, then restart so [src/lib/local-db.ts](../../src/lib/local-db.ts) can recreate normalized defaults.

### Preview not loading
- Preview URL must normalize to `http/https`; invalid schemes are rejected.
- Ensure target app is reachable from local machine.
- Proxy start endpoint returns explicit JSON error on failure.

### Notifications not arriving
- Ensure session page has active socket (`GET /api/notifications/socket`) and browser notification permission is granted.
- Session notifications are emitted from Palx-managed agent runtime transitions; no external notification ingress exists.
