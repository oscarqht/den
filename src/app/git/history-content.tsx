'use client';

import { useSearchParams } from 'next/navigation';
import { HistoryView } from '@/components/git/history-view';
import { Suspense } from 'react';

function WorkspaceHistoryContent() {
    const searchParams = useSearchParams();
    const repoPath = searchParams.get('path');

    if (!repoPath) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="rounded-[22px] border border-white/70 bg-white/88 px-6 py-5 text-sm text-slate-600 shadow-[0_18px_36px_-24px_rgba(15,23,42,0.38)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/88 dark:text-slate-300 dark:shadow-[0_20px_42px_-26px_rgba(2,6,23,0.82)]">
                    No repository path specified.
                </div>
            </div>
        );
    }

    return <HistoryView repoPath={repoPath} />;
}

export default function HistoryContentWrapper() {
    return (
        <Suspense fallback={<div className="flex h-full items-center justify-center"><span className="loading loading-spinner"></span></div>}>
            <WorkspaceHistoryContent />
        </Suspense>
    );
}
