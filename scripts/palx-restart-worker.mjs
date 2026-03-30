#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  appendRestartLog,
  getRestartLogPath,
  readPalxRuntimeState,
  updatePalxRuntimeState,
} from "./palx-runtime.mjs";

const DEFAULT_START_TIMEOUT_MS = 180000;
const DEFAULT_RETRY_DELAY_MS = 3000;

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

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
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return !isProcessAlive(pid);
}

async function stopPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return true;
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

  if (await waitForExit(pid, 5000)) {
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

  return await waitForExit(pid, 2000);
}

function isPortListening(port, host = "127.0.0.1", connectTimeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const onSuccess = () => {
      socket.destroy();
      resolve(true);
    };
    const onFailure = () => {
      socket.destroy();
      resolve(false);
    };

    socket.setTimeout(connectTimeoutMs, onFailure);
    socket.once("connect", onSuccess);
    socket.once("error", onFailure);
    socket.once("timeout", onFailure);
  });
}

async function waitForPortListening(port, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortListening(port)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function shellForPlatform() {
  if (process.platform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-Command"],
    };
  }

  return {
    command: process.env.SHELL || "/bin/zsh",
    args: ["-lc"],
  };
}

function createCommandForMode(mode) {
  return mode === "dev" ? "npm run dev" : "npm run build && npm start";
}

function buildRepairPrompt({ mode, startupCommand, port, appRoot }) {
  return [
    `Run in ${appRoot} and repair whatever is preventing Palx from starting successfully.`,
    `Target mode: ${mode}.`,
    `The required startup command is: ${startupCommand}`,
    `The service must come back on port ${port}.`,
    "You may edit files, install dependencies already declared by the project, and run commands as needed.",
    "Keep working until the startup command succeeds for this repository.",
    "Before exiting successfully, verify the startup command can launch cleanly.",
    "Do not ask for approval. Do not open an interactive UI. Print the key fix and the final verification result.",
  ].join("\n");
}

async function updateRestartState(operationId, patch) {
  const timestamp = new Date().toISOString();
  return await updatePalxRuntimeState((currentState) => {
    const restartState = currentState?.restart;
    if (!restartState || restartState.operationId !== operationId) {
      return currentState;
    }

    return {
      ...currentState,
      restart: {
        ...restartState,
        ...patch,
        updatedAt: timestamp,
      },
    };
  });
}

async function logLine(logPath, message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await appendRestartLog(logPath, line);
}

function spawnShellCommand(command, { cwd, env, logPath }) {
  const shell = shellForPlatform();
  const logFd = fs.openSync(logPath, "a");
  const child = spawn(shell.command, [...shell.args, command], {
    cwd,
    env,
    stdio: ["ignore", logFd, logFd],
    detached: true,
  });
  fs.closeSync(logFd);
  child.unref();
  return child;
}

async function runCodexRepair({ cwd, env, logPath, mode, startupCommand, port, appRoot, operationId }) {
  await updateRestartState(operationId, {
    status: "repairing",
    agentActive: true,
  });
  await logLine(logPath, "Startup failed. Launching background Codex repair agent.");

  await new Promise((resolve) => {
    const logFd = fs.openSync(logPath, "a");
    const child = spawn(
      "codex",
      [
        "-c",
        'approval_policy=\"never\"',
        "--color",
        "never",
        "--sandbox",
        "danger-full-access",
        "--skip-git-repo-check",
        "exec",
        "-",
      ],
      {
        cwd,
        env,
        stdio: ["pipe", logFd, logFd],
      },
    );

    const prompt = buildRepairPrompt({ mode, startupCommand, port, appRoot });
    child.stdin.write(`${prompt}\n`);
    child.stdin.end();
    child.once("close", async (code) => {
      fs.closeSync(logFd);
      await logLine(logPath, `Codex repair agent exited with code ${code ?? 1}.`);
      resolve(code ?? 1);
    });
    child.once("error", async (error) => {
      fs.closeSync(logFd);
      await logLine(logPath, `Failed to launch Codex repair agent: ${error instanceof Error ? error.message : String(error)}`);
      resolve(1);
    });
  });

  await updateRestartState(operationId, {
    agentActive: false,
  });
}

async function attemptStartup({ operationId, appRoot, mode, port, logPath }) {
  const startupCommand = createCommandForMode(mode);
  await logLine(logPath, `Attempting startup command: ${startupCommand}`);

  const env = {
    ...process.env,
    PORT: String(port),
    PALX_RESTART_OPERATION_ID: operationId,
    PALX_APP_URL: `http://localhost:${port}`,
  };
  const child = spawnShellCommand(startupCommand, { cwd: appRoot, env, logPath });
  const childPid = child.pid ?? null;
  if (childPid) {
    await logLine(logPath, `Spawned startup command wrapper pid ${childPid}.`);
  }

  const ready = await waitForPortListening(port, DEFAULT_START_TIMEOUT_MS);
  if (ready) {
    await updateRestartState(operationId, {
      status: "ready",
      agentActive: false,
      lastError: null,
    });
    await logLine(logPath, `Palx is listening on http://localhost:${port}.`);
    return true;
  }

  const stillAlive = childPid ? isProcessAlive(childPid) : false;
  const reason = stillAlive
    ? `Startup command timed out after ${DEFAULT_START_TIMEOUT_MS}ms.`
    : "Startup command exited before the service became ready.";
  await updateRestartState(operationId, {
    status: "starting",
    lastError: reason,
  });
  await logLine(logPath, reason);
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const operationId = args.operation;
  if (!operationId) {
    throw new Error("Missing --operation.");
  }

  const state = await readPalxRuntimeState();
  const restartState = state?.restart;
  if (!state || !restartState || restartState.operationId !== operationId) {
    throw new Error(`Restart operation ${operationId} is not active.`);
  }

  const appRoot = state.appRoot;
  const port = Number.parseInt(String(restartState.targetPort ?? state.port ?? ""), 10);
  const mode = restartState.mode;
  if (!appRoot || !mode || !Number.isInteger(port) || port <= 0) {
    throw new Error("Restart state is missing appRoot, mode, or port.");
  }
  const logPath = restartState.logPath || getRestartLogPath(operationId);
  const currentPid = typeof state.pid === "number" ? state.pid : null;

  await fsp.mkdir(path.dirname(logPath), { recursive: true });
  await logLine(logPath, `Restart worker started for mode=${mode} port=${port}.`);
  await updateRestartState(operationId, {
    status: "stopping",
    logPath,
    agentActive: false,
  });

  if (currentPid) {
    await logLine(logPath, `Stopping current Palx process pid ${currentPid}.`);
    const stopped = await stopPid(currentPid);
    await logLine(logPath, stopped ? `Stopped pid ${currentPid}.` : `Failed to stop pid ${currentPid} cleanly.`);
  } else {
    await logLine(logPath, "No active Palx pid found; proceeding directly to startup.");
  }

  let attempts = Number.parseInt(String(restartState.attempts ?? 0), 10) || 0;
  let repairAttempts = Number.parseInt(String(restartState.repairAttempts ?? 0), 10) || 0;

  for (;;) {
    attempts += 1;
    await updateRestartState(operationId, {
      status: "starting",
      attempts,
      repairAttempts,
      lastError: null,
      agentActive: false,
    });

    const started = await attemptStartup({ operationId, appRoot, mode, port, logPath });
    if (started) {
      return;
    }

    repairAttempts += 1;
    await updateRestartState(operationId, {
      repairAttempts,
      lastError: "Startup failed; invoking background repair agent.",
    });
    await runCodexRepair({
      cwd: appRoot,
      env: process.env,
      logPath,
      mode,
      startupCommand: createCommandForMode(mode),
      port,
      appRoot,
      operationId,
    });
    await logLine(logPath, `Retrying startup after repair attempt ${repairAttempts}.`);
    await new Promise((resolve) => setTimeout(resolve, DEFAULT_RETRY_DELAY_MS));
  }
}

void main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  const args = parseArgs(process.argv.slice(2));
  const operationId = args.operation;
  if (operationId) {
    const state = await readPalxRuntimeState();
    const logPath = state?.restart?.logPath || getRestartLogPath(operationId);
    await logLine(logPath, `Restart worker failed: ${message}`);
    await updateRestartState(operationId, {
      status: "failed",
      lastError: message,
      agentActive: false,
      logPath,
    });
  }
  process.exit(1);
});
