import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { addProject, findProjectByFolderPath, getProjectById, updateProject } from '@/lib/store';
import { normalizeProjectFolderPath } from '@/lib/project-folders';
import { buildManagedProjectIconPath } from '@/lib/project-icon-path';

const MAX_ICON_BYTES = 2 * 1024 * 1024;
const ICON_DIR = path.join(os.homedir(), '.viba', 'project-icons');
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico']);

type ParsedIconUpload = {
  projectId?: string;
  projectPath?: string;
  kind: 'file' | 'emoji';
  extension?: string;
  fileBuffer?: Buffer;
  iconEmoji?: string;
};

function sanitizeExtension(fileName: string): string | null {
  const extension = path.extname(fileName).toLowerCase();
  return extension && ALLOWED_EXTENSIONS.has(extension) ? extension : null;
}

function isManagedIconPath(iconPath: string | null | undefined): boolean {
  if (!iconPath) return false;
  const normalized = path.resolve(iconPath);
  const normalizedIconDir = path.resolve(ICON_DIR);
  return normalized === normalizedIconDir || normalized.startsWith(`${normalizedIconDir}${path.sep}`);
}

async function removeExistingManagedIcon(iconPath: string | null | undefined): Promise<void> {
  if (!iconPath || !isManagedIconPath(iconPath)) return;
  await fs.rm(iconPath, { force: true }).catch(() => {
    // Ignore cleanup failures.
  });
}

async function ensureProjectDirectory(folderPath: string): Promise<void> {
  const stats = await fs.stat(folderPath);
  if (!stats.isDirectory()) {
    throw new Error('Project path must be a directory.');
  }
}

async function resolveProjectReference(projectId?: string, projectPath?: string) {
  const normalizedProjectId = projectId?.trim();
  if (normalizedProjectId) {
    const existingById = getProjectById(normalizedProjectId);
    if (!existingById) {
      throw new Error('Project not found.');
    }
    return existingById;
  }

  const normalizedProjectPath = projectPath?.trim();
  if (!normalizedProjectPath) {
    throw new Error('projectId or projectPath is required.');
  }

  const absoluteProjectPath = normalizeProjectFolderPath(normalizedProjectPath);
  const existingByPath = findProjectByFolderPath(absoluteProjectPath);
  if (existingByPath) {
    return existingByPath;
  }

  await ensureProjectDirectory(absoluteProjectPath);
  return addProject({
    name: path.basename(absoluteProjectPath),
    folderPaths: [absoluteProjectPath],
  });
}

async function parseIconUpload(request: Request): Promise<ParsedIconUpload> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const projectIdValue = formData.get('projectId');
    const projectPathValue = formData.get('projectPath');
    const iconFileValue = formData.get('iconFile');

    if (!(iconFileValue instanceof File)) {
      throw new Error('iconFile is required.');
    }

    const extension = sanitizeExtension(iconFileValue.name);
    if (!extension) {
      throw new Error('Unsupported icon type. Use png, jpg, jpeg, webp, svg, or ico.');
    }
    if (iconFileValue.size > MAX_ICON_BYTES) {
      throw new Error('Icon file must be 2MB or smaller.');
    }

    return {
      projectId: typeof projectIdValue === 'string' ? projectIdValue.trim() : undefined,
      projectPath: typeof projectPathValue === 'string' ? projectPathValue.trim() : undefined,
      kind: 'file',
      extension,
      fileBuffer: Buffer.from(await iconFileValue.arrayBuffer()),
    };
  }

  const body = await request.json().catch(() => null);
  const projectIdValue = typeof body?.projectId === 'string' ? body.projectId.trim() : '';
  const projectPathValue = typeof body?.projectPath === 'string' ? body.projectPath.trim() : '';
  const iconPathValue = typeof body?.iconPath === 'string' ? body.iconPath.trim() : '';
  const iconEmojiValue = typeof body?.iconEmoji === 'string' ? body.iconEmoji.trim() : '';

  if (!projectIdValue && !projectPathValue) {
    throw new Error('projectId or projectPath is required.');
  }
  if (iconEmojiValue) {
    return {
      projectId: projectIdValue || undefined,
      projectPath: projectPathValue || undefined,
      kind: 'emoji',
      iconEmoji: iconEmojiValue,
    };
  }
  if (!iconPathValue) {
    throw new Error('iconPath or iconEmoji is required.');
  }

  const resolvedIconPath = path.resolve(iconPathValue);
  const extension = sanitizeExtension(path.basename(resolvedIconPath));
  if (!extension) {
    throw new Error('Unsupported icon type. Use png, jpg, jpeg, webp, svg, or ico.');
  }

  const iconStats = await fs.stat(resolvedIconPath).catch(() => null);
  if (!iconStats) {
    throw new Error('Icon file not found.');
  }
  if (!iconStats.isFile()) {
    throw new Error('Icon path must be a file.');
  }
  if (iconStats.size > MAX_ICON_BYTES) {
    throw new Error('Icon file must be 2MB or smaller.');
  }

  return {
    projectId: projectIdValue || undefined,
    projectPath: projectPathValue || undefined,
    kind: 'file',
    extension,
    fileBuffer: await fs.readFile(resolvedIconPath),
  };
}

export async function POST(request: Request) {
  try {
    const parsedUpload = await parseIconUpload(request);
    const project = await resolveProjectReference(parsedUpload.projectId, parsedUpload.projectPath);

    await removeExistingManagedIcon(project.iconPath);
    if (parsedUpload.kind === 'emoji') {
      const updatedProject = updateProject(project.id, {
        iconPath: null,
        iconEmoji: parsedUpload.iconEmoji ?? null,
      });
      return NextResponse.json({
        success: true,
        iconPath: updatedProject.iconPath ?? null,
        iconEmoji: updatedProject.iconEmoji ?? null,
      });
    }

    await fs.mkdir(ICON_DIR, { recursive: true });
    const destinationPath = buildManagedProjectIconPath(
      ICON_DIR,
      project.id,
      parsedUpload.extension!,
      parsedUpload.fileBuffer!,
    );
    await fs.writeFile(destinationPath, parsedUpload.fileBuffer!);

    const updatedProject = updateProject(project.id, {
      iconPath: destinationPath,
      iconEmoji: null,
    });
    return NextResponse.json({
      success: true,
      iconPath: updatedProject.iconPath ?? null,
      iconEmoji: updatedProject.iconEmoji ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to upload project icon.';
    const status = message === 'Project not found.'
      ? 404
      : /required|Unsupported|smaller|not found|must be a file|must be a directory/i.test(message)
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const projectId = typeof body?.projectId === 'string' ? body.projectId.trim() : undefined;
    const projectPath = typeof body?.projectPath === 'string' ? body.projectPath.trim() : undefined;
    const project = await resolveProjectReference(projectId, projectPath);

    await removeExistingManagedIcon(project.iconPath);
    updateProject(project.id, { iconPath: null, iconEmoji: null });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to remove project icon.';
    const status = message === 'Project not found.'
      ? 404
      : /required|must be a directory/i.test(message)
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
