import assert from 'node:assert';
import { after, describe, it } from 'node:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { listInstalledSkillsForProvider } from './agent-skills.ts';

const tempDirectories: string[] = [];

async function createTempDir(): Promise<string> {
  const dirPath = await fs.mkdtemp(path.join(os.tmpdir(), 'palx-agent-skills-'));
  tempDirectories.push(dirPath);
  return dirPath;
}

async function writeSkill(rootPath: string, skillName: string): Promise<void> {
  const skillDir = path.join(rootPath, skillName);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), `# ${skillName}\n`);
}

after(async () => {
  await Promise.all(tempDirectories.map((dirPath) => fs.rm(dirPath, { recursive: true, force: true })));
});

describe('listInstalledSkillsForProvider', () => {
  it('returns only directories with SKILL.md, merges both roots, dedupes, and sorts alphabetically', async () => {
    const globalAgentsSkillsDirectory = await createTempDir();
    const codexSkillsDirectory = await createTempDir();

    await writeSkill(globalAgentsSkillsDirectory, 'agent-browser');
    await writeSkill(globalAgentsSkillsDirectory, 'use-coral-components');
    await fs.mkdir(path.join(globalAgentsSkillsDirectory, 'missing-manifest'), { recursive: true });

    await writeSkill(codexSkillsDirectory, 'playwright');
    await writeSkill(codexSkillsDirectory, 'agent-browser');

    const result = await listInstalledSkillsForProvider('codex', {
      globalAgentsSkillsDirectory,
      codexSkillsDirectory,
    });

    assert.deepStrictEqual(result, [
      'agent-browser',
      'playwright',
      'use-coral-components',
    ]);
  });

  it('returns an empty list for unsupported providers', async () => {
    const globalAgentsSkillsDirectory = await createTempDir();
    const codexSkillsDirectory = await createTempDir();
    await writeSkill(globalAgentsSkillsDirectory, 'agent-browser');
    await writeSkill(codexSkillsDirectory, 'playwright');

    const result = await listInstalledSkillsForProvider('claude', {
      globalAgentsSkillsDirectory,
      codexSkillsDirectory,
    });

    assert.deepStrictEqual(result, []);
  });
});
