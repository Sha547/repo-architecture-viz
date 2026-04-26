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
  | { type: "SET_PAT"; pat: string };

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

  // GitHub returns base64-encoded content for files under ~1MB
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
