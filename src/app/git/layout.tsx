import { AppPageSurface, APP_PAGE_PANEL_CLASS } from '@/components/app-shell/AppPageSurface';
import { Sidebar } from '@/components/layout/sidebar';
import { Suspense } from 'react';
import { WorkspaceRepoOpenTracker } from '@/components/workspace-repo-open-tracker';
import { getSettings } from '@/lib/store';

export default function WorkspaceLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const sidebarCollapsed = getSettings().sidebarCollapsed ?? false;
    const sidebarShellClass =
        `overflow-hidden ${APP_PAGE_PANEL_CLASS}`;

    return (
        <AppPageSurface contentClassName="flex h-dvh min-h-0 flex-col items-center justify-start overflow-hidden p-4 md:p-6">
            <div className="mx-auto flex min-h-0 flex-1 w-full max-w-[1380px] gap-3 overflow-hidden">
                <Suspense fallback={null}>
                    <WorkspaceRepoOpenTracker />
                </Suspense>
                <Suspense fallback={<div className={`${sidebarCollapsed ? 'w-16' : 'w-64'} ${sidebarShellClass} flex items-center justify-center`}><span className="loading loading-spinner"></span></div>}>
                    <div className={`shrink-0 ${sidebarShellClass}`}>
                        <Sidebar initialCollapsed={sidebarCollapsed} className="h-full min-h-0 border-r-0 bg-transparent" />
                    </div>
                </Suspense>
                <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                    {children}
                </main>
            </div>
        </AppPageSurface>
    );
}
