#!/usr/bin/env node

import { readPalxRuntimeState, updatePalxRuntimeState } from "./palx-runtime.mjs";

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error && typeof error === "object" && "code" in error && error.code === "ESRCH");
  }
}

async function waitForExit(pid, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isProcessAlive(pid);
}

async function stopPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  if (!isProcessAlive(pid)) {
    return true;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") {
      return true;
    }
    throw error;
  }

  if (await waitForExit(pid, 3000)) {
    return true;
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") {
      return true;
    }
    throw error;
  }

  return await waitForExit(pid, 1500);
}

async function main() {
  const state = await readPalxRuntimeState();
  const pid = typeof state?.pid === "number" ? state.pid : null;

  if (!pid) {
    console.log("No running Palx service found.");
    process.exit(0);
  }

  const stopped = await stopPid(pid);
  if (!stopped) {
    console.error(`Failed to stop Palx service pid ${pid}.`);
    process.exit(1);
  }

  await updatePalxRuntimeState((currentState) => {
    if (!currentState || currentState.pid !== pid) {
      return currentState;
    }

    return {
      ...currentState,
      pid: null,
      appUrl: null,
      stoppedAt: new Date().toISOString(),
    };
  });

  console.log(`Stopped Palx service pid ${pid}.`);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to stop Palx service: ${message}`);
  process.exit(1);
});
