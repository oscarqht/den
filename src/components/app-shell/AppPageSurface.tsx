import Image from 'next/image';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const APP_PAGE_PANEL_CLASS =
  'rounded-[22px] border border-white/70 bg-white/88 shadow-[0_18px_36px_-24px_rgba(15,23,42,0.38)] backdrop-blur app-dark-panel';

export const APP_PAGE_TOOLBAR_CLASS =
  'rounded-[22px] border border-white/70 bg-white/82 shadow-[0_18px_36px_-24px_rgba(15,23,42,0.34)] backdrop-blur app-dark-toolbar';

type AppPageSurfaceProps = {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  githubHref?: string | null;
  githubLabel?: string;
};

export function AppPageSurface({
  children,
  className,
  contentClassName,
  githubHref = null,
  githubLabel = 'Open GitHub repository',
}: AppPageSurfaceProps) {
  return (
    <div
      className={cn(
        'relative min-h-screen overflow-hidden bg-[#f7f7f6] text-slate-900 app-dark-root',
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_center,rgba(148,163,184,0.26)_1px,transparent_1.2px)] [background-size:24px_24px] dark:[background-image:radial-gradient(circle_at_center,rgba(58,53,51,0.42)_1px,transparent_1.2px)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white/75 via-white/30 to-transparent dark:from-[rgba(35,33,32,0.72)] dark:via-[rgba(35,33,32,0.22)] dark:to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-white/60 via-white/10 to-transparent dark:from-[rgba(27,26,25,0.6)] dark:via-[rgba(27,26,25,0.08)] dark:to-transparent" />
      {githubHref ? (
        <a
          href={githubHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={githubLabel}
          className="fixed right-5 top-5 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-white/70 bg-white/82 shadow-[0_18px_36px_-24px_rgba(15,23,42,0.34)] backdrop-blur transition-colors hover:bg-white app-dark-toolbar dark:hover:bg-[var(--app-dark-elevated)]"
        >
          <Image
            src="/github.png"
            alt="GitHub"
            width={18}
            height={18}
            className="h-[18px] w-[18px]"
          />
        </a>
      ) : null}
      <div
        className={cn(
          'relative z-10 min-h-screen px-4 py-4 md:px-6 md:py-6',
          contentClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
