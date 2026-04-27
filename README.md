# Repo Architecture Visualizer

**A Chrome extension that turns any GitHub repo into an interactive dependency graph.**

Click a button on any GitHub repo page → see its full file structure as a force-directed graph, with circular imports highlighted, and an AI-generated architectural summary one click away.

## Features

- **One-click visualization** — adds a `⚡ Visualize` button to GitHub's repo header
- **Force-directed graph** — nodes are files, edges are imports, sized by lines of code, colored by folder
- **Cycle detection** — circular imports highlighted in red with red arrows
- **AI architecture summary** — Claude Opus 4.7 reads the graph structure (no source code) and explains the codebase in 3 paragraphs
- **Hot Files panel** — top-10 most-imported files, the spine of the codebase
- **Search & filter** — find files instantly, filter by folder
- **Path resolution** — handles `tsconfig.json` aliases, extension lookup (`.ts`/`.tsx`/`.js`), and `/index.ts` directories
- **Export PNG** — download the graph as a high-res image
- **Export Mermaid** — copy a Mermaid diagram for your README
- **SHA-keyed cache** — re-visiting a repo at the same commit is instant

## Stack

**Vite** + **@crxjs/vite-plugin** · **TypeScript** · **D3** (force-layout, drag, zoom) · **Anthropic Claude API**

## How it works

Three runtime contexts, each with a specific job:

1. **Content script** — detects GitHub repo pages, injects the Visualize button, handles Turbo SPA navigation idempotently
2. **Background service worker** — proxies all GitHub API calls (centralizes auth via PAT and rate limiting), caches responses keyed by commit SHA in `chrome.storage.local`
3. **Viewer page** — opens in a new tab (avoids GitHub's CSP), fetches files in parallel, parses imports, resolves paths, builds the graph, renders with D3

### Privacy

- **Personal Access Tokens** are stored locally only (`chrome.storage.local`, never `sync`)
- The AI summary feature sends **only graph structure** (file paths, import edges, folder counts) to Claude — never any source code

## Install (developer mode)

```bash
git clone https://github.com/Sha547/repo-architecture-viz.git
cd repo-architecture-viz
npm install
npm run build
```

Then in Chrome:

1. Go to `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `dist/` folder

Visit any TypeScript / JavaScript GitHub repo and click the **⚡ Visualize** button next to "Code" in the repo header.

### Optional configuration

- **GitHub PAT** — increases the API rate limit from 60 → 5000 requests/hour. Click the **PAT** button in the viewer top bar.
- **Anthropic API key** — required for the **✨ Explain** feature. Click **AI key** in the top bar.

Both are stored locally in your browser only.

## What's next

- Layered (Sugiyama) layout option using `dagre` for cleaner hierarchies on large repos
- Folder-collapse mode (each folder = one super-node, click to expand)
- Tree-sitter WASM parsing (replacing regex) for accuracy on edge cases
- Multi-language support (Python, Go, Rust)
- PR diff mode — visualize only files touched by a pull request

---

MIT
