#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { withServerActionsEncryptionKey } from "../src/lib/server-actions-key.mjs";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "..");
const nextBin = require.resolve("next/dist/bin/next");

const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], {
  cwd: APP_ROOT,
  env: withServerActionsEncryptionKey(process.env, { appRoot: APP_ROOT }),
  stdio: "inherit",
});

child.on("error", (error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`Failed to launch Next.js: ${detail}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
