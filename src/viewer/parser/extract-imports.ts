// MVP import extractor — regex-based for TS/JS.
// Phase 2: swap implementation for tree-sitter WASM, keep this signature.

const IMPORT_PATTERNS = [
  // import X from 'foo'
  // import { x } from 'foo'
  // import * as X from 'foo'
  // import 'foo'
  /^\s*import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/gm,
  // export { x } from 'foo'  /  export * from 'foo'
  /^\s*export\s+.*?\s+from\s+['"]([^'"]+)['"]/gm,
  // const x = require('foo')
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  // dynamic import: import('foo')
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
];

export function extractImports(source: string): string[] {
  // Strip block + line comments to avoid false positives
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  const found = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(stripped)) !== null) {
      found.add(m[1]);
    }
  }
  return [...found];
}

export function countLines(source: string): number {
  let n = 0;
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) n++;
  }
  return n + 1;
}
