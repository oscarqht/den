'use client';

import { useToast } from '@/hooks/use-toast';
import { useEffect, useState } from 'react';

export function Toaster() {
  const { toasts } = useToast();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div className="toast toast-bottom toast-end z-50 p-4 gap-2">
      {toasts.map((toast) => {
        let alertClass = 'alert-info';
        if (toast.type === 'success') alertClass = 'alert-success';
        else if (toast.type === 'warning' || toast.variant === 'warning') alertClass = 'alert-warning';
        else if (toast.type === 'error' || toast.variant === 'destructive') alertClass = 'alert-error';

        return (
          <div key={toast.id} className={`alert ${alertClass} shadow-lg max-w-md w-auto flex-col items-start gap-1 p-3 text-sm animate-in fade-in slide-in-from-bottom-2 duration-300`}>
             <div className="w-full">
                {toast.title && <h3 className="font-bold">{toast.title}</h3>}
                {toast.description && <div className="opacity-90 break-words">{toast.description}</div>}
             </div>
             {toast.action && <div className="mt-2 w-full">{toast.action}</div>}
          </div>
        )
      })}
    </div>
  );
}
