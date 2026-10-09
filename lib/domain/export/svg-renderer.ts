import {
  DEFAULT_TITLE_SIZE,
  fontFamilyById,
  fontScaleOf,
  fontWeightOf,
  isEmptyTextStyle,
  readableTextColor,
  textDecorationOf,
  type TextStyle,
} from "@/lib/domain/organogram-text-style";
import { ORG_EDGE_BUS_OFFSET } from "@/app/(app)/organogram/_lib/elk-layout";
import {
  CARD_METRICS,
  CHEVRON_BOX,
  DEFAULT_CARD_SIZE,
  cardSizeFor,
  equalizeRowHeights,
  gradeFamilyLabel,
  headingNameRowHeight,
  measureTextWidth,
  rolesUnderLabel,
  wrapToWidth,
  type CardSize,
} from "@/lib/domain/organogram-card-size";
import { cardTextColor, lightTint, type FamilyColor } from "@/lib/domain/organogram-family-colors";

import { EXPORT_COLORS, resolveDepartmentColor } from "./colors";
import { escapeXmlText } from "./svg-text";
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
  /** Whole-branch role count for the card footer (docs/DECISIONS.md D29). Optional so callers without it still render (the footer then falls back). */
  totalReportCount?: number;
  displayChildCount?: number;
  directReportCount?: number;
  /**
   * A synthetic grouping heading (department, or sub-division) rather than a
   * real position (lib/domain/organogram-leadership-graph.ts). Absent means
   * "position", so every pre-existing caller keeps its behaviour unchanged.
   */
  kind?: "position" | "department" | "subdivision";
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
  /** Each card's effective text style (D41), keyed by node id. */
  textStyleByNodeId?: ReadonlyMap<string, TextStyle>;
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

/** Where a line's baseline sits inside its line box, as CSS places it. */
function baseline(lineTop: number, lineHeight: number, fontSize: number): number {
  return round1(lineTop + (lineHeight - fontSize) / 2 + 0.8 * fontSize);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The expand chevron the screen card shows (lucide ChevronDown), in a `box`-px square. */
function chevronDown(left: number, centerY: number, box: number, color: string): string {
  const x = left + box * 0.25;
  const half = box * 0.25;
  const drop = box * 0.25;
  const y = centerY - drop / 2;
  return `<polyline points="${round1(x)},${round1(y)} ${round1(x + half)},${round1(y + drop)} ${round1(x + 2 * half)},${round1(y)}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />`;
}

/** Title font size for a card's text style (D41). */
function titleFontSize(style: TextStyle | undefined): number {
  return DEFAULT_TITLE_SIZE * (style ? fontScaleOf(style) : 1);
}

/**
 * The size each card is drawn at (D47): the same content-sized cards as the
 * interactive chart (lib/domain/organogram-card-size.ts), so an export lays
 * out exactly like the screen. Callers lay the chart out with these.
 */
export function exportCardSizes(
  nodes: readonly SvgRenderNode[],
  edges: readonly SvgRenderEdge[],
  textStyleByNodeId?: ReadonlyMap<string, TextStyle>
): Map<string, CardSize> {
  const childCount = childCountsOf(edges, nodes);
  return new Map(
    nodes.map((node) => {
      const children = childCount.get(node.positionId) ?? 0;
      const isHeading = node.kind === "department" || node.kind === "subdivision";
      return [
        node.positionId,
        cardSizeFor(
          {
            kind: node.kind,
            title: node.title,
            departmentName: node.departmentName,
            occupantName: node.occupancyStatus === "occupied" ? node.occupantDisplayName : null,
            roleCount: isHeading ? children : rolesUnderOf(node),
            hasChildren: children > 0,
            jobGradeCode: node.jobGradeCode,
            jobFamilyName: node.jobFamilyName,
            badgeWidth: node.positionStatus !== "ACTIVE" ? STATUS_BADGE_WIDTH : 0,
          },
          textStyleByNodeId?.get(node.positionId)
        ),
      ];
    })
  );
}

/** Same allowance as the screen card for a "Planned" / "Inactive" badge. */
const STATUS_BADGE_WIDTH = 66;

/** Children per card, counting only edges whose both ends are drawn. */
function childCountsOf(
  edges: readonly SvgRenderEdge[],
  nodes: readonly SvgRenderNode[]
): Map<string, number> {
  const drawn = new Set(nodes.map((n) => n.positionId));
  const counts = new Map<string, number>();
  for (const edge of edges) {
    if (!drawn.has(edge.sourcePositionId) || !drawn.has(edge.targetPositionId)) continue;
    counts.set(edge.sourcePositionId, (counts.get(edge.sourcePositionId) ?? 0) + 1);
  }
  return counts;
}

function rolesUnderOf(node: SvgRenderNode): number {
  return node.totalReportCount ?? node.displayChildCount ?? node.directReportCount ?? 0;
}

/**
 * A department heading or sub-division grouping card, mirroring
 * position-node.tsx: filled, an expand chevron when it has cards under it,
 * the name (uppercase for a department) and its role count, centred
 * vertically. No occupancy dot or status badge — a heading is not a seat.
 * This renderer draws its own copy of every card, so the two only stay
 * alike if they are changed together.
 */
function renderHeadingCard(
  node: SvgRenderNode,
  position: SvgLayoutPosition,
  size: CardSize,
  roleCount: number,
  departmentColorByName: ReadonlyMap<string, FamilyColor> | undefined,
  colorMode: ExportColorMode,
  familyColorById: ReadonlyMap<string, FamilyColor> | undefined,
  style: TextStyle | undefined
): string {
  const m = CARD_METRICS;
  const {
    fill: bodyFill,
    accent: accentColor,
    text: textColor,
  } = cardColorsFor(node, colorMode, familyColorById, departmentColorByName);
  const isDepartment = node.kind === "department";
  const f = titleFontSize(style);
  const lineHeight = f * m.titleLeading;
  const rolesSize = f * m.secondaryEm;
  const rolesLineHeight = rolesSize * m.secondaryLeading;
  const left = m.border + m.headingPadX;
  const hasChevron = roleCount > 0;
  const nameX = left + (hasChevron ? m.headingChevron : 0);
  const nameLines = wrapToWidth(
    isDepartment ? node.departmentName.toUpperCase() : node.title,
    size.width - m.border - m.headingPadX - nameX,
    f,
    size.titleLines,
    {
      bold: true,
      uppercase: isDepartment,
      letterSpacingEm: isDepartment ? 0.025 : 0,
      fontFamily: style?.fontFamily,
    }
  );
  const nameRow = headingNameRowHeight(nameLines.length, f, hasChevron);
  const blockHeight = nameRow + 2 + rolesLineHeight;
  const top = (size.height - blockHeight) / 2;
  // Name lines centred in their row, as flex items-center does on screen.
  const nameTop = top + (nameRow - nameLines.length * lineHeight) / 2;

  const parts: string[] = [];
  parts.push(`<g transform="translate(${position.x}, ${position.y})" opacity="1">`);
  parts.push(
    `<rect x="0" y="0" width="${size.width}" height="${size.height}" rx="8" fill="${bodyFill}" stroke="${accentColor}" stroke-width="1.5" />`
  );
  if (hasChevron) {
    parts.push(chevronDown(left, top + nameRow / 2, CHEVRON_BOX, textColor));
  }
  nameLines.forEach((line, index) => {
    parts.push(
      `<text x="${nameX}" y="${baseline(nameTop + index * lineHeight, lineHeight, f)}" font-size="${round1(f)}" font-weight="800"${isDepartment ? ` letter-spacing="${round1(0.025 * f)}"` : ""} fill="${textColor}">${escapeXmlText(line)}</text>`
    );
  });
  parts.push(
    `<text x="${left}" y="${baseline(top + nameRow + 2, rolesLineHeight, rolesSize)}" font-size="${round1(rolesSize)}" font-weight="600" fill="${textColor}">${roleCount} role${roleCount === 1 ? "" : "s"}</text>`
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
): { fill: string; accent: string; text: string } {
  // Sub-division mode colours ONLY sub-divisions (docs/DECISIONS.md D29):
  // department headings and cards outside any sub-division are neutral.
  if (colorMode === "family") {
    const fc =
      node.kind !== "department" && node.jobFamilyId
        ? familyColorById?.get(node.jobFamilyId)
        : undefined;
    return fc
      ? { fill: fc.fill, accent: fc.accent, text: fc.text ?? EXPORT_COLORS.foreground }
      : {
          fill: EXPORT_COLORS.background,
          accent: EXPORT_COLORS.border,
          text: EXPORT_COLORS.foreground,
        };
  }
  const dc = departmentColorByName?.get(node.departmentName);
  if (dc) return { fill: dc.fill, accent: dc.accent, text: dc.text ?? EXPORT_COLORS.foreground };
  const accent = resolveDepartmentColor(node.departmentColor);
  return { fill: lightTint(accent), accent, text: EXPORT_COLORS.foreground };
}

function renderNodeCard(
  node: SvgRenderNode,
  position: SvgLayoutPosition,
  size: CardSize,
  hasChildren: boolean,
  colorMode: ExportColorMode,
  familyColorById: ReadonlyMap<string, FamilyColor> | undefined,
  departmentColorByName: ReadonlyMap<string, FamilyColor> | undefined,
  style: TextStyle | undefined
): string {
  const m = CARD_METRICS;
  const {
    fill: bodyFill,
    accent: accentColor,
    text: textColor,
  } = cardColorsFor(node, colorMode, familyColorById, departmentColorByName);
  const isMatch = node.matchState === "match";
  const isContext = node.matchState === "context";
  // A search match keeps the strong primary ring; otherwise the border is the
  // card's own same-hue accent, matching the reference cards.
  const strokeColor = isMatch ? EXPORT_COLORS.primary : accentColor;
  const strokeWidth = isMatch ? 2 : 1;
  const opacity = isContext ? 0.6 : 1;

  // Mirrors position-node.tsx's compact card (D47): the role, the person in
  // it (omitted when unfilled), then a footer with the roles under it and
  // the level. Same sizes and spacing as on screen.
  const family = style?.fontFamily;
  const f = titleFontSize(style);
  const left = m.border + m.padX;
  const right = size.width - m.border - m.padX;
  const badge = nodeBadge(node);
  const badgeWidth = badge ? measureTextWidth(badge.label, 8, { bold: true }) + 8 : 0;

  const parts: string[] = [];
  parts.push(`<g transform="translate(${position.x}, ${position.y})" opacity="${opacity}">`);
  parts.push(
    `<rect x="0" y="0" width="${size.width}" height="${size.height}" rx="8" fill="${bodyFill}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />`
  );

  const top = m.border + m.padTop;
  const lineHeight = f * m.titleLeading;
  if (badge) {
    parts.push(
      `<text x="${right}" y="${baseline(top, lineHeight, 8)}" font-size="8" font-weight="600" letter-spacing="0.3" text-anchor="end" fill="${badge.color}">${escapeXmlText(badge.label)}</text>`
    );
  }
  const titleLines = wrapToWidth(node.title, right - left - badgeWidth, f, size.titleLines, {
    bold: true,
    fontFamily: family,
  });
  titleLines.forEach((line, index) => {
    parts.push(
      `<text x="${left}" y="${baseline(top + index * lineHeight, lineHeight, f)}" font-size="${round1(f)}" font-weight="800" fill="${textColor}">${escapeXmlText(line)}</text>`
    );
  });

  const occupantName =
    node.occupancyStatus === "occupied" ? (node.occupantDisplayName ?? null) : null;
  if (occupantName) {
    const occupantSize = f * m.secondaryEm;
    const occupantLineHeight = occupantSize * m.secondaryLeading;
    const occupantTop = top + titleLines.length * lineHeight + 1;
    const line = wrapToWidth(occupantName, right - left, occupantSize, 1, {
      bold: true,
      fontFamily: family,
    })[0];
    parts.push(
      `<text x="${left}" y="${baseline(occupantTop, occupantLineHeight, occupantSize)}" font-size="${round1(occupantSize)}" font-weight="700" fill="${textColor}">${escapeXmlText(line ?? "")}</text>`
    );
  }

  // Footer: roles under it on the left, the level (and sub-division) on the
  // right, under a thin divider — pinned to the card's bottom edge.
  const footerSize = f * m.footerEm;
  const footerLineHeight = Math.max(14, footerSize * m.footerLeading);
  const footerTop = size.height - m.border - m.footerPadBottom - footerLineHeight;
  const dividerY = round1(footerTop - m.footerPadTop - 0.5);
  const footerY = baseline(footerTop, footerLineHeight, footerSize);
  const rolesUnder = rolesUnderOf(node);
  const rolesX = left + (hasChildren ? m.footerChevron : 0);
  parts.push(
    `<line x1="${left}" y1="${dividerY}" x2="${right}" y2="${dividerY}" stroke="${textColor}" stroke-opacity="0.25" stroke-width="1" />`
  );
  if (hasChildren) {
    parts.push(chevronDown(left, footerTop + footerLineHeight / 2, 14, textColor));
  }
  parts.push(
    `<text x="${rolesX}" y="${footerY}" font-size="${round1(footerSize)}" font-weight="600" fill="${textColor}">${
      rolesUnder > 0
        ? `<tspan font-weight="800">${rolesUnder}</tspan> ${rolesUnder === 1 ? "role" : "roles"} under`
        : "No roles under"
    }</text>`
  );
  const gradeFamilyLine = gradeFamilyLabel(node.jobGradeCode, node.jobFamilyName);
  if (gradeFamilyLine) {
    const rolesWidth = measureTextWidth(rolesUnderLabel(rolesUnder), footerSize, {
      bold: true,
      fontFamily: family,
    });
    const room = right - rolesX - rolesWidth - 10;
    const footerFont = { bold: true, fontFamily: family };
    // The level code always shows in full (D53); only the sub-division name
    // is shortened, and dropped when there's no room for it at all.
    let line = gradeFamilyLine;
    if (measureTextWidth(gradeFamilyLine, footerSize, footerFont) > room) {
      const code = node.jobGradeCode ?? "";
      const prefix = code ? `${code} · ` : "";
      const familyRoom = room - measureTextWidth(prefix, footerSize, footerFont);
      const familyPart =
        node.jobFamilyName && familyRoom >= 2.5 * footerSize
          ? wrapToWidth(node.jobFamilyName, familyRoom, footerSize, 1, footerFont)[0]
          : null;
      line = familyPart ? `${prefix}${familyPart}` : code || (familyPart ?? "");
      if (!line && node.jobFamilyName) {
        line = wrapToWidth(node.jobFamilyName, room, footerSize, 1, footerFont)[0] ?? "";
      }
    }
    parts.push(
      `<text x="${right}" y="${footerY}" font-size="${round1(footerSize)}" font-weight="700" text-anchor="end" fill="${textColor}">${escapeXmlText(line ?? "")}</text>`
    );
  }

  parts.push("</g>");
  return parts.join("");
}

/**
 * Applies a card's text style (D41) to its exported SVG: the closest PDF
 * base font, weight, colour, italic and underline/strikethrough. The SIZE is
 * not applied here: the card renderers lay their text out for it (D45), so
 * larger text wraps and spaces itself instead of overprinting.
 */
export function applyTextStyleToCardSvg(cardSvg: string, style: TextStyle | undefined): string {
  if (!style || isEmptyTextStyle(style)) return cardSvg;
  let out = cardSvg.replace(/font-weight="(\d+)"/g, (_m, weight: string) => {
    return `font-weight="${fontWeightOf(style, Number(weight))}"`;
  });
  if (style.color) {
    // Kept only where readable on this card's own fill (its first <rect>).
    const fill = /<rect\b[^>]*? fill="(#[0-9a-fA-F]{6})"/.exec(out)?.[1] ?? "#ffffff";
    const color = readableTextColor(style.color, fill, cardTextColor(fill));
    out = out.replace(/(<text\b[^>]*?) fill="[^"]*"/g, `$1 fill="${color}"`);
  }
  const groupAttrs = [
    `font-family="${fontFamilyById(style.fontFamily)?.exportFamily ?? EXPORT_FONT_FAMILY}"`,
    style.italic ? `font-style="italic"` : "",
    textDecorationOf(style) ? `text-decoration="${textDecorationOf(style)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return out.replace(/^<g /, `<g ${groupAttrs} `);
}

function renderEdgePath(
  source: SvgLayoutPosition,
  sourceSize: CardSize,
  target: SvgLayoutPosition,
  targetSize: CardSize
): string {
  const sx = round1(source.x + sourceSize.width / 2);
  const sy = source.y + sourceSize.height;
  const tx = round1(target.x + targetSize.width / 2);
  const ty = target.y;
  // The same connector as on screen (org-chart-edge.tsx): one bar halfway
  // down the gap above the target row, so siblings' lines coincide exactly.
  const busY = ty - ORG_EDGE_BUS_OFFSET > sy ? ty - ORG_EDGE_BUS_OFFSET : (sy + ty) / 2;
  const d = `M ${sx} ${sy} L ${sx} ${busY} L ${tx} ${busY} L ${tx} ${ty}`;
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

  // Content-sized cards (D47); a row shares its tallest card's height.
  const sizes = equalizeRowHeights(
    positions,
    exportCardSizes(nodes, edges, options.textStyleByNodeId)
  );
  const sizeOf = (id: string) => sizes.get(id) ?? DEFAULT_CARD_SIZE;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const pos = positions.get(node.positionId);
    if (!pos) continue;
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + sizeOf(node.positionId).width);
    maxY = Math.max(maxY, pos.y + sizeOf(node.positionId).height);
  }
  const graphWidth = maxX - minX;
  const graphHeight = maxY - minY;

  const graphOffsetX = PADDING;
  const graphOffsetY = headerHeight;

  const nodesById = new Map(nodes.map((n) => [n.positionId, n]));
  const childCountByParent = childCountsOf(edges, nodes);
  const nodesSvg = nodes
    .map((node) => {
      const pos = positions.get(node.positionId);
      if (!pos) return "";
      const at = { x: pos.x - minX, y: pos.y - minY };
      return applyTextStyleToCardSvg(
        renderCard(node, at),
        options.textStyleByNodeId?.get(node.positionId)
      );
    })
    .join("");

  function renderCard(node: SvgRenderNode, at: SvgLayoutPosition): string {
    const style = options.textStyleByNodeId?.get(node.positionId);
    const size = sizeOf(node.positionId);
    const children = childCountByParent.get(node.positionId) ?? 0;
    if (node.kind === "department" || node.kind === "subdivision") {
      return renderHeadingCard(
        node,
        at,
        size,
        children,
        options.departmentColorByName,
        options.colorMode ?? "department",
        options.familyColorById,
        style
      );
    }
    return renderNodeCard(
      node,
      at,
      size,
      children > 0,
      options.colorMode ?? "department",
      options.familyColorById,
      options.departmentColorByName,
      style
    );
  }

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
        sizeOf(edge.sourcePositionId),
        { x: targetPos.x - minX, y: targetPos.y - minY },
        sizeOf(edge.targetPositionId)
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
