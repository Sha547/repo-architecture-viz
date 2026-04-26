import * as d3 from "d3";
import type { FileNode, ImportEdge } from "./builder";

interface SimNode extends FileNode, d3.SimulationNodeDatum {}
interface SimEdge extends d3.SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
  count: number;
}

export interface RenderResult {
  destroy: () => void;
  highlightNode: (id: string | null) => void;
  filterByFolder: (folders: Set<string> | null) => void;
}

export function renderForceGraph(
  container: HTMLElement,
  rawNodes: FileNode[],
  rawEdges: ImportEdge[],
  options: {
    onNodeClick?: (node: FileNode) => void;
  } = {},
): RenderResult {
  // Defensive copy because d3 mutates
  const nodes: SimNode[] = rawNodes.map((n) => ({ ...n }));
  const edges: SimEdge[] = rawEdges.map((e) => ({ ...e }));

  const width = container.clientWidth;
  const height = container.clientHeight;

  // Clear
  container.innerHTML = "";

  const folderSet = [...new Set(nodes.map((n) => n.folder))];
  const folderColor = d3.scaleOrdinal(d3.schemeTableau10).domain(folderSet);

  const svg = d3
    .select(container)
    .append("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("preserveAspectRatio", "xMidYMid meet");

  const g = svg.append("g");

  // Zoom + pan
  svg.call(
    d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on("zoom", (e) => {
        g.attr("transform", e.transform.toString());
      }),
  );

  // Edge arrowhead
  const defs = svg.append("defs");
  defs
    .append("marker")
    .attr("id", "arrow")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 14)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", "#666");

  const link = g
    .append("g")
    .selectAll("line")
    .data(edges)
    .join("line")
    .attr("stroke", "#52525c")
    .attr("stroke-opacity", 0.5)
    .attr("stroke-width", (d) => Math.min(3, Math.sqrt(d.count)))
    .attr("marker-end", "url(#arrow)");

  const node = g
    .append("g")
    .selectAll("circle")
    .data(nodes)
    .join("circle")
    .attr("r", (d) => (d.external ? 6 : 4 + Math.sqrt(d.loc) / 5))
    .attr("fill", (d) => folderColor(d.folder))
    .attr("stroke", (d) => (d.external ? "#86868b" : "#0d0d0f"))
    .attr("stroke-width", 1.5)
    .attr("opacity", (d) => (d.external ? 0.55 : 1))
    .style("cursor", "pointer")
    .on("click", (_e, d) => options.onNodeClick?.(d));

  node.append("title").text((d) => `${d.id}\n${d.loc} loc`);

  const label = g
    .append("g")
    .selectAll("text")
    .data(nodes)
    .join("text")
    .text((d) => filename(d.id))
    .attr("font-size", 9)
    .attr("font-family", "ui-monospace, monospace")
    .attr("fill", "#b0b0b6")
    .attr("opacity", 0)
    .attr("dx", 8)
    .attr("dy", 3)
    .style("pointer-events", "none");

  const simulation = d3
    .forceSimulation<SimNode>(nodes)
    .force(
      "link",
      d3
        .forceLink<SimNode, SimEdge>(edges)
        .id((d) => d.id)
        .distance((d) => 40 + 20 / Math.sqrt(d.count))
        .strength(0.3),
    )
    .force("charge", d3.forceManyBody().strength(-180))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force(
      "collide",
      d3.forceCollide<SimNode>().radius((d) => (d.external ? 10 : 8 + Math.sqrt(d.loc) / 5)),
    );

  simulation.on("tick", () => {
    link
      .attr("x1", (d) => (typeof d.source === "object" ? d.source.x! : 0))
      .attr("y1", (d) => (typeof d.source === "object" ? d.source.y! : 0))
      .attr("x2", (d) => (typeof d.target === "object" ? d.target.x! : 0))
      .attr("y2", (d) => (typeof d.target === "object" ? d.target.y! : 0));
    node.attr("cx", (d) => d.x!).attr("cy", (d) => d.y!);
    label.attr("x", (d) => d.x!).attr("y", (d) => d.y!);
  });

  // Drag
  node.call(
    d3
      .drag<SVGCircleElement, SimNode>()
      .on("start", (e, d) => {
        if (!e.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (e, d) => {
        d.fx = e.x;
        d.fy = e.y;
      })
      .on("end", (e, d) => {
        if (!e.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      }) as never,
  );

  // Hover labels
  node
    .on("mouseenter", (_e, d) => {
      label.filter((n) => n.id === d.id).attr("opacity", 1);
    })
    .on("mouseleave", (_e, d) => {
      label.filter((n) => n.id === d.id).attr("opacity", 0);
    });

  return {
    destroy: () => {
      simulation.stop();
      container.innerHTML = "";
    },
    highlightNode: (id: string | null) => {
      node.attr("opacity", (d) =>
        id == null ? (d.external ? 0.55 : 1) : d.id === id ? 1 : 0.15,
      );
      link.attr("stroke-opacity", (d) => {
        if (id == null) return 0.5;
        const sId = typeof d.source === "object" ? d.source.id : d.source;
        const tId = typeof d.target === "object" ? d.target.id : d.target;
        return sId === id || tId === id ? 0.85 : 0.08;
      });
    },
    filterByFolder: (folders: Set<string> | null) => {
      node.attr("opacity", (d) =>
        folders == null || folders.has(d.folder)
          ? d.external
            ? 0.55
            : 1
          : 0.05,
      );
      link.attr("stroke-opacity", (d) => {
        if (folders == null) return 0.5;
        const s = typeof d.source === "object" ? d.source : null;
        const t = typeof d.target === "object" ? d.target : null;
        const visible =
          (s && folders.has(s.folder)) || (t && folders.has(t.folder));
        return visible ? 0.5 : 0.05;
      });
    },
  };
}

function filename(path: string): string {
  if (path.startsWith("external:")) return path.slice(9);
  return path.split("/").pop() ?? path;
}

export { folderColorOf };

function folderColorOf(folders: string[]): (folder: string) => string {
  const scale = d3.scaleOrdinal(d3.schemeTableau10).domain(folders);
  return (folder: string) => scale(folder);
}
