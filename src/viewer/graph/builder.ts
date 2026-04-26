// Pure function: parsed files + resolver → graph nodes & edges.

export interface FileNode {
  id: string; // file path or 'external:<pkg>'
  folder: string; // top-level folder, for color
  loc: number;
  external: boolean;
}

export interface ImportEdge {
  source: string;
  target: string;
  count: number;
}

export interface ParsedFile {
  path: string;
  loc: number;
  imports: string[];
}

export type Resolver = (from: string, importPath: string) => string | null;
export type ExternalNamer = (importPath: string) => string;

export function buildGraph(
  files: ParsedFile[],
  resolve: Resolver,
  externalName: ExternalNamer,
): { nodes: FileNode[]; edges: ImportEdge[] } {
  const fileLoc = new Map<string, number>();
  for (const f of files) fileLoc.set(f.path, f.loc);

  const nodeIds = new Set<string>();
  const edgeMap = new Map<string, ImportEdge>();

  for (const file of files) {
    nodeIds.add(file.path);
    for (const imp of file.imports) {
      const resolved = resolve(file.path, imp);
      const target = resolved ?? `external:${externalName(imp)}`;

      // Skip self-imports (rare but possible via path aliases)
      if (target === file.path) continue;

      nodeIds.add(target);

      const key = `${file.path}->${target}`;
      const existing = edgeMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        edgeMap.set(key, { source: file.path, target, count: 1 });
      }
    }
  }

  const nodes: FileNode[] = [...nodeIds].map((id) => {
    const external = id.startsWith("external:");
    const folder = external ? "external" : id.split("/")[0] || "root";
    return {
      id,
      folder,
      loc: fileLoc.get(id) ?? 0,
      external,
    };
  });

  return { nodes, edges: [...edgeMap.values()] };
}
