'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useProjects, useUpdateProject } from '@/hooks/use-git';

export function WorkspaceRepoOpenTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const repoPath = searchParams.get('path');
  const { data: projects } = useProjects();
  const updateProject = useUpdateProject();
  const lastTrackedPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname.startsWith('/git')) {
      lastTrackedPathRef.current = null;
      return;
    }

    const matchingProject = repoPath
      ? projects?.find((project) => project.folderPaths.some((folderPath) => (
        repoPath === folderPath
        || repoPath.startsWith(`${folderPath}/`)
        || repoPath.startsWith(`${folderPath}\\`)
      )))
      : null;
    if (!repoPath || !matchingProject) {
      return;
    }

    if (lastTrackedPathRef.current === repoPath) {
      return;
    }

    lastTrackedPathRef.current = repoPath;
    updateProject.mutate({
      projectId: matchingProject.id,
      updates: {
        lastOpenedAt: new Date().toISOString(),
      },
    });
  }, [pathname, repoPath, projects, updateProject]);

  return null;
}
