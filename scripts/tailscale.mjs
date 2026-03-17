#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "..");
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3200;
const DEFAULT_STATE_PATH = path.join(APP_ROOT, ".artifacts", "tailscale-state.json");

function getWindowsExecutableNames(command) {
  if (!command || process.platform !== "win32") {
    return [command];
  }

  const pathExtEntries = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const lowerCommand = command.toLowerCase();
  if (pathExtEntries.some((ext) => lowerCommand.endsWith(ext))) {
    return [command];
  }

  return [command, ...pathExtEntries.map((ext) => `${command}${ext}`)];
}

export function resolveCommand(command, env = process.env) {
  const pathEntries = (env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const candidateName of getWindowsExecutableNames(command)) {
    if (!candidateName) {
      continue;
    }

    if (candidateName.includes(path.sep) && fs.existsSync(candidateName)) {
      return candidateName;
    }

    for (const directory of pathEntries) {
      const candidate = path.join(directory, candidateName);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

export function isCommandAvailable(command, env = process.env) {
  return Boolean(resolveCommand(command, env));
}

export function createCommandRunner({
  cwd = APP_ROOT,
  env = process.env,
  spawnSyncImpl = spawnSync,
} = {}) {
  return function runCommand(command, args, options = {}) {
    const resolvedCommand = resolveCommand(command, env) || command;
    return spawnSyncImpl(resolvedCommand, args, {
      cwd,
      env,
      encoding: "utf8",
      stdio: options.stdio || "pipe",
    });
  };
}

export function checkLocalPort(host = DEFAULT_HOST, port = DEFAULT_PORT, timeoutMs = 1_000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });

    const finish = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

function loadState(statePath) {
  if (!fs.existsSync(statePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

function saveState(statePath, data) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(data, null, 2));
}

function clearState(statePath) {
  fs.rmSync(statePath, { force: true });
}

function parseStatus(stdout) {
  if (!stdout?.trim()) {
    return {};
  }

  return JSON.parse(stdout);
}

function tryParseStatus(stdout) {
  try {
    return parseStatus(stdout);
  } catch {
    return null;
  }
}

function isRunningStatus(status) {
  return status?.BackendState === "Running";
}

function stripTrailingDot(value) {
  return value?.endsWith(".") ? value.slice(0, -1) : value;
}

function getReachableUrls(status, port) {
  const urls = [];
  const dnsName = stripTrailingDot(status?.Self?.DNSName);
  const primaryIp = status?.Self?.TailscaleIPs?.[0];

  if (dnsName) {
    urls.push(`http://${dnsName}:${port}`);
  }

  if (primaryIp) {
    urls.push(`http://${primaryIp}:${port}`);
  }

  return urls;
}

function ensureCommandResult(result, message) {
  if (result.status === 0) {
    return result;
  }

  const stderr = result.stderr?.trim();
  const stdout = result.stdout?.trim();
  throw new Error([message, stderr || stdout].filter(Boolean).join("\n"));
}

function extractAuthUrl(commandResult, parsedOutput = null) {
  const authUrl = typeof parsedOutput?.AuthURL === "string" ? parsedOutput.AuthURL.trim() : "";
  if (authUrl) {
    return authUrl;
  }

  const combinedOutput = [commandResult.stdout, commandResult.stderr]
    .filter((value) => typeof value === "string" && value.trim())
    .join("\n");
  const match = combinedOutput.match(/https:\/\/[^\s"'`]+/);
  return match?.[0] || null;
}

function buildAuthUrlMessage(authUrl) {
  return [
    "Open this Tailscale login URL to authenticate this machine:",
    authUrl,
    "",
    "After logging in, run `npm run tailscale` again.",
  ].join("\n");
}

export async function runStart({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  statePath = DEFAULT_STATE_PATH,
  commandExists = isCommandAvailable,
  runCommand = createCommandRunner(),
  checkLocalPort: checkLocalPortImpl = checkLocalPort,
} = {}) {
  if (!commandExists("tailscale")) {
    throw new Error("tailscale CLI is not installed or not available in PATH.");
  }

  const isReachable = await checkLocalPortImpl(host, port);
  if (!isReachable) {
    throw new Error(`Palx at ${host}:${port} is not reachable. Start Palx on port ${port} before exposing it.`);
  }

  let ownsConnection = false;
  let statusResult = runCommand("tailscale", ["status", "--json"]);
  let status = statusResult.status === 0 ? parseStatus(statusResult.stdout) : null;

  if (!isRunningStatus(status)) {
    const upResult = runCommand("tailscale", ["up", "--json"]);
    const upStatus = tryParseStatus(upResult.stdout);
    const authUrl = extractAuthUrl(upResult, upStatus);
    if (authUrl) {
      throw new Error(buildAuthUrlMessage(authUrl));
    }

    ensureCommandResult(upResult, "tailscale up failed. Complete the login flow and try again.");
    ownsConnection = true;
    statusResult = ensureCommandResult(
      runCommand("tailscale", ["status", "--json"]),
      "Unable to read tailscale status after login.",
    );
    status = parseStatus(statusResult.stdout);
  }

  if (!isRunningStatus(status)) {
    throw new Error("Tailscale is still not connected after `tailscale up`.");
  }

  ensureCommandResult(
    runCommand("tailscale", ["serve", "--bg", `--http=${port}`, `http://${host}:${port}`], { stdio: "inherit" }),
    `Failed to expose http://${host}:${port} with tailscale serve.`,
  );

  const urls = getReachableUrls(status, port);
  saveState(statePath, { ownsConnection, port });

  return { ownsConnection, port, urls };
}

export async function runStop({
  statePath = DEFAULT_STATE_PATH,
  commandExists = isCommandAvailable,
  runCommand = createCommandRunner(),
} = {}) {
  if (!commandExists("tailscale")) {
    throw new Error("tailscale CLI is not installed or not available in PATH.");
  }

  const state = loadState(statePath);
  ensureCommandResult(
    runCommand("tailscale", ["serve", "reset"], { stdio: "inherit" }),
    "Failed to clear the Tailscale Serve configuration.",
  );

  let disconnected = false;
  if (state?.ownsConnection) {
    ensureCommandResult(
      runCommand("tailscale", ["down"], { stdio: "inherit" }),
      "Failed to disconnect Tailscale.",
    );
    disconnected = true;
  }

  clearState(statePath);
  return { disconnected };
}

export async function main(argv = process.argv.slice(2)) {
  const command = argv[0] === "stop" ? "stop" : "start";

  if (command === "stop") {
    const result = await runStop();
    console.log("Tailscale exposure stopped.");
    if (result.disconnected) {
      console.log("This machine was also disconnected from the tailnet because `npm run tailscale` brought it up.");
    }
    return;
  }

  const result = await runStart();
  console.log(`Palx at http://${DEFAULT_HOST}:${result.port} is now exposed to your tailnet.`);
  for (const url of result.urls) {
    console.log(`Open from another Tailscale device: ${url}`);
  }
  if (result.urls.length === 0) {
    console.log("Tailscale connected, but no MagicDNS or Tailscale IP was returned in `tailscale status --json`.");
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
