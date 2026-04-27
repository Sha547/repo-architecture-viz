import { createResolver, externalPackageName } from "./parser/resolver";
import { extractImports, countLines } from "./parser/extract-imports";
import { buildGraph, type ParsedFile, type FileNode, type ImportEdge } from "./graph/builder";
import { renderForceGraph } from "./graph/force-layout";
import {
  topImportedFiles,
  externalDependencies,
  folderStats,
  findCycles,
} from "./graph/analytics";
import { exportSvgAsPng, buildMermaid } from "./exporters";
import * as d3 from "d3";

const params = new URLSearchParams(window.location.search);
const owner = params.get("owner") ?? "";
const repo = params.get("repo") ?? "";

const titleEl = el("repoTitle");
const statusEl = el("statusText");
const fileCountEl = el("fileCount");
const edgeCountEl = el("edgeCount");
const folderListEl = el("folderList");
const hotFilesListEl = el("hotFilesList");
const searchInput = el("searchInput") as HTMLInputElement;
const patBtn = el("patBtn") as HTMLButtonElement;
const aiKeyBtn = el("aiKeyBtn") as HTMLButtonElement;
const explainBtn = el("explainBtn") as HTMLButtonElement;
const exportPngBtn = el("exportPngBtn") as HTMLButtonElement;
const exportMermaidBtn = el("exportMermaidBtn") as HTMLButtonElement;
const modalBackdrop = el("modalBackdrop");
const modalBody = el("modalBody");
const modalClose = el("modalClose") as HTMLButtonElement;
const graphContainer = el("graph");

const SOURCE_REGEX = /\.(tsx?|jsx?|mjs|cjs)$/;
const MAX_FILES = 1000;
const WARN_FILES = 500;

titleEl.textContent = `${owner}/${repo}`;

let renderHandle: ReturnType<typeof renderForceGraph> | null = null;
let activeFolders: Set<string> | null = null;
let lastGraph: { nodes: FileNode[]; edges: ImportEdge[] } | null = null;

main().catch((err) => {
  status(`Error: ${err.message}`);
  console.error(err);
});

async function main() {
  if (!owner || !repo) {
    status("Missing owner/repo in URL");
    return;
  }

  patBtn.addEventListener("click", openPatDialog);
  aiKeyBtn.addEventListener("click", openAiKeyDialog);
  explainBtn.addEventListener("click", openExplainModal);
  exportPngBtn.addEventListener("click", onExportPng);
  exportMermaidBtn.addEventListener("click", onExportMermaid);
  modalClose.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) closeModal();
  });
  searchInput.addEventListener("input", onSearch);

  status("Fetching repo tree…");
  const treeRes = await sendMessage({ type: "FETCH_TREE", owner, repo });
  if (!treeRes.ok) throw new Error(treeRes.error);

  const sha: string = treeRes.data.sha;
  const tree = treeRes.data.tree as { path: string; type: string }[];
  const sourceEntries = tree.filter(
    (e) => e.type === "blob" && SOURCE_REGEX.test(e.path),
  );

  fileCountEl.textContent = String(sourceEntries.length);

  if (sourceEntries.length === 0) {
    status("No TypeScript/JavaScript files found in this repo");
    return;
  }
  if (sourceEntries.length > MAX_FILES) {
    status(`Too many files (${sourceEntries.length}). MVP cap is ${MAX_FILES}.`);
    return;
  }
  if (sourceEntries.length > WARN_FILES) {
    status(`${sourceEntries.length} files — may be slow without a PAT…`);
  }

  // Try to find tsconfig paths
  const tsconfigPaths = await findTsconfigPaths(tree, sha);

  status(`Fetching ${sourceEntries.length} files…`);
  const parsed = await fetchAndParseFiles(sha, sourceEntries.map((e) => e.path));

  status("Building graph…");
  const filesSet = new Set(parsed.map((p) => p.path));
  const resolver = createResolver({ files: filesSet, tsconfigPaths });
  const graph = buildGraph(parsed, resolver, externalPackageName);

  edgeCountEl.textContent = String(graph.edges.length);
  lastGraph = graph;

  // Detect cycles for visual highlighting
  const cycles = findCycles(graph.nodes, graph.edges, 50);
  const cycleEdgeSet = new Set<string>();
  for (const cycle of cycles) {
    for (let i = 0; i < cycle.length; i++) {
      const from = cycle[i];
      const to = cycle[(i + 1) % cycle.length];
      cycleEdgeSet.add(`${from}->${to}`);
    }
  }
  if (cycles.length > 0) {
    const cyclesRow = document.createElement("div");
    cyclesRow.className = "status-row";
    cyclesRow.innerHTML = `<span style="color:#ef4444">⚠ Cycles</span><span style="color:#ef4444">${cycles.length}</span>`;
    el("status").appendChild(cyclesRow);
  }

  // Folder legend
  renderFolderList(graph.nodes.map((n) => n.folder));

  // Hot files (top imported)
  renderHotFiles(graph);

  status(`Rendering ${graph.nodes.length} nodes, ${graph.edges.length} edges…`);
  renderHandle = renderForceGraph(graphContainer, graph.nodes, graph.edges, {
    cycleEdges: cycleEdgeSet,
    onNodeClick: (node) => {
      if (node.external) return;
      const url = `https://github.com/${owner}/${repo}/blob/${sha}/${node.id}`;
      window.open(url, "_blank");
    },
  });

  status(`Ready · ${graph.nodes.length} nodes`);
}

async function fetchAndParseFiles(
  sha: string,
  paths: string[],
): Promise<ParsedFile[]> {
  const CONCURRENCY = 8;
  const out: ParsedFile[] = [];
  let done = 0;
  let i = 0;

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < paths.length) {
        const idx = i++;
        const path = paths[idx];
        try {
          const res = await sendMessage({
            type: "FETCH_FILE",
            owner,
            repo,
            sha,
            path,
          });
          if (res.ok && typeof res.data === "string") {
            const source = res.data;
            out.push({
              path,
              loc: countLines(source),
              imports: extractImports(source),
            });
          }
        } catch {
          // skip individual file failures
        }
        done++;
        if (done % 10 === 0 || done === paths.length) {
          status(`Parsed ${done}/${paths.length} files…`);
        }
      }
    }),
  );

  return out;
}

async function findTsconfigPaths(
  tree: { path: string; type: string }[],
  sha: string,
): Promise<Record<string, string[]> | undefined> {
  const tsconfig = tree.find(
    (e) => e.type === "blob" && /(^|\/)tsconfig\.json$/.test(e.path),
  );
  if (!tsconfig) return undefined;
  try {
    const res = await sendMessage({
      type: "FETCH_FILE",
      owner,
      repo,
      sha,
      path: tsconfig.path,
    });
    if (!res.ok) return undefined;
    // tsconfig files often have comments → strip them naively
    const stripped = res.data
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/,(\s*[}\]])/g, "$1"); // trailing commas
    const parsed = JSON.parse(stripped);
    const paths = parsed?.compilerOptions?.paths;
    const baseUrl: string = parsed?.compilerOptions?.baseUrl ?? ".";
    if (!paths) return undefined;

    const tsconfigDir = tsconfig.path.split("/").slice(0, -1).join("/");
    const baseDir = joinPath(tsconfigDir, baseUrl);

    const out: Record<string, string[]> = {};
    for (const [key, targets] of Object.entries(paths)) {
      out[key] = (targets as string[]).map((t) => joinPath(baseDir, t));
    }
    return out;
  } catch {
    return undefined;
  }
}

function joinPath(...segments: string[]): string {
  const stack: string[] = [];
  for (const s of segments) {
    for (const seg of s.split("/")) {
      if (!seg || seg === ".") continue;
      if (seg === "..") stack.pop();
      else stack.push(seg);
    }
  }
  return stack.join("/");
}

function renderFolderList(folders: string[]) {
  const counts = new Map<string, number>();
  for (const f of folders) counts.set(f, (counts.get(f) ?? 0) + 1);

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const colorScale = d3
    .scaleOrdinal(d3.schemeTableau10)
    .domain([...new Set(folders)]);

  folderListEl.innerHTML = "";
  for (const [folder, count] of sorted) {
    const li = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = colorScale(folder);
    const label = document.createElement("span");
    label.textContent = `${folder} (${count})`;
    li.appendChild(swatch);
    li.appendChild(label);
    li.addEventListener("click", () => {
      activeFolders = activeFolders?.has(folder)
        ? null
        : new Set([folder]);
      renderHandle?.filterByFolder(activeFolders);
      // Visual feedback
      folderListEl.querySelectorAll("li").forEach((node) => {
        node.style.fontWeight = "normal";
      });
      if (activeFolders) li.style.fontWeight = "600";
    });
    folderListEl.appendChild(li);
  }
}

function renderHotFiles(graph: { nodes: FileNode[]; edges: ImportEdge[] }) {
  const hot = topImportedFiles(graph.nodes, graph.edges, 10);
  hotFilesListEl.innerHTML = "";
  if (hot.length === 0) {
    hotFilesListEl.innerHTML = `<li style="color:#86868b;font-style:italic">none yet</li>`;
    return;
  }
  for (const { path, importers } of hot) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "file";
    name.textContent = path.split("/").pop() ?? path;
    name.title = path;
    const cnt = document.createElement("span");
    cnt.className = "count";
    cnt.textContent = `${importers}`;
    li.appendChild(name);
    li.appendChild(cnt);
    li.addEventListener("click", () => {
      renderHandle?.highlightNode(path);
    });
    hotFilesListEl.appendChild(li);
  }
}

async function onExportPng() {
  const svg = graphContainer.querySelector("svg");
  if (!svg) return;
  try {
    await exportSvgAsPng(svg, `${owner}-${repo}-graph.png`, 2);
  } catch (err) {
    alert(`Export failed: ${(err as Error).message}`);
  }
}

async function onExportMermaid() {
  if (!lastGraph) return;
  const text = buildMermaid(lastGraph.nodes, lastGraph.edges);
  try {
    await navigator.clipboard.writeText(text);
    flashButton(exportMermaidBtn, "Copied!");
  } catch {
    // Fallback: open in modal so user can copy manually
    modalBackdrop.removeAttribute("hidden");
    modalBody.innerHTML = `<p class="muted">Copy this Mermaid diagram into your README:</p><pre style="background:#0d0d0f;padding:12px;border-radius:8px;overflow:auto;font-size:11px">${escapeHtml(text)}</pre>`;
  }
}

function flashButton(btn: HTMLButtonElement, message: string) {
  const original = btn.textContent;
  btn.textContent = message;
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, 1500);
}

function onSearch() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) {
    renderHandle?.highlightNode(null);
    return;
  }
  // Find first matching node and highlight
  const allCircles = graphContainer.querySelectorAll<SVGCircleElement>("circle");
  for (const c of Array.from(allCircles)) {
    const datum = (c as unknown as { __data__?: { id: string } }).__data__;
    if (datum?.id.toLowerCase().includes(q)) {
      renderHandle?.highlightNode(datum.id);
      return;
    }
  }
  renderHandle?.highlightNode(null);
}

async function openPatDialog() {
  const current = await sendMessage({ type: "GET_PAT" });
  const existing: string = current.ok ? current.pat : "";
  const next = prompt(
    "Paste your GitHub Personal Access Token (read-only is fine).\nIt's stored locally in this browser only.",
    existing,
  );
  if (next == null) return;
  await sendMessage({ type: "SET_PAT", pat: next.trim() });
  alert("PAT saved. Refresh the page to use it.");
}

async function openAiKeyDialog() {
  const current = await sendMessage({ type: "GET_ANTHROPIC_KEY" });
  const existing: string = current.ok ? current.key : "";
  const next = prompt(
    "Paste your Anthropic API key (sk-ant-...).\nNeeded for the Explain feature. Stored locally only.",
    existing,
  );
  if (next == null) return;
  await sendMessage({ type: "SET_ANTHROPIC_KEY", key: next.trim() });
  alert("AI key saved.");
}

async function openExplainModal() {
  if (!lastGraph) {
    alert("Wait for the graph to finish rendering first.");
    return;
  }
  modalBackdrop.removeAttribute("hidden");
  modalBody.innerHTML = `<p class="muted">Asking Claude to read the architecture…</p>`;

  const cycles = findCycles(lastGraph.nodes, lastGraph.edges, 5);
  const payload = {
    repo: `${owner}/${repo}`,
    fileCount: lastGraph.nodes.filter((n) => !n.external).length,
    edgeCount: lastGraph.edges.length,
    folders: folderStats(lastGraph.nodes).slice(0, 10),
    topImported: topImportedFiles(lastGraph.nodes, lastGraph.edges, 10),
    externalDeps: externalDependencies(lastGraph.nodes).slice(0, 30),
    cycles,
  };

  const res = await sendMessage({ type: "EXPLAIN_ARCHITECTURE", payload });
  if (!res.ok) {
    modalBody.innerHTML = `<p class="muted">Error: ${escapeHtml(res.error)}</p>`;
    return;
  }
  modalBody.innerHTML = renderMarkdown(res.text);
}

function closeModal() {
  modalBackdrop.setAttribute("hidden", "");
}

function renderMarkdown(text: string): string {
  // Tiny markdown: **bold**, `code`, paragraph breaks
  const escaped = escapeHtml(text);
  const inlined = escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  const paragraphs = inlined.split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`);
  return paragraphs.join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function status(msg: string) {
  statusEl.textContent = msg;
}

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sendMessage(msg: unknown): Promise<any> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      resolve(res ?? { ok: false, error: "no response" });
    });
  });
}
