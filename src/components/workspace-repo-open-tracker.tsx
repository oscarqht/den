'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useRepositories, useUpdateRepository } from '@/hooks/use-git';

export function WorkspaceRepoOpenTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const repoPath = searchParams.get('path');
  const { data: repositories } = useRepositories();
  const updateRepository = useUpdateRepository();
  const lastTrackedPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname.startsWith('/git')) {
      lastTrackedPathRef.current = null;
      return;
    }

    if (!repoPath || !repositories?.some((repo) => repo.path === repoPath)) {
      return;
    }

    if (lastTrackedPathRef.current === repoPath) {
      return;
    }

    lastTrackedPathRef.current = repoPath;
    updateRepository.mutate({
      path: repoPath,
      updates: {
        lastOpenedAt: new Date().toISOString(),
      },
    });
  }, [pathname, repoPath, repositories, updateRepository]);

  return null;
}
