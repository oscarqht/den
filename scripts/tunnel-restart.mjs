#!/usr/bin/env node

import { spawn } from "node:child_process";

const tunnelArgs = process.argv.slice(2);

if (tunnelArgs.length === 0) {
  console.error("Usage: node ./scripts/tunnel-restart.mjs <nport args...>");
  process.exit(1);
}

let shouldStop = false;
let activeChild = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startTunnel() {
  return new Promise((resolve) => {
    activeChild = spawn("nport", tunnelArgs, {
      stdio: "inherit",
      env: process.env,
    });

    activeChild.once("error", (error) => {
      activeChild = null;
      resolve({ code: 1, signal: null, error });
    });

    activeChild.once("exit", (code, signal) => {
      activeChild = null;
      resolve({ code, signal, error: null });
    });
  });
}

function stop(signal) {
  if (shouldStop) {
    return;
  }

  shouldStop = true;
  if (activeChild) {
    activeChild.kill(signal);
    return;
  }

  process.exit(0);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

while (!shouldStop) {
  const result = await startTunnel();
  if (shouldStop) {
    break;
  }

  const reason = result.error
    ? result.error.message
    : result.signal
      ? `signal ${result.signal}`
      : `exit code ${result.code ?? 0}`;
  const restartDelayMs = result.error || result.code ? 5_000 : 1_000;

  console.error(`nport stopped with ${reason}. Restarting in ${restartDelayMs / 1000}s...`);
  await sleep(restartDelayMs);
}
