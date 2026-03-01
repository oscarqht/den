import { cn } from '@/lib/utils';

export function FileStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'A':
      return <i className="iconoir-plus-circle text-[16px] text-success" aria-hidden="true" />;
    case 'D':
      return <i className="iconoir-minus-circle text-[16px] text-error" aria-hidden="true" />;
    case 'M':
      return <i className="iconoir-edit-pencil text-[16px] text-warning" aria-hidden="true" />;
    default:
      return <i className="iconoir-page text-[16px] opacity-50" aria-hidden="true" />;
  }
}
