# Contributing

## Coding Conventions

## TypeScript and framework conventions
- Use strict TypeScript (`"strict": true`) per [tsconfig.json](../../tsconfig.json).
- Follow Next.js App Router boundaries:
- route handlers under `src/app/api/*`
- server actions under `src/app/actions/*` with `'use server'`
- client components/hooks with `'use client'`

## Lint/format conventions
- ESLint uses Next core-web-vitals + TypeScript presets ([eslint.config.mjs](../../eslint.config.mjs)).
- Tailwind + DaisyUI styles are configured in [src/app/globals.css](../../src/app/globals.css).

## Domain-level patterns used by this repo
- Git operations should be centralized in `GitService` ([src/lib/git.ts](../../src/lib/git.ts)).
- API validation commonly uses Zod in route handlers.
- Frontend data access should prefer React Query hooks under `src/hooks/`.
- Prefer existing helper modules for path/url/shell quoting/terminal handling.

## How To Add a New Feature

1. Identify boundary:
- UI-only behavior: add in `src/components/*` and relevant route page.
- Server-side behavior: add server action or API route.
- Cross-cutting/git/terminal behavior: add to `src/lib/*` and reuse through actions/routes.
2. Extend interfaces and types in [src/lib/types.ts](../../src/lib/types.ts) where shared.
3. Add request validation for new API payloads using Zod.
4. Wire React Query hook in [src/hooks/use-git.ts](../../src/hooks/use-git.ts) or a dedicated hook if endpoint-specific.
5. Add/update documentation in `doc/wiki` for new modules/contracts.

## How To Add Tests

Current test stack is Node's built-in test runner (`node:test`) and `.test.ts/.test.mjs` files.

Recommended placement:
- library helpers: `src/lib/<module>.test.ts`
- component-level pure utilities: colocated in `src/components/**`
- CLI behavior: `test/bin/*.test.mjs`

When adding tests:
- focus on deterministic unit behavior (parser, normalizers, planners, serializers, edge-case guards).
- avoid tests that rely on platform-specific binaries unless mocked/isolated.

## Run CI Checks Locally

The closest local CI-equivalent checks:

```bash
npm run lint
npm test
npm run build
```

If touching launcher/package behavior, also run:

```bash
npm run pack:preview
```

## High-Impact Areas (Review Carefully)

- Session bootstrap command injection and instruction composition in [src/components/SessionView.tsx](../../src/components/SessionView.tsx).
- Git mutation dispatcher in [src/app/api/git/action/route.ts](../../src/app/api/git/action/route.ts).
- Credential persistence and keytar integration in [src/lib/credentials.ts](../../src/lib/credentials.ts) and [src/lib/agent-api-credentials.ts](../../src/lib/agent-api-credentials.ts).
- Middleware auth exemptions in [src/middleware.ts](../../src/middleware.ts).

## Known Architectural Debt

- Dual config stores (`src/lib/store.ts` app-data path vs `~/.viba/config.json` actions config) should be considered when changing settings behavior.
- Some components appear legacy/unwired (`src/components/repo-list.tsx`) and may not reflect active route behavior.
