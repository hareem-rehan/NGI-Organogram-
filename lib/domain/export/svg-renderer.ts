import { NODE_HEIGHT, NODE_WIDTH } from "@/app/(app)/organogram/_lib/elk-layout";
import { lightTint, type FamilyColor } from "@/lib/domain/organogram-family-colors";

import { EXPORT_COLORS, resolveDepartmentColor } from "./colors";
import { escapeXmlText, wrapText } from "./svg-text";
import type { ExportColorMode } from "./types";

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
  /** e.g. "L7" — what the compact card shows in place of the old department/level/grade line. */
  jobGradeCode: string | null;
  /** Career family — shown beside the grade and, in "family" colour mode, colours the card. */
  jobFamilyId: string | null;
  jobFamilyName: string | null;
  occupancyStatus: "occupied" | "vacant";
  occupantDisplayName: string | null;
  positionStatus: "PLANNED" | "ACTIVE" | "INACTIVE";
  matchState: "none" | "match" | "context";
  /**
   * A synthetic department heading rather than a real position
   * (lib/domain/organogram-leadership-graph.ts). Absent means "position",
   * so every pre-existing caller keeps its behaviour unchanged.
   */
  kind?: "position" | "department";
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

export interface SvgLegendFamily {
  id: string;
  name: string;
  /** Resolved accent colour for the swatch. */
  color: string;
}

export interface SvgRenderOptions {
  includeLegend: boolean;
  includeMetadata: boolean;
  includeConfidentialityLabel: boolean;
  departments: readonly SvgLegendDepartment[];
  /** Which dimension colours the cards; defaults to "department". */
  colorMode?: ExportColorMode;
  /** Per-department palette colours, keyed by department name (department mode). */
  departmentColorByName?: ReadonlyMap<string, FamilyColor>;
  /** Per-sub-division palette colours, used in "family" mode. */
  familyColorById?: ReadonlyMap<string, FamilyColor>;
  /** Sub-divisions for the legend in "family" mode. */
  families?: readonly SvgLegendFamily[];
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

/**
 * Neither renderer resolves CSS, and neither defaults to a sans-serif:
 * sharp/librsvg (PNG) and svg-to-pdfkit (PDF) both fall back to a SERIF
 * face when `font-family` is absent, so exports came out in Times while
 * the app itself is sans-serif. Declared once on the root `<svg>` and
 * inherited by every `<text>`. Helvetica leads deliberately — it is one
 * of PDF's base-14 fonts (so svg-to-pdfkit embeds it with no font file),
 * and fontconfig resolves it to a sans substitute (Nimbus/Liberation
 * Sans) wherever real Helvetica is absent.
 */
const EXPORT_FONT_FAMILY = "Helvetica, Arial, sans-serif";

const PADDING = 40;
const HEADER_HEIGHT = 96;
const FOOTER_HEIGHT = 32;
const LEGEND_ROW_HEIGHT = 16;
const LEGEND_COLUMN_WIDTH = 200;
const MIN_CANVAS_WIDTH = 640;

interface StatusLegendEntry {
  label: string;
  color: string;
}

/**
 * Every row here must correspond to something a reader can actually SEE
 * on this export, otherwise the legend is a key to nothing. It previously
 * listed all seven signals unconditionally while the cards rendered only
 * some of them. Occupied cards now carry a real green occupancy dot
 * (`renderNodeCard`); a vacant card carries no dot and no "Vacant"
 * wording (Demo-1: vacancies are not surfaced), so the key lists
 * "Occupied" alone. Status-colored badges and the transient search
 * states are listed only when a node actually carries them.
 */
function statusLegendEntriesFor(nodes: readonly SvgRenderNode[]): StatusLegendEntry[] {
  // Only occupied cards carry a dot (a vacant role shows no dot and no
  // "Vacant" wording — stakeholder Demo-1 feedback: the chart must not
  // surface vacancies). So the key lists "Occupied" alone; vacancy is
  // conveyed, as on screen, by the absence of a name on the card.
  const entries: StatusLegendEntry[] = [{ label: "Occupied", color: EXPORT_COLORS.statusFilled }];
  if (nodes.some((node) => node.positionStatus === "PLANNED")) {
    entries.push({ label: "Planned position", color: EXPORT_COLORS.statusPlanned });
  }
  if (nodes.some((node) => node.positionStatus === "INACTIVE")) {
    entries.push({ label: "Inactive position", color: EXPORT_COLORS.statusInactive });
  }
  if (nodes.some((node) => node.matchState === "match")) {
    entries.push({ label: "Match", color: EXPORT_COLORS.primary });
  }
  if (nodes.some((node) => node.matchState === "context")) {
    entries.push({ label: "Context", color: EXPORT_COLORS.mutedForeground });
  }
  // The interactive legend (organogram-legend.tsx) swatches this entry
  // with `bg-border` — deliberately NOT reused here. `--color-border`
  // reads fine as a hairline on the app's own slightly-off-white
  // surfaces, but is barely visible as a flat legend dot against this
  // export's pure white background; `mutedForeground` matches what
  // `renderEdgePath` actually strokes connectors with, so the legend
  // swatch and the real line color agree.
  entries.push({ label: "Primary reporting line", color: EXPORT_COLORS.mutedForeground });
  return entries;
}

/** Colored to match its own legend swatch. Position status wins over search state: status is a property of the data, match state is transient to one search. */
function nodeBadge(node: SvgRenderNode): { label: string; color: string } | null {
  const labels: string[] = [];
  if (node.matchState === "match") labels.push("MATCH");
  if (node.matchState === "context") labels.push("CONTEXT");
  if (node.positionStatus === "PLANNED") labels.push("PLANNED");
  if (node.positionStatus === "INACTIVE") labels.push("INACTIVE");
  if (labels.length === 0) return null;

  const color =
    node.positionStatus === "PLANNED"
      ? EXPORT_COLORS.statusPlanned
      : node.positionStatus === "INACTIVE"
        ? EXPORT_COLORS.statusInactive
        : node.matchState === "match"
          ? EXPORT_COLORS.primary
          : EXPORT_COLORS.mutedForeground;
  return { label: labels.join(" · "), color };
}

/**
 * The department tier's card. Mirrors `position-node.tsx`'s
 * DepartmentNodeCard: filled rather than outlined, uppercase name, role
 * count, and no occupancy dot or status badge — a department is a
 * heading, not a seat. This renderer draws its own copy of every card, so
 * the two only stay alike if they are changed together.
 */
function renderDepartmentCard(
  node: SvgRenderNode,
  position: SvgLayoutPosition,
  roleCount: number,
  departmentColorByName: ReadonlyMap<string, FamilyColor> | undefined
): string {
  const { fill: bodyFill, accent: accentColor } = cardColorsFor(
    node,
    "department",
    undefined,
    departmentColorByName
  );
  const nameLines = wrapText(node.departmentName.toUpperCase(), 26, 2);

  const parts: string[] = [];
  parts.push(`<g transform="translate(${position.x}, ${position.y})" opacity="1">`);
  parts.push(
    `<rect x="0" y="0" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="8" fill="${bodyFill}" stroke="${accentColor}" stroke-width="1.5" />`
  );
  nameLines.forEach((line, index) => {
    parts.push(
      `<text x="16" y="${42 + index * 16}" font-size="13" font-weight="700" letter-spacing="0.6" fill="${EXPORT_COLORS.foreground}">${escapeXmlText(line)}</text>`
    );
  });
  parts.push(
    `<text x="16" y="${44 + nameLines.length * 16}" font-size="11" fill="${EXPORT_COLORS.mutedForeground}">${roleCount} role${roleCount === 1 ? "" : "s"}</text>`
  );
  parts.push("</g>");
  return parts.join("");
}

/**
 * A card's body fill and same-hue border, from the shared reference palette
 * (exact reference colours). In "family" colour mode a classified position
 * takes its sub-division's palette colour; a department heading, or any card
 * in department mode, takes its department's palette colour. Falls back to a
 * light tint of the raw department colour only when no palette entry exists.
 */
function cardColorsFor(
  node: SvgRenderNode,
  colorMode: ExportColorMode,
  familyColorById: ReadonlyMap<string, FamilyColor> | undefined,
  departmentColorByName: ReadonlyMap<string, FamilyColor> | undefined
): { fill: string; accent: string } {
  if (colorMode === "family" && node.kind !== "department" && node.jobFamilyId) {
    const fc = familyColorById?.get(node.jobFamilyId);
    if (fc) return { fill: fc.fill, accent: fc.accent };
  }
  const dc = departmentColorByName?.get(node.departmentName);
  if (dc) return { fill: dc.fill, accent: dc.accent };
  const accent = resolveDepartmentColor(node.departmentColor);
  return { fill: lightTint(accent), accent };
}

function renderNodeCard(
  node: SvgRenderNode,
  position: SvgLayoutPosition,
  colorMode: ExportColorMode,
  familyColorById: ReadonlyMap<string, FamilyColor> | undefined,
  departmentColorByName: ReadonlyMap<string, FamilyColor> | undefined
): string {
  const { fill: bodyFill, accent: accentColor } = cardColorsFor(
    node,
    colorMode,
    familyColorById,
    departmentColorByName
  );
  const isMatch = node.matchState === "match";
  const isContext = node.matchState === "context";
  // A search match keeps the strong primary ring; otherwise the border is the
  // card's own same-hue accent (no separate left accent bar), matching the
  // reference cards.
  const strokeColor = isMatch ? EXPORT_COLORS.primary : accentColor;
  const strokeWidth = isMatch ? 2 : 1;
  const opacity = isContext ? 0.6 : 1;

  // Mirrors position-node.tsx's compact card exactly: role title, then
  // the person in it (omitted entirely when the role is unfilled), then
  // the grade. The position code and the repeated department name were
  // removed there (Demo 1 feedback) and must be removed here too — this
  // renderer draws its own copy of the card, so the two silently diverge
  // unless changed together.
  const titleLines = wrapText(node.title, 30, 2);
  const isOccupied = node.occupancyStatus === "occupied";
  const occupantName = isOccupied ? (node.occupantDisplayName ?? null) : null;
  const badge = nodeBadge(node);

  const parts: string[] = [];
  parts.push(`<g transform="translate(${position.x}, ${position.y})" opacity="${opacity}">`);
  parts.push(
    `<rect x="0" y="0" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="8" fill="${bodyFill}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />`
  );

  if (badge) {
    parts.push(
      `<text x="${NODE_WIDTH - 14}" y="16" font-size="8" font-weight="600" letter-spacing="0.3" text-anchor="end" fill="${badge.color}">${escapeXmlText(badge.label)}</text>`
    );
  }

  // Row 1 — the role, wrapped to at most two lines. An OCCUPIED card
  // carries a green occupancy dot (colour is never the only signal — the
  // name on row 2 says the same thing); a vacant card shows no dot and no
  // "Vacant" wording, conveying the empty seat by the absent name alone,
  // exactly like position-node.tsx on screen. Title starts flush-left when
  // there is no dot so the text is not indented into empty space.
  const titleX = isOccupied ? 34 : 16;
  if (isOccupied) {
    parts.push(`<circle cx="22" cy="22" r="4" fill="${EXPORT_COLORS.statusFilled}" />`);
  }
  titleLines.forEach((line, index) => {
    parts.push(
      `<text x="${titleX}" y="${26 + index * 15}" font-size="13" font-weight="700" fill="${EXPORT_COLORS.foreground}">${escapeXmlText(line)}</text>`
    );
  });

  // Rows 2 and 3 — the person (omitted when nobody holds the role) and
  // the grade, each positioned BELOW however many title lines were
  // actually drawn, so a two-line title can never be overprinted.
  let y = 30 + titleLines.length * 15;
  if (occupantName) {
    parts.push(
      `<text x="16" y="${y}" font-size="11" fill="${EXPORT_COLORS.foreground}">${escapeXmlText(occupantName)}</text>`
    );
    y += 14;
  }
  // Grade and family share the compact card's last line, mirroring
  // position-node.tsx ("L7 · Software Engineering").
  const gradeFamilyLine = [node.jobGradeCode, node.jobFamilyName].filter(Boolean).join(" · ");
  if (gradeFamilyLine) {
    parts.push(
      `<text x="16" y="${y}" font-size="11" font-weight="600" fill="${EXPORT_COLORS.mutedForeground}">${escapeXmlText(gradeFamilyLine)}</text>`
    );
  }

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
  statusEntries: readonly StatusLegendEntry[],
  y: number,
  colorMode: ExportColorMode,
  families: readonly SvgLegendFamily[]
): { svg: string; height: number } {
  // In family mode the second column keys the family colours; otherwise it
  // keys the departments — matching whichever dimension coloured the cards.
  const showFamilies = colorMode === "family";
  const secondColumnRows = showFamilies ? families.length : departments.length;
  const rows = Math.max(statusEntries.length, secondColumnRows);
  const height = rows * LEGEND_ROW_HEIGHT + 24;

  const parts: string[] = [];
  parts.push(
    `<text x="${PADDING}" y="${y + 14}" font-size="11" font-weight="700" fill="${EXPORT_COLORS.foreground}">Legend</text>`
  );

  statusEntries.forEach((entry, index) => {
    const rowY = y + 32 + index * LEGEND_ROW_HEIGHT;
    parts.push(`<circle cx="${PADDING + 4}" cy="${rowY - 4}" r="4" fill="${entry.color}" />`);
    parts.push(
      `<text x="${PADDING + 14}" y="${rowY}" font-size="10" fill="${EXPORT_COLORS.foreground}">${escapeXmlText(entry.label)}</text>`
    );
  });

  const columnX = PADDING + LEGEND_COLUMN_WIDTH;
  if (showFamilies && families.length > 0) {
    parts.push(
      `<text x="${columnX}" y="${y + 14}" font-size="11" font-weight="700" fill="${EXPORT_COLORS.foreground}">Sub-divisions</text>`
    );
    families.forEach((family, index) => {
      const rowY = y + 32 + index * LEGEND_ROW_HEIGHT;
      parts.push(
        `<circle cx="${columnX + 4}" cy="${rowY - 4}" r="4" fill="${family.color}" stroke="${EXPORT_COLORS.border}" />`
      );
      parts.push(
        `<text x="${columnX + 14}" y="${rowY}" font-size="10" fill="${EXPORT_COLORS.foreground}">${escapeXmlText(family.name)}</text>`
      );
    });
  } else if (!showFamilies && departments.length > 0) {
    parts.push(
      `<text x="${columnX}" y="${y + 14}" font-size="11" font-weight="700" fill="${EXPORT_COLORS.foreground}">Departments</text>`
    );
    departments.forEach((dept, index) => {
      const rowY = y + 32 + index * LEGEND_ROW_HEIGHT;
      parts.push(
        `<circle cx="${columnX + 4}" cy="${rowY - 4}" r="4" fill="${resolveDepartmentColor(dept.color)}" stroke="${EXPORT_COLORS.border}" />`
      );
      parts.push(
        `<text x="${columnX + 14}" y="${rowY}" font-size="10" fill="${EXPORT_COLORS.foreground}">${escapeXmlText(dept.name)}</text>`
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
      `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" font-family="${EXPORT_FONT_FAMILY}">`,
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
  const childCountByParent = new Map<string, number>();
  for (const edge of edges) {
    childCountByParent.set(
      edge.sourcePositionId,
      (childCountByParent.get(edge.sourcePositionId) ?? 0) + 1
    );
  }
  const nodesSvg = nodes
    .map((node) => {
      const pos = positions.get(node.positionId);
      if (!pos) return "";
      const at = { x: pos.x - minX, y: pos.y - minY };
      return node.kind === "department"
        ? renderDepartmentCard(
            node,
            at,
            childCountByParent.get(node.positionId) ?? 0,
            options.departmentColorByName
          )
        : renderNodeCard(
            node,
            at,
            options.colorMode ?? "department",
            options.familyColorById,
            options.departmentColorByName
          );
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
    const legend = renderLegend(
      options.departments,
      statusLegendEntriesFor(nodes),
      cursorY,
      options.colorMode ?? "department",
      options.families ?? []
    );
    legendSvg = legend.svg;
    legendHeight = legend.height;
    cursorY += legendHeight + PADDING;
  }

  const totalHeight = cursorY + FOOTER_HEIGHT + PADDING;

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" font-family="${EXPORT_FONT_FAMILY}">`,
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
