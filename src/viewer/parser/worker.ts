// Web Worker for parsing source files. Keeps the main thread free.
import { extractImports, countLines } from "./extract-imports";

export type ParseRequest = {
  id: number;
  filePath: string;
  source: string;
};

export type ParseResponse = {
  id: number;
  filePath: string;
  imports: string[];
  loc: number;
};

self.addEventListener("message", (e: MessageEvent<ParseRequest>) => {
  const { id, filePath, source } = e.data;
  const imports = extractImports(source);
  const loc = countLines(source);
  const response: ParseResponse = { id, filePath, imports, loc };
  self.postMessage(response);
});
