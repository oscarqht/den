import { cn } from '@/lib/utils';
import React from 'react';

// Visibility toggle button component
export function VisibilityToggle({
  type,
  isActive,
  isInherited,
  onClick,
  showOnHover,
}: {
  type: 'visible' | 'hidden';
  isActive: boolean;
  isInherited: boolean;
  onClick: (e: React.MouseEvent) => void;
  showOnHover: boolean;
}) {
  const title = type === 'visible' 
    ? (isActive ? 'Remove visible filter' : 'Show only this branch')
    : (isActive ? 'Remove hide filter' : 'Hide this branch');

  return (
    <button
      className={cn(
        "p-0.5 rounded hover:bg-base-300 transition-colors shrink-0 cursor-pointer text-xs",
        isActive && "bg-primary/10",
        isInherited && "opacity-50",
        !isActive && !showOnHover && "opacity-0 group-hover:opacity-100"
      )}
      onClick={onClick}
      title={title}
    >
      {type === 'visible' ? <i className="iconoir-eye text-[14px]" aria-hidden="true" /> : <i className="iconoir-eye-closed text-[14px]" aria-hidden="true" />}
    </button>
  );
}
