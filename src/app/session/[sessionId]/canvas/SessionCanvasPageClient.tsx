'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

import { getSessionCanvasBootstrap, type SessionCanvasBootstrapResult } from '@/app/actions/session-canvas';
import { SessionCanvasWorkspace } from '@/components/session-canvas/SessionCanvasWorkspace';

type SessionCanvasBootstrapSuccess = Extract<SessionCanvasBootstrapResult, { success: true }>;

export default function SessionCanvasPageClient() {
  const params = useParams<{ sessionId: string }>();
  const sessionIdParam = params.sessionId;
  const sessionId = Array.isArray(sessionIdParam) ? sessionIdParam[0] : sessionIdParam;
  const [bootstrap, setBootstrap] = useState<SessionCanvasBootstrapSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    setBootstrap(null);
    setError(null);

    void (async () => {
      const result = await getSessionCanvasBootstrap(sessionId);
      if (cancelled) return;

      if (!result.success) {
        setError(result.error);
        return;
      }

      setBootstrap(result);
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f7f7f6] px-6 text-center text-sm text-red-600 dark:bg-[#020617] dark:text-red-300">
        {error}
      </div>
    );
  }

  if (!bootstrap) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f7f7f6] dark:bg-[#020617]">
        <span className="loading loading-spinner loading-md text-slate-500" />
      </div>
    );
  }

  return <SessionCanvasWorkspace sessionId={sessionId} bootstrap={bootstrap} />;
}
