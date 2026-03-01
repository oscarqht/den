
import { Commit } from './types';
import { getBranchGraphColor } from './branch-colors';

export interface GraphNode extends Commit {
  x: number; // Lane index (0, 1, 2...)
  y: number; // Row index
  color: string;
  paths: GraphPath[];
  isMerge: boolean; // Helper to draw different dot
}

export interface GraphPath {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  type: 'straight' | 'merge' | 'fork';
}

function getLaneFallbackColor(lane: number): string {
  const hue = (lane * 47) % 360;
  return `hsl(${hue} 78% 56%)`;
}

function parseBranchRefs(refs?: string): string[] {
  if (!refs) return [];

  const normalizeDecoratedRef = (ref: string): string => {
    if (ref.startsWith('refs/heads/')) {
      return ref.slice('refs/heads/'.length);
    }
    if (ref.startsWith('refs/remotes/')) {
      return ref.slice('refs/remotes/'.length);
    }
    if (ref.startsWith('remotes/')) {
      return ref.slice('remotes/'.length);
    }
    return ref;
  };

  return refs
    .replace(/^\s*\((.*)\)\s*$/, '$1')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((ref) => ref.replace(/^HEAD\s*->\s*/, '').trim())
    .map(normalizeDecoratedRef)
    .filter((ref) => !ref.startsWith('tag:'))
    .filter((ref) => ref !== 'HEAD')
    .filter((ref) => !/\/HEAD$/.test(ref));
}

function getRemoteShortName(ref: string): string | null {
  const withoutPrefix = ref.startsWith('remotes/') ? ref.slice('remotes/'.length) : ref;
  const slashIndex = withoutPrefix.indexOf('/');
  if (slashIndex === -1) return null;
  return withoutPrefix.slice(slashIndex + 1);
}

function normalizeRefForColor(ref: string, localBranches: Set<string>): string {
  if (localBranches.has(ref)) return ref;
  const shortName = getRemoteShortName(ref);
  if (shortName && localBranches.has(shortName)) {
    return shortName;
  }
  return ref;
}

function isLocalRef(ref: string, localBranches: Set<string>): boolean {
  return localBranches.has(ref);
}

function choosePreferredRef(refs: string[], localBranches: Set<string>): string | null {
  if (refs.length === 0) return null;
  const localRef = refs.find((ref) => isLocalRef(ref, localBranches));
  if (localRef) return localRef;
  return refs[0];
}

function shouldReplaceLaneRef(nextRef: string, currentRef: string | null, localBranches: Set<string>): boolean {
  if (!currentRef) return true;
  return isLocalRef(nextRef, localBranches) && !isLocalRef(currentRef, localBranches);
}

interface GenerateGraphOptions {
  localBranches?: string[];
}

export function generateGraphData(commits: Commit[], options: GenerateGraphOptions = {}): GraphNode[] {
  const nodes: GraphNode[] = [];
  const localBranches = new Set(options.localBranches ?? []);
  
  // Mapping of which commit hash is currently "expected" at the bottom of a lane.
  // lanes[i] = "hash123" means lane i is drawing a line downwards towards hash123.
  const lanes: (string | null)[] = []; 
  
  // Mapping of generic colors to lanes to keep consistency if possible
  const laneColors: (string | undefined)[] = [];
  const laneBranchRefs: (string | null)[] = [];
  
  function getNextFreeLane(): number {
    for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] === null) return i;
    }
    return lanes.length;
  }

  function getColor(lane: number): string {
      const laneRef = laneBranchRefs[lane];
      const preferredColor = laneRef ? getBranchGraphColor(laneRef) : (laneColors[lane] ?? getLaneFallbackColor(lane));
      laneColors[lane] = preferredColor;
      return preferredColor;
  }

  commits.forEach((commit, index) => {
      const matchingLanes: number[] = [];
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] === commit.hash) matchingLanes.push(i);
      }

      // 1. Identify which lane this commit belongs to.
      // It belongs to a lane if that lane is currently "looking for" this commit hash.
      let lane = matchingLanes.length > 0 ? matchingLanes[0] : -1;
      
      // If no lane is looking for me, I am a new tip (e.g. a branch head).
      if (lane === -1) {
          lane = getNextFreeLane();
      }
      
      // Ensure lanes array is large enough
      while (lanes.length <= lane) {
        lanes.push(null);
        laneBranchRefs.push(null);
        laneColors.push(undefined);
      }

      const preferredRef = choosePreferredRef(parseBranchRefs(commit.refs), localBranches);
      if (preferredRef) {
        const normalizedRef = normalizeRefForColor(preferredRef, localBranches);
        if (shouldReplaceLaneRef(normalizedRef, laneBranchRefs[lane], localBranches)) {
          laneBranchRefs[lane] = normalizedRef;
        }
      }
      
      // Update color for this lane if needed (though getNextFreeLane usually finds one)
      const color = getColor(lane);

      // 2. Prepare the Node
      const node: GraphNode = {
          ...commit,
          x: lane,
          y: index,
          color,
          paths: [],
          isMerge: commit.parents.length > 1
      };
      const duplicateMatchingLanes = matchingLanes.filter((i) => i !== lane);
      const duplicateLaneSet = new Set(duplicateMatchingLanes);

      // 3. Draw Vertical "Rails" for ALL other active lanes
      // These are connections from (lane, index) to (lane, index+1) 
      // for branches that just "pass through" this row.
      for (let i = 0; i < lanes.length; i++) {
          if (i !== lane && lanes[i] !== null && !duplicateLaneSet.has(i)) {
               node.paths.push({
                   x1: i, y1: index,
                   x2: i, y2: index + 1,
                   color: getColor(i),
                   type: 'straight'
               });
          }
      }

      // 4. Process Parents & Update Lanes for next row
      // We are consuming 'lane' (it was pointing to us). 
      // Now we need lanes to point to our parents.
      
      // Clear current lane (we reached the node)
      lanes[lane] = null;

      // If multiple lanes were targeting the same commit hash, keep them parallel
      // until this branch-out point and collapse them here.
      for (const duplicateLane of duplicateMatchingLanes) {
        // Replace the previous-row straight segment with a direct merge edge
        // into this commit, so we avoid a vertical+horizontal "hook" shape.
        if (index > 0) {
          const previousNode = nodes[nodes.length - 1];
          if (previousNode) {
            previousNode.paths = previousNode.paths.filter((path) => !(
              path.type === 'straight' &&
              path.x1 === duplicateLane &&
              path.y1 === index - 1 &&
              path.x2 === duplicateLane &&
              path.y2 === index
            ));
          }
        }

        node.paths.push({
          x1: duplicateLane,
          y1: index - 1,
          x2: lane,
          y2: index,
          color: getColor(duplicateLane),
          type: 'merge'
        });
        lanes[duplicateLane] = null;
        laneBranchRefs[duplicateLane] = null;
        laneColors[duplicateLane] = undefined;
      }
      
      const parents = commit.parents;
      
      if (parents.length > 0) {
          // Parent 0 takes the current lane (usually)
          const p0 = parents[0];

          // Always continue parent 0 in-place so sibling branches remain parallel
          // until the actual branch-out commit row.
          lanes[lane] = p0;
          node.paths.push({
              x1: lane, y1: index,
              x2: lane, y2: index + 1,
              color: color, 
              type: 'straight'
          });
          
          // Other Parents (Merge Heads)
          // Other Parents (Merge Heads)
          for (let i = 1; i < parents.length; i++) {
              const p = parents[i];
              const existingPLane = lanes.indexOf(p);
              
              if (existingPLane !== -1) {
                  // Merge to existing
                   node.paths.push({
                      x1: lane, y1: index,
                      x2: existingPLane, y2: index + 1,
                      color: getColor(existingPLane), 
                      type: 'fork'
                  });
              } else {
                  // New lane for this parent
                  const newLane = getNextFreeLane();
                  while (lanes.length <= newLane) {
                    lanes.push(null);
                    laneBranchRefs.push(null);
                    laneColors.push(undefined);
                  }
                  
                  lanes[newLane] = p;
                  
                  // Draw connection
                   node.paths.push({
                      x1: lane, y1: index,
                      x2: newLane, y2: index + 1,
                      color: getColor(newLane), 
                      type: 'fork'
                  });
              }
          }
      
      }

      if (lanes[lane] === null) {
        laneBranchRefs[lane] = null;
        laneColors[lane] = undefined;
      }
      
      nodes.push(node);
  });
  
  return nodes;
}
