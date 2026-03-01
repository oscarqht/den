'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useEscapeDismiss } from '@/hooks/use-escape-dismiss';
import { toast } from '@/hooks/use-toast';

interface FSItem {
  name: string;
  path: string;
  isRepo: boolean;
}

interface FSResponse {
  path: string;
  isRepo: boolean;
  folders: FSItem[];
  parent: string;
}

interface SelectionMeta {
  isRepo: boolean;
}

interface FileSystemBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string, meta: SelectionMeta) => void;
  initialPath?: string;
  title?: string;
  selectionMode?: 'repository' | 'folder';
}

export function FileSystemBrowser({
  open,
  onOpenChange,
  onSelect,
  initialPath,
  title = 'Select Repository',
  selectionMode = 'repository',
}: FileSystemBrowserProps) {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [data, setData] = useState<FSResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const loadPath = async (path?: string) => {
    setIsLoading(true);
    try {
      const url = path ? `/api/fs?path=${encodeURIComponent(path)}` : '/api/fs';
      const res = await fetch(url);
      const json = await res.json();
      if (res.ok) {
        setData(json);
        setCurrentPath(json.path);
      } else {
          console.error(json.error);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (open && !hasInitialized) {
      loadPath(initialPath);
      setHasInitialized(true);
    }
    if (!open) {
      // Reset when dialog closes so it starts fresh next time
      setHasInitialized(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPath]);

  const handleSelectCurrentPath = () => {
    onSelect(currentPath, { isRepo: selectionMode === 'folder' ? true : !!data?.isRepo });
    onOpenChange(false);
  };

  useEscapeDismiss(open, () => onOpenChange(false), () => {
    if (isLoading || isCreatingFolder) {
      return;
    }
    handleSelectCurrentPath();
  });

  const handleNavigate = (path: string) => {
      loadPath(path);
  }

  const handleCreateFolder = async () => {
    if (selectionMode !== 'folder' || !currentPath || isCreatingFolder) {
      return;
    }

    const folderNameInput = window.prompt('New folder name');
    const folderName = folderNameInput?.trim() || '';
    if (!folderName) {
      return;
    }

    setIsCreatingFolder(true);
    try {
      const res = await fetch('/api/fs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: currentPath,
          name: folderName,
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json.error || 'Failed to create folder');
      }

      await loadPath(currentPath);
      toast({
        type: 'success',
        title: 'Folder created',
        description: `Created "${folderName}" in ${currentPath}`,
      });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      toast({
        type: 'error',
        title: 'Failed to create folder',
        description: errorMessage,
      });
    } finally {
      setIsCreatingFolder(false);
    }
  };

  if (!open) return null;

  return (
    <dialog className="modal modal-open">
      <div className="modal-box w-11/12 max-w-2xl h-[80vh] flex flex-col p-0 overflow-hidden bg-base-100">
        <div className="p-4 border-b border-base-300 flex justify-between items-center bg-base-200/50">
          <div className="overflow-hidden">
              <h3 className="font-bold text-lg">{title}</h3>
              <div className="text-xs opacity-70 font-mono truncate pt-1" title={currentPath}>
                {currentPath || 'Loading...'}
              </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-sm btn-circle btn-ghost" onClick={() => onOpenChange(false)}>
              <i className="iconoir-xmark text-[16px]" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden relative bg-base-100">
            {isLoading && (
                <div className="absolute inset-0 bg-base-100/50 flex items-center justify-center z-10">
                    <span className="loading loading-spinner loading-lg text-primary"></span>
                </div>
            )}
            
            <div className="h-full overflow-y-auto">
                <div className="divide-y divide-base-200">
                    {data?.parent && (
                        <div 
                            className="flex items-center gap-3 px-4 py-3 hover:bg-base-200 cursor-pointer opacity-70 transition-colors"
                            onClick={() => handleNavigate(data.parent)}
                        >
                            <i className="iconoir-u-turn-arrow-left text-[20px]" aria-hidden="true" />
                            <span className="text-sm">..</span>
                        </div>
                    )}
                    
                    {data?.folders.map((item) => {
                        return (
                        <div 
                            key={item.path}
                            className={cn(
                                "flex items-center justify-between px-4 py-3 hover:bg-base-200 cursor-pointer group transition-colors",
                                item.name.startsWith('.') && "opacity-60"
                            )}
                            onClick={() => handleNavigate(item.path)}
                        >
                            <div className="flex items-center gap-3 truncate">
                                {item.isRepo ? <i className="iconoir-bookmark text-[20px]" aria-hidden="true" /> : <i className="iconoir-folder text-[20px]" aria-hidden="true" />}
                                <span className={cn("text-sm font-mono", item.isRepo && "font-medium")}>{item.name}</span>
                            </div>
                            
                            <button
                                className="btn btn-xs btn-outline"
                                onClick={(e) => { e.stopPropagation(); onSelect(item.path, { isRepo: selectionMode === 'folder' ? true : item.isRepo }); onOpenChange(false); }}
                            >
                                {selectionMode === 'folder' ? 'Use Folder' : 'Select'}
                            </button>
                        </div>
                    )})}
                    
                    {data?.folders.length === 0 && (
                        <div className="p-8 text-center opacity-70 text-sm">
                            No folders found
                        </div>
                    )}
                </div>
            </div>
        </div>

        <div className="p-4 border-t border-base-300 flex items-center justify-between bg-base-200/30">
           <div className="text-xs opacity-70">
               {selectionMode === 'folder' ? 'Click folder to navigate or select it.' : 'Click folder to navigate.'}
           </div>
           <div className="flex items-center gap-2">
             {selectionMode === 'folder' && (
               <button
                 className="btn btn-sm btn-outline"
                 onClick={handleCreateFolder}
                 disabled={isCreatingFolder || isLoading || !currentPath}
               >
                 {isCreatingFolder ? (
                   <span className="flex items-center gap-2">
                     <span className="loading loading-spinner loading-xs" />
                     Creating...
                   </span>
                 ) : (
                   'New Folder'
                 )}
               </button>
             )}
             <button className="btn btn-primary btn-sm" onClick={handleSelectCurrentPath}>
                 {selectionMode === 'folder' ? 'Use Current Folder' : 'Select Current Folder'}
             </button>
           </div>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={() => onOpenChange(false)}>close</button>
      </form>
    </dialog>
  );
}
