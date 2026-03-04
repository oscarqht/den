import { cn } from '@/lib/utils';

export function SessionAssociationDot({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute -top-0.5 -right-0.5 inline-flex h-2.5 w-2.5',
        className,
      )}
      aria-hidden="true"
    >
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full border border-yellow-300 bg-yellow-400" />
    </span>
  );
}
