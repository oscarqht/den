import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getProjectById, findProjectByFolderPath } from './store.ts';
import { normalizeProjectFolderPath } from './project-folders.ts';
import type { Project } from './types.ts';

const VIBA_DIR = path.join(/* turbopackIgnore: true */ os.homedir(), '.viba');
const MEMORY_DIR = path.join(/* turbopackIgnore: true */ VIBA_DIR, 'memory');
const PROJECT_MEMORY_DIR = path.join(/* turbopackIgnore: true */ MEMORY_DIR, 'projects');
const GLOBAL_MEMORY_PATH = path.join(/* turbopackIgnore: true */ MEMORY_DIR, 'global.md');

export type MemoryScope = 'global' | 'project';

export type MemoryFileInfo = {
  scope: MemoryScope;
  path: string;
  label: string;
  projectId?: string;
  projectName?: string;
};

function normalizeProjectId(projectId: string): string {
  const normalized = projectId.trim();
  if (!normalized) {
    throw new Error('Project id is required.');
  }
  return normalized;
}

function projectMemoryPath(projectId: string): string {
  return path.join(/* turbopackIgnore: true */ PROJECT_MEMORY_DIR, `${normalizeProjectId(projectId)}.md`);
}

function buildStarterContent(input: {
  scope: MemoryScope;
  projectName?: string;
}): string {
  if (input.scope === 'global') {
    return '# Global Memory\n';
  }

  const projectTitle = input.projectName?.trim() || 'Project';
  return `# ${projectTitle} Memory\n`;
}

async function ensureFileExists(filePath: string, starterContent: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(/* turbopackIgnore: true */ filePath);
  } catch {
    await fs.writeFile(/* turbopackIgnore: true */ filePath, starterContent, 'utf-8');
  }
}

export async function ensureGlobalMemoryFile(): Promise<MemoryFileInfo> {
  await ensureFileExists(GLOBAL_MEMORY_PATH, buildStarterContent({ scope: 'global' }));
  return {
    scope: 'global',
    path: GLOBAL_MEMORY_PATH,
    label: 'Global memory',
  };
}

export function getGlobalMemoryFileInfo(): MemoryFileInfo {
  return {
    scope: 'global',
    path: GLOBAL_MEMORY_PATH,
    label: 'Global memory',
  };
}

export async function readGlobalMemory(): Promise<MemoryFileInfo & { content: string }> {
  const info = await ensureGlobalMemoryFile();
  const content = await fs.readFile(/* turbopackIgnore: true */ info.path, 'utf-8');
  return { ...info, content };
}

export async function writeGlobalMemory(content: string): Promise<MemoryFileInfo & { content: string }> {
  const info = await ensureGlobalMemoryFile();
  await fs.writeFile(/* turbopackIgnore: true */ info.path, content, 'utf-8');
  return { ...info, content };
}

export async function clearGlobalMemory(): Promise<MemoryFileInfo & { content: string }> {
  const info = await ensureGlobalMemoryFile();
  const content = buildStarterContent({ scope: 'global' });
  await fs.writeFile(/* turbopackIgnore: true */ info.path, content, 'utf-8');
  return { ...info, content };
}

export function resolveProjectMemoryProject(projectReference: string): Project {
  const trimmedReference = projectReference.trim();
  if (!trimmedReference) {
    throw new Error('Project reference is required.');
  }

  const projectById = getProjectById(trimmedReference);
  if (projectById) {
    return projectById;
  }

  const projectByPath = findProjectByFolderPath(normalizeProjectFolderPath(trimmedReference));
  if (projectByPath) {
    return projectByPath;
  }

  return {
    id: trimmedReference,
    name: 'Project',
    folderPaths: [],
  };
}

export function getProjectMemoryFileInfo(project: Project): MemoryFileInfo {
  return {
    scope: 'project',
    path: projectMemoryPath(project.id),
    label: `${project.name} memory`,
    projectId: project.id,
    projectName: project.name,
  };
}

export async function ensureProjectMemoryFile(projectReference: string): Promise<MemoryFileInfo> {
  const project = resolveProjectMemoryProject(projectReference);
  const info = getProjectMemoryFileInfo(project);
  await ensureFileExists(info.path, buildStarterContent({
    scope: 'project',
    projectName: project.name,
  }));
  return info;
}

export async function readProjectMemory(projectReference: string): Promise<MemoryFileInfo & { content: string }> {
  const info = await ensureProjectMemoryFile(projectReference);
  const content = await fs.readFile(/* turbopackIgnore: true */ info.path, 'utf-8');
  return { ...info, content };
}

export async function writeProjectMemory(
  projectReference: string,
  content: string,
): Promise<MemoryFileInfo & { content: string }> {
  const info = await ensureProjectMemoryFile(projectReference);
  await fs.writeFile(/* turbopackIgnore: true */ info.path, content, 'utf-8');
  return { ...info, content };
}

export async function clearProjectMemory(projectReference: string): Promise<MemoryFileInfo & { content: string }> {
  const project = resolveProjectMemoryProject(projectReference);
  const info = await ensureProjectMemoryFile(project.id);
  const content = buildStarterContent({
    scope: 'project',
    projectName: project.name,
  });
  await fs.writeFile(/* turbopackIgnore: true */ info.path, content, 'utf-8');
  return { ...info, content };
}

export async function getRelevantMemoryFiles(input: {
  projectId?: string | null;
  projectPath?: string | null;
}): Promise<MemoryFileInfo[]> {
  const files: MemoryFileInfo[] = [await ensureGlobalMemoryFile()];
  const projectReference = input.projectId?.trim() || input.projectPath?.trim() || '';
  if (!projectReference) {
    return files;
  }

  try {
    files.push(await ensureProjectMemoryFile(projectReference));
  } catch {
    // Ignore missing or deleted projects; global memory still applies.
  }

  return files;
}
