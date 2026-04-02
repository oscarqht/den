import type { Metadata, Viewport } from 'next';
import SessionCanvasPageClient from './canvas/SessionCanvasPageClient';
import { readLocalState } from '@/lib/local-db';
import { DEFAULT_PROJECT_ICON_PATH, getProjectIconUrl } from '@/lib/project-icons';
import { findProjectByFolderPath, getProjectById } from '@/lib/store';

type SessionRouteProps = {
  params: Promise<{ sessionId: string }>;
};

type SessionRouteContext = {
  title?: string;
  projectId?: string;
  projectPath?: string;
};

const SESSION_FALLBACK_FAVICON_PATH = DEFAULT_PROJECT_ICON_PATH;

async function readSessionRouteContext(sessionId: string): Promise<SessionRouteContext> {
  try {
    const record = readLocalState().sessions[sessionId];
    const row = record ? {
      title: record.title ?? null,
      project_id: record.projectId ?? null,
      project_path: record.projectPath ?? null,
    } : undefined;

    const trimmedTitle = row?.title?.trim();
    const trimmedProjectId = row?.project_id?.trim();
    const trimmedProjectPath = row?.project_path?.trim();

    return {
      title: trimmedTitle || undefined,
      projectId: trimmedProjectId || undefined,
      projectPath: trimmedProjectPath || undefined,
    };
  } catch {
    return {};
  }
}

async function resolveSessionFavicon(projectId?: string, projectPath?: string): Promise<string> {
  const resolvedProject = (
    (projectPath ? findProjectByFolderPath(projectPath) : null)
    ?? (projectId ? getProjectById(projectId) : null)
  );
  if (resolvedProject?.iconPath || resolvedProject?.iconEmoji) {
    return getProjectIconUrl(resolvedProject);
  }

  return SESSION_FALLBACK_FAVICON_PATH;
}

export async function generateMetadata({ params }: SessionRouteProps): Promise<Metadata> {
  const { sessionId } = await params;
  const sessionContext = await readSessionRouteContext(sessionId);
  const sessionFavicon = await resolveSessionFavicon(sessionContext.projectId, sessionContext.projectPath);

  const metadata: Metadata = {
    icons: {
      icon: sessionFavicon,
    },
  };

  if (sessionContext.title) {
    metadata.title = sessionContext.title;
  }

  return metadata;
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function SessionPage() {
  return <SessionCanvasPageClient />;
}
