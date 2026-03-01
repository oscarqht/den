'use client';

import { useSearchParams } from 'next/navigation';
import { StatusView } from '@/components/git/status-view';
import { Suspense } from 'react';
import { useWorkspaceTitle } from '@/hooks/use-workspace-title';

function WorkspaceChangesContent() {
  const searchParams = useSearchParams();
  const repoPath = searchParams.get('path');

  useWorkspaceTitle(repoPath, 'Changes');

  if (!repoPath) {
    return <div className="p-8">No repository path specified.</div>;
  }

  return <StatusView repoPath={repoPath} />;
}

export default function WorkspaceChangesPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full"><span className="loading loading-spinner"></span></div>}>
      <WorkspaceChangesContent />
    </Suspense>
  );
}
