import fsSync from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { buildTerminalProcessEnv } from './terminal-process-env.ts';

export type SessionTrackedProcessRole = 'startup-script' | 'dev-server' | 'project-service';
export type SessionTrackedProcessSource = 'startup-script' | 'ui-dev-button' | 'project-service-ui';
export type SessionTrackedProcessShellKind = 'posix' | 'powershell';

export type SessionTrackedProcess = {
  id: string;
  role: SessionTrackedProcessRole;
  source: SessionTrackedProcessSource;
  sessionName: string;
  projectPath: string;
  workspacePath: string;
  command: string;
  pid: number;
  processGroupId?: number;
  logPath?: string;
  shellKind: SessionTrackedProcessShellKind;
  startedAt: string;
};

type ProcessRegistryPayload = {
  processes: SessionTrackedProcess[];
};

type LaunchTrackedSessionProcessOptions = {
  role: SessionTrackedProcessRole;
  source: SessionTrackedProcessSource;
  sessionName: string;
  projectPath: string;
  workspacePath: string;
  command: string;
  shellCommand: {
    command: string;
    args: string[];
    shellKind: SessionTrackedProcessShellKind;
  };
  env?: Record<string, string>;
};

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizePath(value: string): string {
  return path.resolve(value.trim());
}

function slugifyProjectPath(projectPath: string): string {
  const baseName = path.basename(projectPath).toLowerCase();
  const safeBaseName = baseName.replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (safeBaseName) return safeBaseName;
  return createHash('sha1').update(projectPath).digest('hex').slice(0, 12);
}

export function getSessionRootPath(projectPath: string, sessionName: string): string {
  const projectSlug = slugifyProjectPath(projectPath);
  return path.join(os.homedir(), '.viba', 'projects', projectSlug, sessionName);
}

function getTrackedProcessesPath(projectPath: string, sessionName: string): string {
  return path.join(getSessionRootPath(projectPath, sessionName), 'tracked-processes.json');
}

function getTrackedProcessLogPath(
  projectPath: string,
  sessionName: string,
  role: SessionTrackedProcessRole,
): string {
  return path.join(getSessionRootPath(projectPath, sessionName), `${role}.log`);
}

async function readTrackedProcessesRegistry(
  projectPath: string,
  sessionName: string,
): Promise<ProcessRegistryPayload> {
  const registryPath = getTrackedProcessesPath(projectPath, sessionName);
  try {
    const raw = await fs.readFile(registryPath, 'utf-8');
    const parsed = JSON.parse(raw) as { processes?: unknown };
    const processes = Array.isArray(parsed.processes)
      ? parsed.processes.map((entry) => parseTrackedProcess(entry)).filter(Boolean) as SessionTrackedProcess[]
      : [];
    return { processes };
  } catch {
    return { processes: [] };
  }
}

async function writeTrackedProcessesRegistry(
  projectPath: string,
  sessionName: string,
  payload: ProcessRegistryPayload,
): Promise<void> {
  const registryPath = getTrackedProcessesPath(projectPath, sessionName);
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, JSON.stringify(payload, null, 2), 'utf-8');
}

function parseTrackedProcess(value: unknown): SessionTrackedProcess | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const role = record.role === 'startup-script' || record.role === 'dev-server'
    || record.role === 'project-service'
    ? record.role
    : null;
  const source = record.source === 'startup-script' || record.source === 'ui-dev-button'
    || record.source === 'project-service-ui'
    ? record.source
    : null;
  const shellKind = record.shellKind === 'powershell' ? 'powershell' : 'posix';
  const pid = typeof record.pid === 'number' && Number.isInteger(record.pid) && record.pid > 0
    ? record.pid
    : null;
  if (
    !role
    || !source
    || !pid
    || typeof record.id !== 'string'
    || typeof record.sessionName !== 'string'
    || typeof record.projectPath !== 'string'
    || typeof record.workspacePath !== 'string'
    || typeof record.command !== 'string'
    || typeof record.startedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: record.id,
    role,
    source,
    sessionName: record.sessionName,
    projectPath: record.projectPath,
    workspacePath: record.workspacePath,
    command: record.command,
    pid,
    processGroupId: typeof record.processGroupId === 'number' && Number.isInteger(record.processGroupId) && record.processGroupId > 0
      ? record.processGroupId
      : undefined,
    logPath: normalizeOptionalText(typeof record.logPath === 'string' ? record.logPath : undefined),
    shellKind,
    startedAt: record.startedAt,
  };
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error
      && typeof error === 'object'
      && 'code' in error
      && (error as { code?: string }).code === 'ESRCH'
    ) {
      return false;
    }
    return true;
  }
}

export async function waitForProcessExit(pid: number, timeoutMs = 1500): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isProcessAlive(pid);
}

function sendSignal(pid: number, signal: NodeJS.Signals): void {
  process.kill(pid, signal);
}

function sendSignalToProcessGroup(processGroupId: number, signal: NodeJS.Signals): void {
  process.kill(-processGroupId, signal);
}

export async function terminateProcessGracefully(options: {
  pid: number;
  processGroupId?: number;
  termTimeoutMs?: number;
  killTimeoutMs?: number;
}): Promise<boolean> {
  const { pid, processGroupId, termTimeoutMs = 2000, killTimeoutMs = 1000 } = options;
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  if (!isProcessAlive(pid)) {
    return true;
  }

  const isPosixGroup = process.platform !== 'win32'
    && Number.isInteger(processGroupId)
    && (processGroupId ?? 0) > 1;
  try {
    if (process.platform === 'win32') {
      sendSignal(pid, 'SIGTERM');
    } else if (isPosixGroup) {
      sendSignalToProcessGroup(processGroupId!, 'SIGTERM');
    } else {
      sendSignal(pid, 'SIGTERM');
    }
  } catch (error) {
    if (
      error
      && typeof error === 'object'
      && 'code' in error
      && (error as { code?: string }).code === 'ESRCH'
    ) {
      return true;
    }
    if (!isPosixGroup) {
      throw error;
    }
    try {
      sendSignal(pid, 'SIGTERM');
    } catch (fallbackError) {
      if (
        fallbackError
        && typeof fallbackError === 'object'
        && 'code' in fallbackError
        && (fallbackError as { code?: string }).code === 'ESRCH'
      ) {
        return true;
      }
      throw fallbackError;
    }
  }

  if (await waitForProcessExit(pid, termTimeoutMs)) {
    return true;
  }

  try {
    if (process.platform === 'win32') {
      sendSignal(pid, 'SIGKILL');
    } else if (isPosixGroup) {
      sendSignalToProcessGroup(processGroupId!, 'SIGKILL');
    } else {
      sendSignal(pid, 'SIGKILL');
    }
  } catch (error) {
    if (
      error
      && typeof error === 'object'
      && 'code' in error
      && (error as { code?: string }).code === 'ESRCH'
    ) {
      return true;
    }
    if (!isPosixGroup) {
      throw error;
    }
    try {
      sendSignal(pid, 'SIGKILL');
    } catch (fallbackError) {
      if (
        fallbackError
        && typeof fallbackError === 'object'
        && 'code' in fallbackError
        && (fallbackError as { code?: string }).code === 'ESRCH'
      ) {
        return true;
      }
      throw fallbackError;
    }
  }

  return await waitForProcessExit(pid, killTimeoutMs);
}

async function pruneDeadTrackedProcesses(
  projectPath: string,
  sessionName: string,
): Promise<SessionTrackedProcess[]> {
  const registry = await readTrackedProcessesRegistry(projectPath, sessionName);
  const alive = registry.processes.filter((processEntry) => isProcessAlive(processEntry.pid));
  if (alive.length !== registry.processes.length) {
    await writeTrackedProcessesRegistry(projectPath, sessionName, { processes: alive });
  }
  return alive;
}

export async function listTrackedSessionProcesses(
  projectPath: string,
  sessionName: string,
): Promise<SessionTrackedProcess[]> {
  return await pruneDeadTrackedProcesses(projectPath, sessionName);
}

export async function getTrackedSessionProcess(
  projectPath: string,
  sessionName: string,
  role: SessionTrackedProcessRole,
): Promise<SessionTrackedProcess | null> {
  const processes = await pruneDeadTrackedProcesses(projectPath, sessionName);
  return processes.find((processEntry) => processEntry.role === role) ?? null;
}

export async function upsertTrackedSessionProcess(record: SessionTrackedProcess): Promise<void> {
  const processes = await pruneDeadTrackedProcesses(record.projectPath, record.sessionName);
  const nextProcesses = [
    ...processes.filter((processEntry) => processEntry.role !== record.role),
    record,
  ];
  await writeTrackedProcessesRegistry(record.projectPath, record.sessionName, { processes: nextProcesses });
}

export async function clearTrackedSessionProcess(
  projectPath: string,
  sessionName: string,
  role: SessionTrackedProcessRole,
): Promise<void> {
  const processes = await readTrackedProcessesRegistry(projectPath, sessionName);
  const nextProcesses = processes.processes.filter((processEntry) => processEntry.role !== role);
  if (nextProcesses.length === 0) {
    const registryPath = getTrackedProcessesPath(projectPath, sessionName);
    await fs.rm(registryPath, { force: true });
    return;
  }
  await writeTrackedProcessesRegistry(projectPath, sessionName, { processes: nextProcesses });
}

export async function stopTrackedSessionProcess(
  projectPath: string,
  sessionName: string,
  role: SessionTrackedProcessRole,
): Promise<{ stopped: boolean; process: SessionTrackedProcess | null }> {
  const processEntry = await getTrackedSessionProcess(projectPath, sessionName, role);
  if (!processEntry) {
    return { stopped: false, process: null };
  }
  const stopped = await terminateProcessGracefully({
    pid: processEntry.pid,
    processGroupId: processEntry.processGroupId,
  });
  if (stopped || !isProcessAlive(processEntry.pid)) {
    await clearTrackedSessionProcess(projectPath, sessionName, role);
  }
  return { stopped, process: processEntry };
}

export async function stopAllTrackedSessionProcesses(
  projectPath: string,
  sessionName: string,
  roles?: SessionTrackedProcessRole[],
): Promise<void> {
  const processes = await listTrackedSessionProcesses(projectPath, sessionName);
  for (const processEntry of processes) {
    if (roles && !roles.includes(processEntry.role)) continue;
    const stopped = await terminateProcessGracefully({
      pid: processEntry.pid,
      processGroupId: processEntry.processGroupId,
    });
    if (stopped || !isProcessAlive(processEntry.pid)) {
      await clearTrackedSessionProcess(projectPath, sessionName, processEntry.role);
    }
  }
}

export async function launchTrackedSessionProcess(
  options: LaunchTrackedSessionProcessOptions,
): Promise<SessionTrackedProcess> {
  const {
    role,
    source,
    sessionName,
    projectPath,
    workspacePath,
    command,
    shellCommand,
    env = {},
  } = options;
  const logPath = getTrackedProcessLogPath(projectPath, sessionName, role);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const logFd = fsSync.openSync(logPath, 'a');
  const shellArgs = shellCommand.shellKind === 'powershell'
    ? [...shellCommand.args, '-NoProfile', '-Command', command]
    : [...shellCommand.args, '-lc', command];
  const child = spawn(shellCommand.command, shellArgs, {
    cwd: normalizePath(workspacePath),
    env: buildTerminalProcessEnv({
      ...process.env,
      ...env,
    }),
    stdio: ['ignore', logFd, logFd],
    detached: process.platform !== 'win32',
  });
  fsSync.closeSync(logFd);
  if (!child.pid || !Number.isInteger(child.pid) || child.pid <= 0) {
    throw new Error(`Failed to start ${role}: child process pid unavailable.`);
  }
  child.unref();

  const record: SessionTrackedProcess = {
    id: `${role}-${randomUUID()}`,
    role,
    source,
    sessionName,
    projectPath,
    workspacePath,
    command,
    pid: child.pid,
    processGroupId: process.platform !== 'win32' ? child.pid : undefined,
    logPath,
    shellKind: shellCommand.shellKind,
    startedAt: new Date().toISOString(),
  };
  await upsertTrackedSessionProcess(record);
  return record;
}

async function readCommandOutput(command: string, args: string[]): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk.toString());
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk.toString());
    });
    child.on('error', (error) => {
      resolve({
        exitCode: 1,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
      });
    });
    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: stdoutChunks.join(''),
        stderr: stderrChunks.join(''),
      });
    });
  });
}

function normalizePreviewUrl(url: string): string {
  return url
    .replace('0.0.0.0', 'localhost')
    .replace('127.0.0.1', 'localhost');
}

export async function inferTrackedProcessPreviewUrl(
  processEntry: SessionTrackedProcess | null | undefined,
): Promise<string | null> {
  if (!processEntry?.logPath) {
    return null;
  }
  try {
    const raw = await fs.readFile(processEntry.logPath, 'utf-8');
    const localMatch = raw.match(/Local:\s+(https?:\/\/\S+)/i);
    if (localMatch?.[1]) {
      return normalizePreviewUrl(localMatch[1]);
    }
    const genericMatch = raw.match(/(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[A-Za-z0-9.-]+):\d+\S*)/i);
    if (genericMatch?.[1]) {
      return normalizePreviewUrl(genericMatch[1]);
    }
    return null;
  } catch {
    return null;
  }
}

export async function readTrackedDevServerState(
  projectPath: string,
  sessionName: string,
): Promise<{
  running: boolean;
  process: SessionTrackedProcess | null;
  previewUrl: string | null;
}> {
  const processEntry = await getTrackedSessionProcess(projectPath, sessionName, 'dev-server');
  const previewUrl = await inferTrackedProcessPreviewUrl(processEntry);
  return {
    running: Boolean(processEntry),
    process: processEntry,
    previewUrl,
  };
}

export async function readTrackedSessionProcessLog(
  projectPath: string,
  sessionName: string,
  role: SessionTrackedProcessRole,
  maxBytes = 64 * 1024,
): Promise<string> {
  const logPath = getTrackedProcessLogPath(projectPath, sessionName, role);
  try {
    const raw = await fs.readFile(logPath);
    if (raw.byteLength <= maxBytes) {
      return raw.toString('utf-8');
    }
    return raw.subarray(raw.byteLength - maxBytes).toString('utf-8');
  } catch {
    return '';
  }
}

export async function cleanupStaleNextDevLock(
  workspacePath: string,
): Promise<boolean> {
  const lockPath = path.join(workspacePath, '.next', 'dev', 'lock');
  try {
    await fs.access(lockPath);
  } catch {
    return false;
  }

  const result = await readCommandOutput('lsof', ['-t', '--', lockPath]);
  if (result.exitCode === 0 && result.stdout.trim()) {
    return false;
  }
  if (result.exitCode !== 0 && result.stderr && !/No such file or directory/i.test(result.stderr)) {
    return false;
  }

  await fs.rm(lockPath, { force: true });
  return true;
}
