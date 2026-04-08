import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaultSpawnEnv, prepareSpawnCommand, resolveExecutable } from './agent/common';

export type RunCodexCliNonInteractiveOptions = {
  cwd: string;
  prompt: string;
  timeoutMs?: number;
  outputSchema?: Record<string, unknown>;
};

export type RunCodexCliNonInteractiveResult = {
  exitCode: number;
  output: string;
  lastMessage: string;
  timedOut: boolean;
};

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(/* turbopackIgnore: true */ filePath, 'utf8');
  } catch {
    return '';
  }
}

export async function runCodexCliNonInteractive({
  cwd,
  prompt,
  timeoutMs = 120_000,
  outputSchema,
}: RunCodexCliNonInteractiveOptions): Promise<RunCodexCliNonInteractiveResult> {
  const { spawn } = await import('child_process');
  const tempDir = await fs.mkdtemp(path.join(/* turbopackIgnore: true */ os.tmpdir(), 'viba-codex-exec-'));
  const outputFilePath = path.join(/* turbopackIgnore: true */ tempDir, 'last-message.txt');
  const outputChunks: string[] = [];
  const env = defaultSpawnEnv();
  const codexExecutable = resolveExecutable(['codex', 'codex.cmd'], env);

  let schemaPath: string | null = null;
  if (outputSchema) {
    schemaPath = path.join(/* turbopackIgnore: true */ tempDir, 'output-schema.json');
    await fs.writeFile(schemaPath, JSON.stringify(outputSchema), 'utf8');
  }

  const args = [
    'exec',
    '--color', 'never',
    '--sandbox', 'read-only',
    '--skip-git-repo-check',
    '-o', outputFilePath,
  ];

  if (schemaPath) {
    args.push('--output-schema', schemaPath);
  }

  args.push('-');

  let timedOut = false;

  try {
    const exitCode = await new Promise<number>((resolve) => {
      const prepared = prepareSpawnCommand(codexExecutable, args, env);
      const child = spawn(prepared.command, prepared.args, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsVerbatimArguments: prepared.windowsVerbatimArguments,
      });

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');

        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 1_000).unref();
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        outputChunks.push(chunk.toString());
      });

      child.stderr.on('data', (chunk: Buffer) => {
        outputChunks.push(chunk.toString());
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        outputChunks.push(error instanceof Error ? error.message : String(error));
        resolve(1);
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        resolve(code ?? 1);
      });

      child.stdin.write(prompt);
      child.stdin.end();
    });

    const output = outputChunks.join('').trim();
    const lastMessage = (await readTextIfExists(outputFilePath)).trim();

    return {
      exitCode,
      output,
      lastMessage,
      timedOut,
    };
  } finally {
    await fs.rm(/* turbopackIgnore: true */ tempDir, { recursive: true, force: true });
  }
}
