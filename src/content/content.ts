const BUTTON_ID = "repo-architecture-viz-button";

function isRepoPage(): boolean {
  // /owner/repo, /owner/repo/tree/branch, /owner/repo/blob/...
  return /^\/[^/]+\/[^/]+(\/(tree|blob)\/.*)?$/.test(window.location.pathname);
}

function findHeaderActions(): Element | null {
  return (
    document.querySelector('[data-testid="repository-container-header"] ul') ||
    document.querySelector(".pagehead-actions") ||
    null
  );
}

function injectButton() {
  if (!isRepoPage()) return;
  if (document.getElementById(BUTTON_ID)) return;

  const header = findHeaderActions();
  if (!header) return;

  const li = document.createElement("li");
  const btn = document.createElement("button");
  btn.id = BUTTON_ID;
  btn.className = "btn btn-sm";
  btn.style.cssText = "display:inline-flex;align-items:center;gap:4px;";
  btn.innerHTML = "<span>⚡</span><span>Visualize</span>";
  btn.addEventListener("click", () => {
    const [, owner, repo] = window.location.pathname.split("/");
    chrome.runtime.sendMessage({ type: "OPEN_VISUALIZER", owner, repo });
  });
  li.appendChild(btn);
  header.appendChild(li);
}

document.addEventListener("turbo:load", injectButton);
injectButton();
