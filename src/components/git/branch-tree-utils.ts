// Visibility state for branches/folders
export type VisibilityState = 'visible' | 'hidden' | null;

// Map of path -> visibility state
export type VisibilityMap = Record<string, VisibilityState>;

// Tree node type for branch hierarchy
export interface BranchTreeNode {
  name: string;
  fullPath?: string; // Only set for leaf nodes (actual branches)
  children: Map<string, BranchTreeNode>;
}

// Build tree structure from flat branch list
export function buildBranchTree(branches: string[], pathPrefix: string = ''): BranchTreeNode {
  const root: BranchTreeNode = { name: '', children: new Map() };

  for (const branch of branches) {
    const parts = branch.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          children: new Map(),
        });
      }
      current = current.children.get(part)!;

      // If this is the last part, mark it as a leaf with full path
      if (i === parts.length - 1) {
        // Use the full path with prefix for remote branches
        current.fullPath = pathPrefix ? `${pathPrefix}/${branch}` : branch;
      }
    }
  }

  return root;
}

// Build tree structure for remote branches, grouped by remote name
export function buildRemoteBranchTree(remotes: Record<string, string[]>): Map<string, BranchTreeNode> {
  const result = new Map<string, BranchTreeNode>();
  
  for (const [remoteName, branches] of Object.entries(remotes)) {
    // Build tree for this remote's branches, with full ref path prefix
    result.set(remoteName, buildBranchTree(branches, `remotes/${remoteName}`));
  }
  
  return result;
}

// Get the effective visibility for a path (considering parent inheritance)
// groupPath is used for checking group-level visibility (e.g., "__local__" or "__remotes__" or "__remotes__/origin")
export function getEffectiveVisibility(
  path: string,
  visibilityMap: VisibilityMap,
  groupPath?: string
): VisibilityState {
  // Check if this path has explicit visibility
  if (visibilityMap[path]) {
    return visibilityMap[path];
  }

  // Check parent paths for inherited visibility
  const parts = path.split('/');
  for (let i = parts.length - 1; i > 0; i--) {
    const parentPath = parts.slice(0, i).join('/');
    if (visibilityMap[parentPath]) {
      return visibilityMap[parentPath];
    }
  }
  
  // Check group-level visibility
  if (groupPath) {
    // Check if any parent group has visibility set
    const groupParts = groupPath.split('/');
    for (let i = groupParts.length; i > 0; i--) {
      const parentGroupPath = groupParts.slice(0, i).join('/');
      if (visibilityMap[parentGroupPath]) {
        return visibilityMap[parentGroupPath];
      }
    }
  }

  return null;
}

export function sortBranchTreeChildren(node: BranchTreeNode): BranchTreeNode[] {
  return Array.from(node.children.values()).sort((a, b) => {
    const aIsFolder = a.children.size > 0 && !a.fullPath;
    const bIsFolder = b.children.size > 0 && !b.fullPath;
    if (aIsFolder && !bIsFolder) return -1;
    if (!aIsFolder && bIsFolder) return 1;
    return a.name.localeCompare(b.name);
  });
}

export function collectVisibleBranchRefs(
  node: BranchTreeNode,
  expandedFolders: Set<string>,
  parentPath = ''
): string[] {
  const refs: string[] = [];
  const sortedChildren = sortBranchTreeChildren(node);

  for (const child of sortedChildren) {
    const isLeaf = child.fullPath !== undefined;
    if (isLeaf) {
      refs.push(child.fullPath!);
      continue;
    }

    const itemPath = parentPath ? `${parentPath}/${child.name}` : child.name;
    if (expandedFolders.has(itemPath)) {
      refs.push(...collectVisibleBranchRefs(child, expandedFolders, itemPath));
    }
  }

  return refs;
}

export function collectAllBranchRefs(node: BranchTreeNode): string[] {
  const refs: string[] = [];
  const sortedChildren = sortBranchTreeChildren(node);

  for (const child of sortedChildren) {
    if (child.fullPath) {
      refs.push(child.fullPath);
      continue;
    }

    refs.push(...collectAllBranchRefs(child));
  }

  return refs;
}
