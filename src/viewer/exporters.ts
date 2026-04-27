// Export the rendered graph to PNG, and emit a Mermaid diagram from graph data.

import type { FileNode, ImportEdge } from "./graph/builder";

export async function exportSvgAsPng(
  svgElement: SVGSVGElement,
  filename: string,
  scale = 2,
): Promise<void> {
  const serializer = new XMLSerializer();
  // Make sure styles are inlined-ish: we copy computed styles for nodes/edges
  const clone = svgElement.cloneNode(true) as SVGSVGElement;

  // Add a dark background rect so the export isn't transparent
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", "#0d0d0f");
  clone.insertBefore(bg, clone.firstChild);

  const svgString = serializer.serializeToString(clone);
  const svgBlob = new Blob([svgString], {
    type: "image/svg+xml;charset=utf-8",
  });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = url;
  });

  const viewBox = svgElement.viewBox.baseVal;
  const width = viewBox && viewBox.width ? viewBox.width : svgElement.clientWidth;
  const height =
    viewBox && viewBox.height ? viewBox.height : svgElement.clientHeight;

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);

  URL.revokeObjectURL(url);

  const dataUrl = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function buildMermaid(
  nodes: FileNode[],
  edges: ImportEdge[],
  options: { includeExternal?: boolean; maxNodes?: number } = {},
): string {
  const { includeExternal = false, maxNodes = 80 } = options;

  const filteredNodes = (
    includeExternal ? nodes : nodes.filter((n) => !n.external)
  ).slice(0, maxNodes);

  const includedIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = edges.filter(
    (e) => includedIds.has(e.source) && includedIds.has(e.target),
  );

  const idMap = new Map<string, string>();
  filteredNodes.forEach((n, i) => {
    idMap.set(n.id, `n${i}`);
  });

  const lines: string[] = ["flowchart LR"];
  for (const node of filteredNodes) {
    const safe = node.id.replace(/"/g, '\\"');
    const label =
      node.id.startsWith("external:") ? safe.slice(9) : safe.split("/").pop() ?? safe;
    lines.push(`  ${idMap.get(node.id)}["${label}"]`);
  }
  for (const edge of filteredEdges) {
    const s = idMap.get(edge.source);
    const t = idMap.get(edge.target);
    if (s && t) lines.push(`  ${s} --> ${t}`);
  }

  if (nodes.length > maxNodes) {
    lines.push(`  %% Truncated: showing ${maxNodes} of ${nodes.length} nodes`);
  }

  return lines.join("\n");
}
