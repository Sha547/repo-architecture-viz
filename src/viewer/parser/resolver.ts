// Resolves import strings to actual file paths within the repo tree.

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const INDEX_FILES = EXTENSIONS.map((ext) => `/index${ext}`);

export interface ResolverContext {
  files: Set<string>;
  tsconfigPaths?: Record<string, string[]>;
}

export function createResolver(ctx: ResolverContext) {
  return function resolve(fromFile: string, importPath: string): string | null {
    // Relative import
    if (importPath.startsWith(".")) {
      return resolveRelative(fromFile, importPath, ctx.files);
    }

    // tsconfig path alias
    if (ctx.tsconfigPaths) {
      const aliased = applyTsconfigAlias(importPath, ctx.tsconfigPaths);
      if (aliased) {
        for (const candidate of aliased) {
          const resolved = resolveAbsolute(candidate, ctx.files);
          if (resolved) return resolved;
        }
      }
    }

    // Bare import → external package
    return null;
  };
}

function resolveRelative(
  fromFile: string,
  importPath: string,
  files: Set<string>,
): string | null {
  const fromDir = fromFile.split("/").slice(0, -1).join("/");
  const segments = (fromDir ? `${fromDir}/${importPath}` : importPath).split(
    "/",
  );

  // Normalize ., ..
  const stack: string[] = [];
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") stack.pop();
    else stack.push(seg);
  }
  const base = stack.join("/");
  return resolveAbsolute(base, files);
}

function resolveAbsolute(base: string, files: Set<string>): string | null {
  // Direct match
  if (files.has(base)) return base;

  // Try with extensions
  for (const ext of EXTENSIONS) {
    if (files.has(base + ext)) return base + ext;
  }

  // Try as directory with index file
  for (const idx of INDEX_FILES) {
    if (files.has(base + idx)) return base + idx;
  }

  return null;
}

function applyTsconfigAlias(
  importPath: string,
  paths: Record<string, string[]>,
): string[] | null {
  for (const [pattern, targets] of Object.entries(paths)) {
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -1); // keep the slash, drop *
      if (importPath.startsWith(prefix)) {
        const rest = importPath.slice(prefix.length);
        return targets.map((t) => t.replace(/\*$/, "") + rest);
      }
    } else if (importPath === pattern) {
      return targets;
    }
  }
  return null;
}

export function externalPackageName(importPath: string): string {
  // 'react' → 'react'
  // '@scope/pkg/sub' → '@scope/pkg'
  // 'lodash/debounce' → 'lodash'
  if (importPath.startsWith("@")) {
    const parts = importPath.split("/");
    return parts.slice(0, 2).join("/");
  }
  return importPath.split("/")[0];
}
