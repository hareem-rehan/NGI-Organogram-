import { NODE_HEIGHT, NODE_WIDTH } from "@/app/(app)/organogram/_lib/elk-layout";

import { EXPORT_COLORS, resolveDepartmentColor } from "./colors";
import { escapeXmlText, wrapText } from "./svg-text";

/**
 * Server-side SVG generator for organogram export
 * (docs/adr/0013-organogram-export-rendering.md). Pure and deterministic
 * — given the same nodes/edges/layout/options, always produces the exact
 * same SVG string (Step 5's "deterministic rendering" requirement).
 *
 * Security posture (Step 5/14): no `<script>`, no `<foreignObject>`, no
 * external `xlink:href`/`<image>` references, every text value passed
 * through `escapeXmlText`. This is the ONLY place export output is
 * assembled — PNG (`png-renderer.ts`) and PDF (`pdf-renderer.ts`) both
 * convert THIS SVG rather than drawing independently, so a fix here
 * fixes both formats at once.
 */

export interface SvgRenderNode {
  positionId: string;
  title: string;
  positionCode: string;
  departmentName: string;
  departmentColor: string | null;
  organizationalLevel: number;
  jobGradeName: string | null;
  occupancyStatus: "occupied" | "vacant";
  occupantDisplayName: string | null;
  positionStatus: "PLANNED" | "ACTIVE" | "INACTIVE";
  matchState: "none" | "match" | "context";
}

export interface SvgRenderEdge {
  sourcePositionId: string;
  targetPositionId: string;
}

export interface SvgLayoutPosition {
  x: number;
  y: number;
}

export interface SvgRenderMetadata {
  companyName: string;
  effectiveDate: string;
  scopeLabel: string;
  focusLabel: string | null;
  filtersSummary: string | null;
  generatedAtLabel: string;
}

export interface SvgLegendDepartment {
  id: string;
  name: string;
  color: string | null;
}

export interface SvgRenderOptions {
  includeLegend: boolean;
  includeMetadata: boolean;
  includeConfidentialityLabel: boolean;
  departments: readonly SvgLegendDepartment[];
}

export interface SvgRenderResult {
  svg: string;
  totalWidth: number;
  totalHeight: number;
  graphWidth: number;
  graphHeight: number;
  headerHeight: number;
  /** Top-left offset of the graph area within the full SVG — needed by the PDF tiler to slice the graph into page-sized regions without re-deriving this geometry. */
  graphOffsetX: number;
  graphOffsetY: number;
}

const PADDING = 40;
const HEADER_HEIGHT = 96;
const FOOTER_HEIGHT = 32;
const LEGEND_ROW_HEIGHT = 16;
const LEGEND_COLUMN_WIDTH = 200;
const MIN_CANVAS_WIDTH = 640;

const STATUS_LEGEND_ENTRIES = [
  { label: "Occupied", color: EXPORT_COLORS.statusFilled },
  { label: "Vacant", color: EXPORT_COLORS.statusVacant },
  { label: "Planned position", color: EXPORT_COLORS.statusPlanned },
  { label: "Inactive position", color: EXPORT_COLORS.statusInactive },
  { label: "Match", color: EXPORT_COLORS.primary },
  { label: "Context", color: EXPORT_COLORS.mutedForeground },
  // The interactive legend (organogram-legend.tsx) swatches this entry
  // with `bg-border` — deliberately NOT reused here. `--color-border`
  // (#e2e8f0) reads fine as a hairline on the app's own slightly-off-
  // white surfaces, but is barely visible as a flat legend dot against
  // this export's pure white background; `mutedForeground` matches what
  // `renderEdgePath` actually strokes connectors with, so the legend
  // swatch and the real line color agree.
  { label: "Primary reporting line", color: EXPORT_COLORS.mutedForeground },
] as const;

function nodeBadgeLabels(node: SvgRenderNode): string[] {
  const labels: string[] = [];
  if (node.matchState === "match") labels.push("MATCH");
  if (node.matchState === "context") labels.push("CONTEXT");
  if (node.positionStatus === "PLANNED") labels.push("PLANNED");
  if (node.positionStatus === "INACTIVE") labels.push("INACTIVE");
  return labels;
}

function renderNodeCard(node: SvgRenderNode, position: SvgLayoutPosition): string {
  const accentColor = resolveDepartmentColor(node.departmentColor);
  const isMatch = node.matchState === "match";
  const isContext = node.matchState === "context";
  const strokeColor = isMatch ? EXPORT_COLORS.primary : EXPORT_COLORS.border;
  const strokeWidth = isMatch ? 2 : 1;
  const opacity = isContext ? 0.6 : 1;

  const titleLines = wrapText(node.title, 28, 2);
  const occupantText =
    node.occupancyStatus === "vacant" ? "Vacant" : (node.occupantDisplayName ?? "—");
  const occupantColor =
    node.occupancyStatus === "vacant" ? EXPORT_COLORS.statusVacant : EXPORT_COLORS.foreground;
  const deptLevelText = `${node.departmentName} · Level ${node.organizationalLevel}${node.jobGradeName ? ` · ${node.jobGradeName}` : ""}`;
  const [deptLevelLine] = wrapText(deptLevelText, 34, 1);
  const badgeLabels = nodeBadgeLabels(node);

  const parts: string[] = [];
  parts.push(`<g transform="translate(${position.x}, ${position.y})" opacity="${opacity}">`);
  parts.push(
    `<rect x="0" y="0" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="8" fill="${EXPORT_COLORS.background}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />`
  );
  parts.push(`<rect x="0" y="0" width="6" height="${NODE_HEIGHT}" fill="${accentColor}" />`);

  if (badgeLabels.length > 0) {
    parts.push(
      `<text x="${NODE_WIDTH - 14}" y="16" font-size="8" font-weight="600" letter-spacing="0.3" text-anchor="end" fill="${EXPORT_COLORS.mutedForeground}">${escapeXmlText(badgeLabels.join(" · "))}</text>`
    );
  }

  titleLines.forEach((line, index) => {
    parts.push(
      `<text x="16" y="${22 + index * 16}" font-size="13" font-weight="700" fill="${EXPORT_COLORS.foreground}">${escapeXmlText(line)}</text>`
    );
  });

  parts.push(
    `<text x="16" y="62" font-size="12" font-weight="500" fill="${occupantColor}">${escapeXmlText(occupantText)}</text>`
  );
  if (deptLevelLine) {
    parts.push(
      `<text x="16" y="80" font-size="11" fill="${EXPORT_COLORS.mutedForeground}">${escapeXmlText(deptLevelLine)}</text>`
    );
  }
  parts.push(
    `<text x="16" y="98" font-size="10" fill="${EXPORT_COLORS.mutedForeground}">${escapeXmlText(node.positionCode)}</text>`
  );

  parts.push("</g>");
  return parts.join("");
}

function renderEdgePath(source: SvgLayoutPosition, target: SvgLayoutPosition): string {
  const sx = source.x + NODE_WIDTH / 2;
  const sy = source.y + NODE_HEIGHT;
  const tx = target.x + NODE_WIDTH / 2;
  const ty = target.y;
  const midY = sy + (ty - sy) / 2;
  const d = `M ${sx} ${sy} L ${sx} ${midY} L ${tx} ${midY} L ${tx} ${ty}`;
  return `<path d="${d}" fill="none" stroke="${EXPORT_COLORS.mutedForeground}" stroke-width="1.5" />`;
}

function renderHeader(
  metadata: SvgRenderMetadata,
  width: number,
  includeMetadata: boolean
): string {
  if (!includeMetadata) return "";
  const lines = [
    `<text x="${PADDING}" y="24" font-size="18" font-weight="700" fill="${EXPORT_COLORS.foreground}">${escapeXmlText(metadata.companyName)} — Organogram</text>`,
    `<text x="${PADDING}" y="44" font-size="12" fill="${EXPORT_COLORS.mutedForeground}">Effective ${escapeXmlText(metadata.effectiveDate)} · Scope: ${escapeXmlText(metadata.scopeLabel)}${metadata.focusLabel ? ` — ${escapeXmlText(metadata.focusLabel)}` : ""}</text>`,
  ];
  if (metadata.filtersSummary) {
    lines.push(
      `<text x="${PADDING}" y="62" font-size="11" fill="${EXPORT_COLORS.mutedForeground}">Filters: ${escapeXmlText(metadata.filtersSummary)}</text>`
    );
  }
  void width;
  return lines.join("");
}

function renderFooter(
  metadata: SvgRenderMetadata,
  y: number,
  width: number,
  includeConfidentialityLabel: boolean
): string {
  const parts: string[] = [];
  parts.push(
    `<text x="${PADDING}" y="${y + 20}" font-size="10" fill="${EXPORT_COLORS.mutedForeground}">Generated ${escapeXmlText(metadata.generatedAtLabel)}</text>`
  );
  if (includeConfidentialityLabel) {
    parts.push(
      `<text x="${width - PADDING}" y="${y + 20}" font-size="10" font-weight="600" text-anchor="end" fill="${EXPORT_COLORS.mutedForeground}">Confidential — Internal Use Only</text>`
    );
  }
  return parts.join("");
}

function renderLegend(
  departments: readonly SvgLegendDepartment[],
  y: number
): { svg: string; height: number } {
  const statusRows = STATUS_LEGEND_ENTRIES.length;
  const deptRows = departments.length;
  const rows = Math.max(statusRows, deptRows);
  const height = rows * LEGEND_ROW_HEIGHT + 24;

  const parts: string[] = [];
  parts.push(
    `<text x="${PADDING}" y="${y + 14}" font-size="11" font-weight="700" fill="${EXPORT_COLORS.foreground}">Legend</text>`
  );

  STATUS_LEGEND_ENTRIES.forEach((entry, index) => {
    const rowY = y + 32 + index * LEGEND_ROW_HEIGHT;
    parts.push(`<circle cx="${PADDING + 4}" cy="${rowY - 4}" r="4" fill="${entry.color}" />`);
    parts.push(
      `<text x="${PADDING + 14}" y="${rowY}" font-size="10" fill="${EXPORT_COLORS.foreground}">${escapeXmlText(entry.label)}</text>`
    );
  });

  if (departments.length > 0) {
    const deptX = PADDING + LEGEND_COLUMN_WIDTH;
    parts.push(
      `<text x="${deptX}" y="${y + 14}" font-size="11" font-weight="700" fill="${EXPORT_COLORS.foreground}">Departments</text>`
    );
    departments.forEach((dept, index) => {
      const rowY = y + 32 + index * LEGEND_ROW_HEIGHT;
      parts.push(
        `<circle cx="${deptX + 4}" cy="${rowY - 4}" r="4" fill="${resolveDepartmentColor(dept.color)}" stroke="${EXPORT_COLORS.border}" />`
      );
      parts.push(
        `<text x="${deptX + 14}" y="${rowY}" font-size="10" fill="${EXPORT_COLORS.foreground}">${escapeXmlText(dept.name)}</text>`
      );
    });
  }

  return { svg: parts.join(""), height };
}

/**
 * Renders the complete organogram (or a safe "no positions" message for
 * an empty selection) to a self-contained SVG document string. Node
 * positions come from the caller's own `computeElkLayout` call — this
 * function never computes layout itself.
 */
export function renderOrganogramSvg(
  nodes: readonly SvgRenderNode[],
  edges: readonly SvgRenderEdge[],
  positions: ReadonlyMap<string, SvgLayoutPosition>,
  metadata: SvgRenderMetadata,
  options: SvgRenderOptions
): SvgRenderResult {
  const headerHeight = options.includeMetadata ? HEADER_HEIGHT : PADDING;

  if (nodes.length === 0) {
    const totalWidth = MIN_CANVAS_WIDTH;
    const totalHeight = headerHeight + 120 + FOOTER_HEIGHT + PADDING * 2;
    const body = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">`,
      `<rect width="100%" height="100%" fill="${EXPORT_COLORS.background}" />`,
      renderHeader(metadata, totalWidth, options.includeMetadata),
      `<text x="${totalWidth / 2}" y="${headerHeight + 60}" font-size="14" text-anchor="middle" fill="${EXPORT_COLORS.mutedForeground}">No positions to export.</text>`,
      renderFooter(
        metadata,
        totalHeight - FOOTER_HEIGHT - PADDING,
        totalWidth,
        options.includeConfidentialityLabel
      ),
      `</svg>`,
    ].join("");
    return {
      svg: body,
      totalWidth,
      totalHeight,
      graphWidth: 0,
      graphHeight: 0,
      headerHeight,
      graphOffsetX: PADDING,
      graphOffsetY: headerHeight,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const pos = positions.get(node.positionId);
    if (!pos) continue;
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + NODE_WIDTH);
    maxY = Math.max(maxY, pos.y + NODE_HEIGHT);
  }
  const graphWidth = maxX - minX;
  const graphHeight = maxY - minY;

  const graphOffsetX = PADDING;
  const graphOffsetY = headerHeight;

  const nodesById = new Map(nodes.map((n) => [n.positionId, n]));
  const nodesSvg = nodes
    .map((node) => {
      const pos = positions.get(node.positionId);
      if (!pos) return "";
      return renderNodeCard(node, { x: pos.x - minX, y: pos.y - minY });
    })
    .join("");

  const edgesSvg = edges
    .map((edge) => {
      const sourcePos = positions.get(edge.sourcePositionId);
      const targetPos = positions.get(edge.targetPositionId);
      if (
        !sourcePos ||
        !targetPos ||
        !nodesById.has(edge.sourcePositionId) ||
        !nodesById.has(edge.targetPositionId)
      ) {
        return "";
      }
      return renderEdgePath(
        { x: sourcePos.x - minX, y: sourcePos.y - minY },
        { x: targetPos.x - minX, y: targetPos.y - minY }
      );
    })
    .join("");

  const totalWidth = Math.max(graphWidth, MIN_CANVAS_WIDTH) + PADDING * 2;
  let cursorY = headerHeight + graphHeight + PADDING;

  let legendSvg = "";
  let legendHeight = 0;
  if (options.includeLegend) {
    const legend = renderLegend(options.departments, cursorY);
    legendSvg = legend.svg;
    legendHeight = legend.height;
    cursorY += legendHeight + PADDING;
  }

  const totalHeight = cursorY + FOOTER_HEIGHT + PADDING;

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">`,
    `<rect width="100%" height="100%" fill="${EXPORT_COLORS.background}" />`,
    renderHeader(metadata, totalWidth, options.includeMetadata),
    `<g transform="translate(${graphOffsetX}, ${graphOffsetY})">`,
    `<g id="edges">${edgesSvg}</g>`,
    `<g id="nodes">${nodesSvg}</g>`,
    `</g>`,
    legendSvg,
    renderFooter(
      metadata,
      totalHeight - FOOTER_HEIGHT - PADDING / 2,
      totalWidth,
      options.includeConfidentialityLabel
    ),
    `</svg>`,
  ].join("");

  return {
    svg,
    totalWidth,
    totalHeight,
    graphWidth,
    graphHeight,
    headerHeight,
    graphOffsetX,
    graphOffsetY,
  };
}
