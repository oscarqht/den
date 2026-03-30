import fs from 'fs/promises';
import os from 'os';
import path from 'path';

export type PalxLaunchMode = 'dev' | 'start';
export type PalxRestartStatus =
  | 'queued'
  | 'stopping'
  | 'starting'
  | 'repairing'
  | 'ready'
  | 'failed';

export type PalxRestartState = {
  operationId: string;
  status: PalxRestartStatus;
  mode: PalxLaunchMode;
  targetPort: number;
  logPath: string;
  requestedAt: string;
  updatedAt: string;
  attempts: number;
  repairAttempts: number;
  agentActive: boolean;
  lastError?: string | null;
};

export type PalxRuntimeState = {
  managedBy?: string;
  appRoot?: string;
  nodePath?: string;
  npmCommand?: string;
  pid?: number | null;
  mode?: PalxLaunchMode | null;
  port?: number | null;
  appUrl?: string | null;
  startedAt?: string;
  stoppedAt?: string;
  restart?: PalxRestartState | null;
};

const PALX_RUNTIME_DIR = path.join(os.homedir(), '.viba', 'palx');
const PALX_RUNTIME_STATE_PATH = path.join(PALX_RUNTIME_DIR, 'runtime-state.json');

export function getPalxRuntimeStatePath(): string {
  return PALX_RUNTIME_STATE_PATH;
}

export function isPalxRestartInProgress(status?: PalxRestartStatus | null): boolean {
  return status === 'queued'
    || status === 'stopping'
    || status === 'starting'
    || status === 'repairing';
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

export async function readPalxRuntimeState(): Promise<PalxRuntimeState | null> {
  try {
    const raw = await fs.readFile(PALX_RUNTIME_STATE_PATH, 'utf-8');
    return JSON.parse(raw) as PalxRuntimeState;
  } catch {
    return null;
  }
}

export async function updatePalxRuntimeState(
  updater: (state: PalxRuntimeState | null) => PalxRuntimeState | null | Promise<PalxRuntimeState | null>,
): Promise<PalxRuntimeState | null> {
  const currentState = await readPalxRuntimeState();
  const nextState = await updater(currentState);
  if (!nextState) {
    await fs.rm(PALX_RUNTIME_STATE_PATH, { force: true }).catch(() => undefined);
    return null;
  }

  await fs.mkdir(PALX_RUNTIME_DIR, { recursive: true });
  await fs.writeFile(PALX_RUNTIME_STATE_PATH, JSON.stringify(nextState, null, 2), 'utf-8');
  return nextState;
}

export async function readPalxRestartLogTail(
  logPath: string | null | undefined,
  maxBytes = 48 * 1024,
): Promise<string> {
  const normalizedPath = logPath?.trim();
  if (!normalizedPath) return '';

  try {
    const handle = await fs.open(normalizedPath, 'r');
    try {
      const stats = await handle.stat();
      const length = Math.min(stats.size, maxBytes);
      if (length <= 0) return '';
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, stats.size - length);
      return buffer.toString('utf-8');
    } finally {
      await handle.close();
    }
  } catch {
    return '';
  }
}
