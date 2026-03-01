import { CommitFile } from '@/hooks/use-git';
import { cn } from '@/lib/utils';
import { FileStatusIcon } from './file-status-icon';

export interface CommitFileTreeNode {
  name: string;
  path: string;
  file?: CommitFile;
  children: Map<string, CommitFileTreeNode>;
}

export function buildCommitFileTree(files: CommitFile[]): CommitFileTreeNode {
  const root: CommitFileTreeNode = {
    name: '',
    path: '',
    children: new Map(),
  };

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    let current = root;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path: currentPath,
          children: new Map(),
        });
      }

      current = current.children.get(part)!;

      if (i === parts.length - 1) {
        current.file = file;
      }
    }
  }

  return root;
}

export function collectCommitFolderPaths(node: CommitFileTreeNode): string[] {
  const paths: string[] = [];
  const children = Array.from(node.children.values());

  children.forEach((child) => {
    if (child.children.size > 0) {
      paths.push(child.path);
      paths.push(...collectCommitFolderPaths(child));
    }
  });

  return paths;
}

export function getParentPaths(filePath: string): string[] {
  const parts = filePath.split('/').filter(Boolean);
  const parentPaths: string[] = [];

  for (let i = 1; i < parts.length; i++) {
    parentPaths.push(parts.slice(0, i).join('/'));
  }

  return parentPaths;
}

export function CommitFileTreeItem({
  node,
  selectedFile,
  expandedFolders,
  onToggleFolder,
  onSelectFile,
  depth = 0,
}: {
  node: CommitFileTreeNode;
  selectedFile: string | null;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelectFile: (path: string) => void;
  depth?: number;
}) {
  const children = Array.from(node.children.values()).sort((a, b) => {
    const aIsFolder = a.children.size > 0;
    const bIsFolder = b.children.size > 0;

    if (aIsFolder && !bIsFolder) return -1;
    if (!aIsFolder && bIsFolder) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <>
      {children.map((child) => {
        const isFolder = child.children.size > 0;

        if (isFolder) {
          const isExpanded = expandedFolders.has(child.path);

          return (
            <div key={child.path}>
              <div
                className="flex items-center gap-1 px-2 py-1.5 text-xs rounded cursor-pointer hover:bg-base-200 transition-colors opacity-80"
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                onClick={() => onToggleFolder(child.path)}
                title={child.path}
              >
                <span className="text-[10px] opacity-70">{isExpanded ? '▼' : '▶'}</span>
                <i className="iconoir-folder text-[14px] opacity-70" aria-hidden="true" />
                <span className="truncate flex-1">{child.name}</span>
              </div>
              {isExpanded && (
                <CommitFileTreeItem
                  node={child}
                  selectedFile={selectedFile}
                  expandedFolders={expandedFolders}
                  onToggleFolder={onToggleFolder}
                  onSelectFile={onSelectFile}
                  depth={depth + 1}
                />
              )}
            </div>
          );
        }

        if (!child.file) return null;
        const file = child.file;

        return (
          <div
            key={child.path}
            className={cn(
              "flex items-center gap-2 px-2 py-1.5 text-xs rounded cursor-pointer hover:bg-base-200 transition-colors",
              selectedFile === file.path && "bg-base-200 font-medium"
            )}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onClick={() => onSelectFile(file.path)}
            title={file.path}
          >
            <FileStatusIcon status={file.status} />
            <span className="truncate flex-1 font-mono">{child.name}</span>
          </div>
        );
      })}
    </>
  );
}
