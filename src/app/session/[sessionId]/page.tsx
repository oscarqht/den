import type { Metadata, Viewport } from 'next';
import SessionCanvasPageClient from './canvas/SessionCanvasPageClient';
import { getLocalDb } from '@/lib/local-db';
import { DEFAULT_PROJECT_ICON_PATH, getProjectIconUrl } from '@/lib/project-icons';
import { getProjectById } from '@/lib/store';

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
    const db = getLocalDb();
    const row = db.prepare(`
      SELECT title, project_id, project_path
      FROM sessions
      WHERE session_name = ?
    `).get(sessionId) as {
      title: string | null;
      project_id: string | null;
      project_path: string | null;
    } | undefined;

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

async function resolveSessionFavicon(projectId?: string): Promise<string> {
  if (projectId) {
    const project = getProjectById(projectId);
    if (project?.iconPath) {
      return getProjectIconUrl(project.iconPath);
    }
  }

  return SESSION_FALLBACK_FAVICON_PATH;
}

export async function generateMetadata({ params }: SessionRouteProps): Promise<Metadata> {
  const { sessionId } = await params;
  const sessionContext = await readSessionRouteContext(sessionId);
  const sessionFavicon = await resolveSessionFavicon(sessionContext.projectId);

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
