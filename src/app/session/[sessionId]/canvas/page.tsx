import { redirect } from 'next/navigation';

type SessionCanvasRedirectRouteProps = {
  params: Promise<{ sessionId: string }>;
};

export default async function SessionCanvasPage({ params }: SessionCanvasRedirectRouteProps) {
  const { sessionId } = await params;
  redirect(`/session/${encodeURIComponent(sessionId)}`);
}
