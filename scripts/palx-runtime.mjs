import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const PALX_RUNTIME_DIR = path.join(os.homedir(), ".viba", "palx");
export const PALX_RUNTIME_STATE_PATH = path.join(PALX_RUNTIME_DIR, "runtime-state.json");

export function getRestartLogPath(operationId) {
  return path.join(PALX_RUNTIME_DIR, `restart-${operationId}.log`);
}

export async function ensurePalxRuntimeDir() {
  await fs.mkdir(PALX_RUNTIME_DIR, { recursive: true });
}

export async function readPalxRuntimeState() {
  try {
    const raw = await fs.readFile(PALX_RUNTIME_STATE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function writePalxRuntimeState(state) {
  await ensurePalxRuntimeDir();
  await fs.writeFile(PALX_RUNTIME_STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

export async function updatePalxRuntimeState(updater) {
  const currentState = await readPalxRuntimeState();
  const nextState = await updater(currentState);
  if (!nextState) {
    try {
      await fs.rm(PALX_RUNTIME_STATE_PATH, { force: true });
    } catch {
      // Ignore cleanup failures.
    }
    return null;
  }

  await writePalxRuntimeState(nextState);
  return nextState;
}

export async function appendRestartLog(logPath, message) {
  await ensurePalxRuntimeDir();
  await fs.appendFile(logPath, message, "utf-8");
}

export async function markPalxProcessStarted({
  pid,
  mode,
  port,
  appUrl,
  appRoot,
  nodePath,
  npmCommand,
  restartOperationId,
}) {
  const timestamp = new Date().toISOString();
  return await updatePalxRuntimeState((currentState) => {
    const currentRestart = currentState?.restart ?? null;
    const restart = currentRestart && currentRestart.operationId === restartOperationId
      ? {
          ...currentRestart,
          status: "ready",
          agentActive: false,
          updatedAt: timestamp,
          lastError: null,
        }
      : currentRestart;

    return {
      managedBy: "palx-cli",
      appRoot,
      nodePath,
      npmCommand,
      pid,
      mode,
      port,
      appUrl,
      startedAt: timestamp,
      restart,
    };
  });
}

export async function clearPalxProcessIfPidMatches(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }

  return await updatePalxRuntimeState((currentState) => {
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
}
