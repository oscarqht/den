# AGENTS.md

## Next.js / Turbopack tracing

- Treat server-side `path.resolve`, `path.join`, `fs.readFile`, `fs.readdir`, `fs.stat`, `fs.access`, `fs.existsSync`, and similar filesystem calls as potential output-file-tracing hazards when they operate on runtime paths.
- Do not introduce broad path resolution rooted at user input, workspace paths, repo paths, home directories, temp directories, or other dynamic absolute paths in code that can be imported by Next.js server components, route handlers, or server actions without guarding it.
- When those runtime filesystem/path operations are necessary, annotate the dynamic path argument with `/* turbopackIgnore: true */` so Turbopack/NFT does not trace the whole project by mistake.
- Prefer statically scoped paths when possible. Example: `path.join(process.cwd(), 'data', name)` is safer than resolving arbitrary runtime roots.
- If a build shows `Encountered unexpected file in NFT list` for `next.config.mjs`, inspect the import trace first instead of changing config blindly. The usual root cause is a runtime filesystem/path operation in server code, not `next.config.mjs` itself.
- Keep `outputFileTracingExcludes` in [`next.config.mjs`](/Users/tangqh/Downloads/projects/den/next.config.mjs) aligned with repo-only assets that should never be part of server traces, but use that as a backstop rather than the primary fix.

## Build and packaging

- Use the repo scripts in [`package.json`](/Users/tangqh/Downloads/projects/den/package.json) for app lifecycle: `npm run dev`, `npm run build`, and `npm run start`. Do not invoke `next dev`, `next build`, or `next start` directly unless you are intentionally debugging the wrapper.
- The wrapper script [`scripts/run-next-with-server-actions-key.mjs`](/Users/tangqh/Downloads/projects/den/scripts/run-next-with-server-actions-key.mjs) is important. It stabilizes the server actions encryption key and resolves the startup port. Bypassing it can create hard-to-reproduce behavior differences between dev, build, start, and packaged runs.
- `postbuild` runs [`scripts/copy-next-shims.mjs`](/Users/tangqh/Downloads/projects/den/scripts/copy-next-shims.mjs) to sync native shims into `.next`. If you touch native-module loading, packaging, or `keytar` behavior, verify both `npm run build` and the related shim tests.
- The npm package publishes built `.next` assets directly. Changes to the `files` list, build output shape, or postbuild behavior can break the CLI/package even when local dev still works. Treat packaging changes as high-risk and verify with `npm run pack:preview` when relevant.

## Native modules and credentials

- `keytar` is a native dependency and is intentionally handled carefully. Prefer dynamic loading patterns like the existing loader in [`src/lib/keytar-loader.ts`](/Users/tangqh/Downloads/projects/den/src/lib/keytar-loader.ts) instead of eager imports in shared server code.
- Keep `keytar` server-only. Do not let native-module code leak into client bundles or generic shared utilities that might be imported by client components.

## Tests and local state

- Tests run through Node's built-in test runner with `node --experimental-strip-types --test src/**/*.test.ts test/**/*.test.mjs`. Follow that pattern for new tests instead of introducing a second test harness unless there is a strong reason.
- This project uses real filesystem-oriented server helpers and stores app state under `~/.viba`. New tests for stateful or filesystem code should prefer temp directories, injected paths, or existing helper seams so they do not mutate a developer's real local state.
