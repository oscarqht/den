import type { Metadata } from 'next';
import SessionPageClient from './SessionPageClient';
import { getLocalDb } from '@/lib/local-db';

type SessionRouteProps = {
  params: Promise<{ sessionId: string }>;
};

async function readSessionTitle(sessionId: string): Promise<string | undefined> {
  try {
    const db = getLocalDb();
    const row = db.prepare(`
      SELECT title
      FROM sessions
      WHERE session_name = ?
    `).get(sessionId) as { title: string | null } | undefined;

    const trimmedTitle = row?.title?.trim();
    return trimmedTitle || undefined;
  } catch {
    return undefined;
  }
}

export async function generateMetadata({ params }: SessionRouteProps): Promise<Metadata> {
  const { sessionId } = await params;
  const sessionTitle = await readSessionTitle(sessionId);

  if (!sessionTitle) {
    return {};
  }

  return {
    title: sessionTitle,
  };
}

export default function SessionPage() {
  return <SessionPageClient />;
}
