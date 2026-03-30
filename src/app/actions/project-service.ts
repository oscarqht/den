'use server';

import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { getConfig } from './config.ts';
import { buildTerminalProcessEnv } from '../../lib/terminal-process-env.ts';
import { getProjectPrimaryFolderPath } from '../../lib/project-folders.ts';
import {
  getTrackedSessionProcess,
  launchTrackedSessionProcess,
  readTrackedSessionProcessLog,
  stopTrackedSessionProcess,
  terminateProcessGracefully,
  type SessionTrackedProcess,
} from '../../lib/session-processes.ts';
import { findProjectByFolderPath, getProjectById } from '../../lib/store.ts';

const PROJECT_SERVICE_SESSION_NAME = '__project-service__';
const DEFAULT_LOG_BYTES = 64 * 1024;

export type ProjectServiceStatus = {
  configured: boolean;
  running: boolean;
  pid?: number;
  startedAt?: string;
  command?: string;
  error?: string;
};

type ResolvedManagedProject = {
  requestKey: string;
  projectId: string;
  workspacePath: string;
  serviceStartCommand: string;
  serviceStopCommand: string;
};

type RunLoggedCommandResult = {
  success: boolean;
  exitCode: number;
  error?: string;
};

function getServiceShellCommand(): { command: string; args: string[]; shellKind: 'posix' | 'powershell' } {
  if (process.platform === 'win32') {
    return {
      command: fsSync.existsSync('C:\\Program Files\\PowerShell\\7\\pwsh.exe') ? 'pwsh.exe' : 'powershell.exe',
      args: ['-NoLogo'],
      shellKind: 'powershell',
    };
  }

  return {
    command: 'bash',
    args: [],
    shellKind: 'posix',
  };
}

function buildProjectServiceStatus(processEntry: SessionTrackedProcess | null, configured: boolean): ProjectServiceStatus {
  return {
    configured,
    running: Boolean(processEntry),
    pid: processEntry?.pid,
    startedAt: processEntry?.startedAt,
    command: processEntry?.command,
  };
}

async function resolveManagedProject(projectReference: string): Promise<ResolvedManagedProject> {
  const trimmedReference = projectReference.trim();
  if (!trimmedReference) {
    throw new Error('Project reference is required.');
  }

  const project = getProjectById(trimmedReference) ?? findProjectByFolderPath(trimmedReference);
  if (!project) {
    throw new Error('Project not found.');
  }

  const workspacePath = getProjectPrimaryFolderPath(project);
  if (!workspacePath) {
    throw new Error('Project has no associated folder.');
  }

  const config = await getConfig();
  const settings = config.projectSettings[project.id] || config.projectSettings[workspacePath] || {};
  return {
    requestKey: trimmedReference,
    projectId: project.id,
    workspacePath,
    serviceStartCommand: settings.serviceStartCommand?.trim() || '',
    serviceStopCommand: settings.serviceStopCommand?.trim() || '',
  };
}

async function runLoggedShellCommand(
  workspacePath: string,
  logPath: string,
  command: string,
): Promise<RunLoggedCommandResult> {
  const shellCommand = getServiceShellCommand();
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.appendFile(logPath, `\n$ ${command}\n`, 'utf-8');

  const logFd = fsSync.openSync(logPath, 'a');
  const args = shellCommand.shellKind === 'powershell'
    ? [...shellCommand.args, '-Command', command]
    : [...shellCommand.args, '-lc', command];

  return await new Promise<RunLoggedCommandResult>((resolve) => {
    const child = spawn(shellCommand.command, args, {
      cwd: workspacePath,
      env: buildTerminalProcessEnv(process.env) as NodeJS.ProcessEnv,
      stdio: ['ignore', logFd, logFd],
    });

    child.on('error', (error) => {
      fsSync.closeSync(logFd);
      resolve({
        success: false,
        exitCode: 1,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    child.on('close', (code) => {
      fsSync.closeSync(logFd);
      resolve({
        success: (code ?? 1) === 0,
        exitCode: code ?? 1,
      });
    });
  });
}

export async function getProjectServiceStatuses(
  projectReferences: string[],
): Promise<Record<string, ProjectServiceStatus>> {
  const statuses: Record<string, ProjectServiceStatus> = {};

  await Promise.all(projectReferences.map(async (projectReference) => {
    const requestKey = projectReference.trim();
    if (!requestKey) return;

    try {
      const resolved = await resolveManagedProject(requestKey);
      const processEntry = await getTrackedSessionProcess(
        resolved.projectId,
        PROJECT_SERVICE_SESSION_NAME,
        'project-service',
      );
      statuses[requestKey] = buildProjectServiceStatus(
        processEntry,
        Boolean(resolved.serviceStartCommand),
      );
    } catch (error) {
      statuses[requestKey] = {
        configured: false,
        running: false,
        error: error instanceof Error ? error.message : 'Failed to resolve project service status.',
      };
    }
  }));

  return statuses;
}

export async function startProjectService(projectReference: string): Promise<{
  success: boolean;
  status?: ProjectServiceStatus;
  error?: string;
}> {
  try {
    const resolved = await resolveManagedProject(projectReference);
    if (!resolved.serviceStartCommand) {
      return { success: false, error: 'Start service command is not configured for this project.' };
    }

    const currentProcess = await getTrackedSessionProcess(
      resolved.projectId,
      PROJECT_SERVICE_SESSION_NAME,
      'project-service',
    );
    if (currentProcess) {
      return {
        success: true,
        status: buildProjectServiceStatus(currentProcess, true),
      };
    }

    const processRecord = await launchTrackedSessionProcess({
      role: 'project-service',
      source: 'project-service-ui',
      sessionName: PROJECT_SERVICE_SESSION_NAME,
      projectPath: resolved.projectId,
      workspacePath: resolved.workspacePath,
      command: resolved.serviceStartCommand,
      shellCommand: getServiceShellCommand(),
    });

    return {
      success: true,
      status: buildProjectServiceStatus(processRecord, true),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start project service.',
    };
  }
}

export async function stopProjectService(projectReference: string): Promise<{
  success: boolean;
  status?: ProjectServiceStatus;
  error?: string;
}> {
  try {
    const resolved = await resolveManagedProject(projectReference);
    const currentProcess = await getTrackedSessionProcess(
      resolved.projectId,
      PROJECT_SERVICE_SESSION_NAME,
      'project-service',
    );
    if (!currentProcess) {
      return {
        success: true,
        status: { configured: Boolean(resolved.serviceStartCommand), running: false },
      };
    }

    if (resolved.serviceStopCommand && currentProcess.logPath) {
      const stopResult = await runLoggedShellCommand(
        resolved.workspacePath,
        currentProcess.logPath,
        resolved.serviceStopCommand,
      );
      if (!stopResult.success) {
        return {
          success: false,
          error: stopResult.error || `Stop service command exited with code ${stopResult.exitCode}.`,
        };
      }
    }

    const refreshedProcess = await getTrackedSessionProcess(
      resolved.projectId,
      PROJECT_SERVICE_SESSION_NAME,
      'project-service',
    );
    if (refreshedProcess) {
      await terminateProcessGracefully({
        pid: refreshedProcess.pid,
        processGroupId: refreshedProcess.processGroupId,
      });
      await stopTrackedSessionProcess(
        resolved.projectId,
        PROJECT_SERVICE_SESSION_NAME,
        'project-service',
      );
    }

    return {
      success: true,
      status: { configured: Boolean(resolved.serviceStartCommand), running: false },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to stop project service.',
    };
  }
}

export async function restartProjectService(projectReference: string): Promise<{
  success: boolean;
  status?: ProjectServiceStatus;
  error?: string;
}> {
  const stopResult = await stopProjectService(projectReference);
  if (!stopResult.success) {
    return stopResult;
  }
  return await startProjectService(projectReference);
}

export async function getProjectServiceLog(projectReference: string): Promise<{
  success: boolean;
  status?: ProjectServiceStatus;
  output?: string;
  error?: string;
}> {
  try {
    const resolved = await resolveManagedProject(projectReference);
    const processEntry = await getTrackedSessionProcess(
      resolved.projectId,
      PROJECT_SERVICE_SESSION_NAME,
      'project-service',
    );
    const output = await readTrackedSessionProcessLog(
      resolved.projectId,
      PROJECT_SERVICE_SESSION_NAME,
      'project-service',
      DEFAULT_LOG_BYTES,
    );

    return {
      success: true,
      status: buildProjectServiceStatus(processEntry, Boolean(resolved.serviceStartCommand)),
      output,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read project service log.',
    };
  }
}
