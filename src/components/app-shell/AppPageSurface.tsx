import Image from 'next/image';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const APP_PAGE_PANEL_CLASS =
  'rounded-[22px] border border-white/70 bg-white/88 shadow-[0_18px_36px_-24px_rgba(15,23,42,0.38)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/88 dark:shadow-[0_20px_42px_-26px_rgba(2,6,23,0.82)]';

export const APP_PAGE_TOOLBAR_CLASS =
  'rounded-[22px] border border-white/70 bg-white/82 shadow-[0_18px_36px_-24px_rgba(15,23,42,0.34)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/82 dark:shadow-[0_20px_42px_-26px_rgba(2,6,23,0.8)]';

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
        'relative min-h-screen overflow-hidden bg-[#f7f7f6] text-slate-900 dark:bg-[#020617] dark:text-slate-100',
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_center,rgba(148,163,184,0.26)_1px,transparent_1.2px)] [background-size:24px_24px] dark:[background-image:radial-gradient(circle_at_center,rgba(71,85,105,0.4)_1px,transparent_1.2px)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white/75 via-white/30 to-transparent dark:from-slate-950/60 dark:via-slate-950/15 dark:to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-white/60 via-white/10 to-transparent dark:from-slate-950/40 dark:via-slate-950/5 dark:to-transparent" />
      {githubHref ? (
        <a
          href={githubHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={githubLabel}
          className="fixed right-5 top-5 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-white/70 bg-white/82 shadow-[0_18px_36px_-24px_rgba(15,23,42,0.34)] backdrop-blur transition-colors hover:bg-white dark:border-slate-800 dark:bg-slate-950/82 dark:shadow-[0_20px_42px_-26px_rgba(2,6,23,0.8)] dark:hover:bg-slate-900"
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
