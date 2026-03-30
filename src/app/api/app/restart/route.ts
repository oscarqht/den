import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';

import {
  isPalxRestartInProgress,
  isProcessAlive,
  readPalxRuntimeState,
  updatePalxRuntimeState,
  type PalxLaunchMode,
} from '@/lib/app-runtime';

export const runtime = 'nodejs';

function getManagedPid(state: Awaited<ReturnType<typeof readPalxRuntimeState>>): number | null {
  return typeof state?.pid === 'number' && Number.isInteger(state.pid) && state.pid > 0
    ? state.pid
    : null;
}

export async function POST() {
  const state = await readPalxRuntimeState();
  if (!state?.appRoot || !state?.mode || !state?.port) {
    return NextResponse.json({
      error: 'Palx is not running under a managed npm source startup.',
    }, { status: 400 });
  }

  if (state.restart && isPalxRestartInProgress(state.restart.status)) {
    return NextResponse.json({
      success: true,
      restart: state.restart,
      alreadyInProgress: true,
    });
  }

  const pid = getManagedPid(state);
  if (!pid || !isProcessAlive(pid)) {
    return NextResponse.json({
      error: 'No running Palx service was found to restart.',
    }, { status: 400 });
  }

  const operationId = randomUUID();
  const runtimeDir = path.join(os.homedir(), '.viba', 'palx');
  const nextLogPath = path.join(runtimeDir, `restart-${operationId}.log`);
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(nextLogPath, '', 'utf-8');

  const timestamp = new Date().toISOString();
  const nextState = await updatePalxRuntimeState((currentState) => {
    const currentPid = typeof currentState?.pid === 'number' ? currentState.pid : null;
    if (!currentState?.appRoot || !currentState.mode || !currentState.port || !currentPid) {
      return currentState;
    }

    return {
      ...currentState,
      restart: {
        operationId,
        status: 'queued',
        mode: currentState.mode as PalxLaunchMode,
        targetPort: currentState.port,
        logPath: nextLogPath,
        requestedAt: timestamp,
        updatedAt: timestamp,
        attempts: 0,
        repairAttempts: 0,
        agentActive: false,
        lastError: null,
      },
    };
  });
  if (!nextState?.restart) {
    return NextResponse.json({
      error: 'Failed to initialize restart state.',
    }, { status: 500 });
  }

  const workerScriptPath = path.join(state.appRoot, 'scripts', 'palx-restart-worker.mjs');
  const worker = spawn(process.execPath, [workerScriptPath, '--operation', operationId], {
    cwd: state.appRoot,
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  worker.unref();

  return NextResponse.json({
    success: true,
    restart: nextState?.restart ?? null,
  });
}
