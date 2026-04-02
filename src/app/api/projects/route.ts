import fs from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { findProjectByFolderPath, getDefaultRootFolder, getProjectById, getProjects, addProject, removeProject, updateProject } from '@/lib/store';
import { normalizeProjectFolderPath, normalizeProjectFolderPaths, validateProjectFolderAssociations } from '@/lib/project-folders';

export const dynamic = 'force-dynamic';

const createDefaultFolderSchema = z.object({
  enabled: z.boolean(),
  folderName: z.string().optional(),
});

const addProjectSchema = z.object({
  name: z.string().optional(),
  path: z.string().optional(),
  folderPaths: z.array(z.string()).optional(),
  displayName: z.string().nullable().optional(),
  createDefaultFolder: createDefaultFolderSchema.optional(),
});

const updateProjectSchema = z.object({
  projectId: z.string().min(1).optional(),
  path: z.string().optional(),
  updates: z.object({
    name: z.string().optional(),
    displayName: z.string().nullable().optional(),
    folderPaths: z.array(z.string()).optional(),
    iconPath: z.string().nullable().optional(),
    iconEmoji: z.string().nullable().optional(),
    lastOpenedAt: z.string().optional(),
  }),
});

const deleteProjectSchema = z.object({
  projectId: z.string().min(1).optional(),
  path: z.string().optional(),
  deleteLocalFolder: z.boolean().optional(),
});

function deriveProjectName(input: {
  explicitName?: string;
  folderPaths: string[];
  createdFolderPath?: string | null;
}): string {
  const explicitName = input.explicitName?.trim();
  if (explicitName) return explicitName;

  const defaultFolderSource = input.createdFolderPath ?? input.folderPaths[0];
  if (defaultFolderSource) {
    return path.basename(defaultFolderSource);
  }

  throw new Error('Project name is required.');
}

async function ensureDirectoryExists(folderPath: string): Promise<void> {
  const stats = await fs.stat(folderPath);
  if (!stats.isDirectory()) {
    throw new Error(`Folder is not a directory: ${folderPath}`);
  }
}

async function createProjectDefaultFolder(rawFolderName: string | undefined, projectName: string | undefined): Promise<string | null> {
  const defaultRootFolder = getDefaultRootFolder();
  if (!defaultRootFolder) {
    throw new Error('Default folder is not configured.');
  }

  try {
    await ensureDirectoryExists(defaultRootFolder);
  } catch {
    throw new Error('Default folder does not exist or is not a directory.');
  }

  const nextFolderName = (rawFolderName?.trim() || projectName?.trim() || '').trim();
  if (!nextFolderName) {
    throw new Error('New folder name is required.');
  }
  if (nextFolderName === '.' || nextFolderName === '..') {
    throw new Error('New folder name is invalid.');
  }
  if (nextFolderName.includes('/') || nextFolderName.includes('\\')) {
    throw new Error('New folder name cannot include path separators.');
  }

  const createdFolderPath = path.join(defaultRootFolder, nextFolderName);
  try {
    await fs.access(createdFolderPath);
    throw new Error(`Folder already exists: ${createdFolderPath}`);
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: string }).code
      : undefined;
    if (code && code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.mkdir(createdFolderPath, { recursive: false });
  return createdFolderPath;
}

async function normalizeProjectFolderInput(folderPaths: string[] | undefined): Promise<string[]> {
  const normalizedFolderPaths = normalizeProjectFolderPaths(folderPaths);
  await Promise.all(normalizedFolderPaths.map((folderPath) => ensureDirectoryExists(folderPath)));
  validateProjectFolderAssociations(normalizedFolderPaths);
  return normalizedFolderPaths;
}

export async function GET() {
  return NextResponse.json(getProjects());
}

export async function POST(request: Request) {
  let createdFolderPath: string | null = null;

  try {
    const body = await request.json();
    const { name, path: legacyPath, folderPaths, displayName, createDefaultFolder } = addProjectSchema.parse(body);
    const requestedFolderPaths = legacyPath ? [legacyPath, ...(folderPaths ?? [])] : folderPaths;
    const normalizedFolderPaths = await normalizeProjectFolderInput(requestedFolderPaths);
    if (legacyPath && normalizedFolderPaths.length === 1) {
      const existingProject = findProjectByFolderPath(normalizedFolderPaths[0]);
      if (existingProject) {
        return NextResponse.json(existingProject);
      }
    }
    if (createDefaultFolder?.enabled) {
      createdFolderPath = await createProjectDefaultFolder(createDefaultFolder.folderName, name);
    }

    const nextFolderPaths = createdFolderPath
      ? [normalizeProjectFolderPath(createdFolderPath), ...normalizedFolderPaths]
      : normalizedFolderPaths;
    validateProjectFolderAssociations(nextFolderPaths);

    const project = addProject({
      name: deriveProjectName({
        explicitName: displayName || name,
        folderPaths: nextFolderPaths,
        createdFolderPath,
      }),
      folderPaths: nextFolderPaths,
    });
    return NextResponse.json(project);
  } catch (error) {
    if (createdFolderPath) {
      await fs.rm(createdFolderPath, { recursive: true, force: true }).catch(() => {
        // Ignore rollback failures.
      });
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : 'Failed to create project.';
    const status = /required|invalid|not configured|does not exist|already exists|not a directory/i.test(message)
      ? 400
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { projectId, path: projectPath, updates } = updateProjectSchema.parse(body);
    const resolvedProjectId = projectId?.trim()
      || (projectPath ? findProjectByFolderPath(projectPath)?.id : null);
    if (!resolvedProjectId) {
      throw new Error('Project not found.');
    }

    const nextUpdates: typeof updates & { folderPaths?: string[] } = { ...updates };
    if (updates.folderPaths !== undefined) {
      nextUpdates.folderPaths = await normalizeProjectFolderInput(updates.folderPaths);
    }
    if (updates.displayName !== undefined && nextUpdates.name === undefined) {
      nextUpdates.name = updates.displayName ?? undefined;
    }

    const project = updateProject(resolvedProjectId, nextUpdates);
    return NextResponse.json(project);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : 'Failed to update project.';
    const status = /required|invalid|not found|does not exist|not a directory/i.test(message)
      ? 400
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const { projectId, path: projectPath } = deleteProjectSchema.parse(body);
    const resolvedProjectId = projectId?.trim()
      || (projectPath ? findProjectByFolderPath(projectPath)?.id : null);
    const project = resolvedProjectId ? getProjectById(resolvedProjectId) : null;
    if (!project) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    }

    removeProject(resolvedProjectId!);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : 'Failed to delete project.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
