// Derived analytics from a built graph.

import type { FileNode, ImportEdge } from "./builder";

export function topImportedFiles(
  nodes: FileNode[],
  edges: ImportEdge[],
  limit = 10,
): { path: string; importers: number }[] {
  const inDegree = new Map<string, number>();
  for (const e of edges) {
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }
  return nodes
    .filter((n) => !n.external)
    .map((n) => ({ path: n.id, importers: inDegree.get(n.id) ?? 0 }))
    .sort((a, b) => b.importers - a.importers)
    .slice(0, limit)
    .filter((x) => x.importers > 0);
}

export function externalDependencies(nodes: FileNode[]): string[] {
  return nodes
    .filter((n) => n.external)
    .map((n) => n.id.replace(/^external:/, ""))
    .sort();
}

export function folderStats(
  nodes: FileNode[],
): { name: string; fileCount: number }[] {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    if (n.external) continue;
    counts.set(n.folder, (counts.get(n.folder) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, fileCount]) => ({ name, fileCount }))
    .sort((a, b) => b.fileCount - a.fileCount);
}

// Find cycles in the directed graph using DFS with white/gray/black coloring.
// Each cycle is returned as a list of node ids forming the loop.
export function findCycles(
  nodes: FileNode[],
  edges: ImportEdge[],
  limit = 20,
): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const n of nodes) adjacency.set(n.id, []);
  for (const e of edges) {
    if (!adjacency.has(e.source)) adjacency.set(e.source, []);
    adjacency.get(e.source)!.push(e.target);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const n of nodes) color.set(n.id, WHITE);

  const cycles: string[][] = [];
  const seen = new Set<string>();
  const stack: string[] = [];

  function dfs(id: string) {
    if (cycles.length >= limit) return;
    color.set(id, GRAY);
    stack.push(id);

    for (const target of adjacency.get(id) ?? []) {
      if (cycles.length >= limit) break;
      const c = color.get(target);
      if (c === GRAY) {
        const idx = stack.indexOf(target);
        if (idx !== -1) {
          const cycle = stack.slice(idx);
          const key = [...cycle].sort().join("|");
          if (!seen.has(key)) {
            seen.add(key);
            cycles.push(cycle);
          }
        }
      } else if (c === WHITE) {
        dfs(target);
      }
    }

    stack.pop();
    color.set(id, BLACK);
  }

  for (const n of nodes) {
    if (cycles.length >= limit) break;
    if (color.get(n.id) === WHITE) dfs(n.id);
  }
  return cycles;
}
