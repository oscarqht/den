import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import type { AgentProvider } from './types.ts';

const SUPPORTED_SKILL_PROVIDERS = new Set<AgentProvider>(['codex', 'gemini', 'cursor']);

export type SkillDirectoryOptions = {
  globalAgentsSkillsDirectory?: string;
  codexSkillsDirectory?: string;
};

export function getCodexSkillsDirectory(): string {
  const codexHome = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex');
  return path.join(codexHome, 'skills');
}

export function getGlobalAgentsSkillsDirectory(): string {
  return path.join(os.homedir(), '.agents', 'skills');
}

async function listSkillNamesFromDirectory(rootPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    const installedSkillNames: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      try {
        const manifestPath = path.join(rootPath, entry.name, 'SKILL.md');
        const stats = await fs.stat(manifestPath);
        if (stats.isFile()) {
          installedSkillNames.push(entry.name);
        }
      } catch {
        // Ignore entries without a readable manifest.
      }
    }

    return installedSkillNames;
  } catch {
    return [];
  }
}

export async function listInstalledSkillsForProvider(
  provider: AgentProvider,
  options: SkillDirectoryOptions = {},
): Promise<string[]> {
  if (!SUPPORTED_SKILL_PROVIDERS.has(provider)) {
    return [];
  }

  const globalAgentsSkillsDirectory = options.globalAgentsSkillsDirectory || getGlobalAgentsSkillsDirectory();
  const codexSkillsDirectory = options.codexSkillsDirectory || getCodexSkillsDirectory();

  const seen = new Set<string>();
  const orderedSkillNames: string[] = [];

  for (const rootPath of [globalAgentsSkillsDirectory, codexSkillsDirectory]) {
    const skillNames = await listSkillNamesFromDirectory(rootPath);
    for (const skillName of skillNames) {
      if (seen.has(skillName)) continue;
      seen.add(skillName);
      orderedSkillNames.push(skillName);
    }
  }

  return orderedSkillNames.sort((left, right) => left.localeCompare(right));
}

export async function isSkillInstalled(skillName: string, options: SkillDirectoryOptions = {}): Promise<boolean> {
  if (!skillName.trim()) {
    return false;
  }

  const globalAgentsSkillsDirectory = options.globalAgentsSkillsDirectory || getGlobalAgentsSkillsDirectory();
  const codexSkillsDirectory = options.codexSkillsDirectory || getCodexSkillsDirectory();

  try {
    await Promise.any([
      fs.access(path.join(globalAgentsSkillsDirectory, skillName, 'SKILL.md')),
      fs.access(path.join(codexSkillsDirectory, skillName, 'SKILL.md')),
    ]);
    return true;
  } catch {
    return false;
  }
}
