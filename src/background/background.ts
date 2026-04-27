type Message =
  | { type: "OPEN_VISUALIZER"; owner: string; repo: string }
  | { type: "FETCH_TREE"; owner: string; repo: string }
  | {
      type: "FETCH_FILE";
      owner: string;
      repo: string;
      sha: string;
      path: string;
    }
  | { type: "GET_PAT" }
  | { type: "SET_PAT"; pat: string }
  | { type: "GET_ANTHROPIC_KEY" }
  | { type: "SET_ANTHROPIC_KEY"; key: string }
  | { type: "EXPLAIN_ARCHITECTURE"; payload: ArchitecturePayload };

interface ArchitecturePayload {
  repo: string;
  fileCount: number;
  edgeCount: number;
  folders: { name: string; fileCount: number }[];
  topImported: { path: string; importers: number }[];
  externalDeps: string[];
  cycles: string[][]; // optional, may be empty
}

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  if (msg.type === "OPEN_VISUALIZER") {
    const url = chrome.runtime.getURL(
      `src/viewer/viewer.html?owner=${msg.owner}&repo=${msg.repo}`,
    );
    chrome.tabs.create({ url });
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === "FETCH_TREE") {
    fetchRepoTree(msg.owner, msg.repo)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === "FETCH_FILE") {
    fetchFileContent(msg.owner, msg.repo, msg.sha, msg.path)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === "GET_PAT") {
    chrome.storage.local.get("githubPat").then((stored) => {
      const pat = typeof stored.githubPat === "string" ? stored.githubPat : "";
      sendResponse({ ok: true, pat });
    });
    return true;
  }

  if (msg.type === "SET_PAT") {
    chrome.storage.local.set({ githubPat: msg.pat }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "GET_ANTHROPIC_KEY") {
    chrome.storage.local.get("anthropicKey").then((stored) => {
      const key =
        typeof stored.anthropicKey === "string" ? stored.anthropicKey : "";
      sendResponse({ ok: true, key });
    });
    return true;
  }

  if (msg.type === "SET_ANTHROPIC_KEY") {
    chrome.storage.local.set({ anthropicKey: msg.key }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "EXPLAIN_ARCHITECTURE") {
    explainArchitecture(msg.payload)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});

async function getPat(): Promise<string | undefined> {
  const stored = await chrome.storage.local.get("githubPat");
  return typeof stored.githubPat === "string" && stored.githubPat
    ? stored.githubPat
    : undefined;
}

async function fetchRepoTree(owner: string, repo: string) {
  const pat = await getPat();
  const repoMeta = await ghFetch(`/repos/${owner}/${repo}`, pat);
  const branch: string = repoMeta.default_branch;

  const ref = await ghFetch(
    `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    pat,
  );
  const sha: string = ref.object.sha;

  const cacheKey = `tree:${owner}/${repo}@${sha}`;
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey]) return cached[cacheKey];

  const tree = await ghFetch(
    `/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
    pat,
  );
  const result = { ...tree, sha, branch };
  await chrome.storage.local.set({ [cacheKey]: result });
  return result;
}

async function fetchFileContent(
  owner: string,
  repo: string,
  sha: string,
  path: string,
) {
  const cacheKey = `file:${owner}/${repo}@${sha}:${path}`;
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey]) return cached[cacheKey];

  const pat = await getPat();
  const url = `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${sha}`;
  const data = await ghFetch(url, pat);
  const content =
    data.encoding === "base64" ? atob(data.content.replace(/\n/g, "")) : "";

  await chrome.storage.local.set({ [cacheKey]: content });
  return content;
}

async function ghFetch(path: string, pat?: string) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (pat) headers.Authorization = `Bearer ${pat}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status}: ${path} — ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function explainArchitecture(p: ArchitecturePayload): Promise<string> {
  const stored = await chrome.storage.local.get("anthropicKey");
  const key =
    typeof stored.anthropicKey === "string" ? stored.anthropicKey : "";
  if (!key) {
    throw new Error("Anthropic API key not set. Click 'AI key' to add one.");
  }

  const summary = JSON.stringify(
    {
      repo: p.repo,
      file_count: p.fileCount,
      edge_count: p.edgeCount,
      top_folders: p.folders,
      top_imported_files: p.topImported,
      external_dependencies: p.externalDeps.slice(0, 30),
      circular_imports: p.cycles.slice(0, 10),
    },
    null,
    2,
  );

  const system = `You are a senior software engineer explaining a codebase to a new contributor. You will be given the structural shape of a repository — folders, file counts, top-imported files, external dependencies, circular imports — but NO source code. Explain in three short paragraphs:

1. **What the code likely does** — infer the purpose from folder names, dependencies, and import patterns
2. **Architectural patterns you see** — layering, modularity, possible smells
3. **Where to start reading** — name 3 specific files or folders, in order, that a new contributor should open

Be concrete and specific. Use the exact file/folder names. Don't hedge with "this might be" — pick a likely interpretation and commit to it. No bullet points, just three flowing paragraphs.`;

  const body = {
    model: "claude-opus-4-7",
    max_tokens: 1500,
    system,
    messages: [
      {
        role: "user",
        content: `Here is the structural data for the repository:\n\n${summary}`,
      },
    ],
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();
  const block = data.content?.find((b: { type: string }) => b.type === "text");
  if (!block) throw new Error("Empty response from Anthropic");
  return block.text;
}
