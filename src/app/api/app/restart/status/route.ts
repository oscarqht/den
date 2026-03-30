import { NextResponse } from 'next/server';

import {
  isPalxRestartInProgress,
  isProcessAlive,
  readPalxRestartLogTail,
  readPalxRuntimeState,
} from '@/lib/app-runtime';

export const runtime = 'nodejs';

export async function GET() {
  const state = await readPalxRuntimeState();
  const pid = typeof state?.pid === 'number' && Number.isInteger(state.pid) && state.pid > 0
    ? state.pid
    : null;
  const running = pid ? isProcessAlive(pid) : false;
  const restart = state?.restart ?? null;
  const log = await readPalxRestartLogTail(restart?.logPath);

  return NextResponse.json({
    managed: state?.managedBy === 'palx-cli',
    runtime: {
      pid,
      running,
      mode: state?.mode ?? null,
      port: state?.port ?? null,
      appUrl: state?.appUrl ?? null,
      appRoot: state?.appRoot ?? null,
      startedAt: state?.startedAt ?? null,
      stoppedAt: state?.stoppedAt ?? null,
    },
    restart: restart ? {
      ...restart,
      inProgress: isPalxRestartInProgress(restart.status),
      log,
    } : null,
  });
}
