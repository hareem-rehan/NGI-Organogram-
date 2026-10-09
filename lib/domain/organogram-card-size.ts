/**
 * Content-sized organogram cards (docs/DECISIONS.md D47, D49). Every card has
 * the same width (about 24 characters of title per line) and is just tall
 * enough for what it shows: a long title wraps onto more lines (up to three)
 * and the card grows taller instead of wider. Cards on the same row share
 * the row's tallest height so the chart stays aligned.
 *
 * One pure function sizes a card for the screen AND the PDF/PNG export, so
 * both draw the same chart. Text width is estimated from Helvetica/Arial
 * character widths (no DOM), scaled per font family; the on-screen card also
 * truncates a line with "…" rather than wrapping, so a slightly-off estimate
 * can never push text out of its card.
 */
import {
  DEFAULT_TITLE_SIZE,
  fontScaleOf,
  type TextStyle,
} from "@/lib/domain/organogram-text-style";

/** Every card's width (D49, D53): about 21 characters of title per line. */
export const CARD_WIDTH = 168;
/** @deprecated Since D49 every card is CARD_WIDTH wide. */
export const CARD_MIN_WIDTH = CARD_WIDTH;
/** A title longer than this many lines ends in "…". */
export const MAX_TITLE_LINES = 3;
/** Slack kept on each line for font differences between estimate and screen. */
const WRAP_SLACK = 4;

/** Vertical rhythm, in px at the built-in size. Shared by screen and export. */
export const CARD_METRICS = {
  border: 1,
  /** Inner horizontal padding of a position card. */
  padX: 8,
  /** Inner horizontal padding of a department / sub-division card. */
  headingPadX: 10,
  padTop: 5,
  headingPadY: 7,
  /** Title line height, em. */
  titleLeading: 1.2,
  /** Occupant / roles text size relative to the title, and its line height. */
  secondaryEm: 0.923,
  secondaryLeading: 1.3,
  /** Footer text size relative to the title, and its line height. */
  footerEm: 0.846,
  footerLeading: 1.4,
  /** Space between the content and the footer divider. */
  footerGap: 4,
  footerPadTop: 3,
  footerPadBottom: 4,
  /** Chevron + gap before a heading name / footer count. */
  headingChevron: 22,
  footerChevron: 16,
} as const;

// Helvetica (≈ Arial) advance widths per 1000 em for printable ASCII 32–126.
// prettier-ignore
const REGULAR = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
// prettier-ignore
const BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

/** How much wider each font family runs than Helvetica. */
const FAMILY_WIDTH: Record<string, number> = {
  arial: 1,
  helvetica: 1,
  verdana: 1.18,
  tahoma: 1.02,
  trebuchet: 1,
  georgia: 1.08,
  times: 0.92,
  garamond: 0.9,
};
/** The app's default sans (system UI font) runs a little wider than Helvetica. */
const DEFAULT_FAMILY_WIDTH = 1.06;

export interface MeasureOptions {
  bold?: boolean;
  uppercase?: boolean;
  /** Extra space after every character, in em. */
  letterSpacingEm?: number;
  fontFamily?: string | null;
}

/** Estimated rendered width, in px, of `text` at `fontSize` px. */
export function measureTextWidth(
  text: string,
  fontSize: number,
  options: MeasureOptions = {}
): number {
  const value = options.uppercase ? text.toUpperCase() : text;
  if (options.fontFamily === "courier") {
    return value.length * fontSize * (0.6 + (options.letterSpacingEm ?? 0));
  }
  const table = options.bold ? BOLD : REGULAR;
  let units = 0;
  for (const char of value) {
    const code = char.codePointAt(0)!;
    units += code >= 32 && code <= 126 ? table[code - 32]! : options.bold ? 640 : 600;
  }
  const family = options.fontFamily
    ? (FAMILY_WIDTH[options.fontFamily] ?? DEFAULT_FAMILY_WIDTH)
    : DEFAULT_FAMILY_WIDTH;
  return (
    (units / 1000) * fontSize * family + value.length * fontSize * (options.letterSpacingEm ?? 0)
  );
}

/**
 * Greedy word wrap to `maxWidth` px, at most `maxLines` lines; the last line
 * ends in "…" when text remains. A single word wider than the line is cut.
 */
export function wrapToWidth(
  text: string,
  maxWidth: number,
  fontSize: number,
  maxLines: number,
  options: MeasureOptions = {}
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || maxLines <= 0) return [];
  const fits = (s: string) => measureTextWidth(s, fontSize, options) <= maxWidth;
  const lines: string[] = [];
  let current = "";
  let index = 0;
  while (index < words.length && lines.length < maxLines) {
    const word = words[index]!;
    const candidate = current ? `${current} ${word}` : word;
    if (fits(candidate)) {
      current = candidate;
      index++;
    } else if (!current) {
      lines.push(word); // a word too wide on its own: shortened below
      index++;
    } else {
      lines.push(current);
      current = "";
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
    current = "";
  }
  const truncated = index < words.length || current !== "";
  const last = lines.length - 1;
  if (truncated || !fits(lines[last]!)) {
    lines[last] = ellipsize(lines[last]!, maxWidth, fontSize, options);
  }
  return lines;
}

function ellipsize(line: string, maxWidth: number, fontSize: number, options: MeasureOptions) {
  let cut = line;
  while (cut.length > 1 && measureTextWidth(`${cut}…`, fontSize, options) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}…`;
}

/** What sizing needs to know about a card. */
export interface CardSizeInput {
  kind?: "position" | "department" | "subdivision";
  title: string;
  departmentName: string;
  /** The person in the role, when it is filled. */
  occupantName?: string | null;
  /** "N roles under" on a position card; "N roles" on a heading. */
  roleCount: number;
  /** Whether the card shows an expand/collapse chevron. */
  hasChildren?: boolean;
  jobGradeCode?: string | null;
  jobFamilyName?: string | null;
  /** Extra width for a status / search badge beside the title, px. */
  badgeWidth?: number;
}

export interface CardSize {
  width: number;
  height: number;
  /** How many lines the title (or heading name) takes: 1 or 2. */
  titleLines: number;
}

/** The footer's left text: "N roles under" / "No roles under". */
export function rolesUnderLabel(count: number): string {
  if (count <= 0) return "No roles under";
  return `${count} ${count === 1 ? "role" : "roles"} under`;
}

/** The footer's right text: "L7 · Software Engineering". */
export function gradeFamilyLabel(
  jobGradeCode: string | null | undefined,
  jobFamilyName: string | null | undefined
): string {
  return [jobGradeCode, jobFamilyName].filter(Boolean).join(" · ");
}

/** The natural size of one card for its content and text style. */
export function cardSizeFor(card: CardSizeInput, style?: TextStyle): CardSize {
  const m = CARD_METRICS;
  const f = DEFAULT_TITLE_SIZE * (style ? fontScaleOf(style) : 1);
  const family = style?.fontFamily ?? null;
  const titleFont: MeasureOptions = { bold: true, fontFamily: family };

  if (card.kind === "department" || card.kind === "subdivision") {
    const isDepartment = card.kind === "department";
    const name = isDepartment ? card.departmentName : card.title;
    const nameFont: MeasureOptions = {
      ...titleFont,
      uppercase: isDepartment,
      letterSpacingEm: isDepartment ? 0.025 : 0,
    };
    const chrome = 2 * m.border + 2 * m.headingPadX + (card.hasChildren ? m.headingChevron : 0);
    const width = widthFor(name, chrome, f, nameFont);
    const titleLines = linesFor(name, width - chrome - WRAP_SLACK, f, nameFont);
    const height =
      2 * m.border +
      2 * m.headingPadY +
      headingNameRowHeight(titleLines, f, card.hasChildren ?? false) +
      2 +
      f * m.secondaryEm * m.secondaryLeading;
    return { width, height: Math.ceil(height), titleLines };
  }

  const chrome = 2 * m.border + 2 * m.padX;
  const footerFont = f * m.footerEm;
  const width = widthFor(card.title, chrome + (card.badgeWidth ?? 0), f, titleFont);
  const titleLines = linesFor(
    card.title,
    width - chrome - (card.badgeWidth ?? 0) - WRAP_SLACK,
    f,
    titleFont
  );
  const height =
    2 * m.border +
    m.padTop +
    Math.max(card.badgeWidth ? BADGE_HEIGHT : 0, titleLines * f * m.titleLeading) +
    (card.occupantName ? 1 + f * m.secondaryEm * m.secondaryLeading : 0) +
    m.footerGap +
    1 +
    m.footerPadTop +
    Math.max(14, footerFont * m.footerLeading) +
    m.footerPadBottom;
  return { width, height: Math.ceil(height), titleLines };
}

/** The name row of a heading card: its lines, or the chevron beside them if taller. */
export function headingNameRowHeight(lines: number, fontSize: number, hasChevron: boolean): number {
  return Math.max(hasChevron ? CHEVRON_BOX : 0, lines * fontSize * CARD_METRICS.titleLeading);
}

/** Height of the compact status badge beside a title, px. */
const BADGE_HEIGHT = 16;

/** The heading chevron's square box, px (size-4 on screen). */
export const CHEVRON_BOX = 16;

/**
 * The card's width: always CARD_WIDTH, unless a single WORD of the title is
 * too wide to fit on a line of its own (e.g. "ADMINISTRATION" at a large text
 * size) — then just wide enough for that word, so text is never clipped.
 */
function widthFor(text: string, chrome: number, fontSize: number, font: MeasureOptions): number {
  const longestWord = Math.max(
    0,
    ...text
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => measureTextWidth(word, fontSize, font))
  );
  return Math.max(CARD_WIDTH, Math.ceil(longestWord + chrome + WRAP_SLACK));
}

/** How many lines (1 to MAX_TITLE_LINES) a title wraps onto at this width. */
function linesFor(text: string, width: number, fontSize: number, font: MeasureOptions): number {
  return Math.max(1, wrapToWidth(text, width, fontSize, MAX_TITLE_LINES, font).length);
}

/**
 * Gives every card on the same row (same top y) that row's tallest height,
 * so a row of cards lines up top and bottom. Widths are kept.
 */
export function equalizeRowHeights(
  positions: ReadonlyMap<string, { x: number; y: number }>,
  sizes: ReadonlyMap<string, CardSize>
): Map<string, CardSize> {
  const rowHeight = new Map<number, number>();
  const rowOf = (id: string) => Math.round(positions.get(id)?.y ?? Number.NaN);
  for (const [id, size] of sizes) {
    const row = rowOf(id);
    if (Number.isNaN(row)) continue;
    rowHeight.set(row, Math.max(rowHeight.get(row) ?? 0, size.height));
  }
  const out = new Map<string, CardSize>();
  for (const [id, size] of sizes) {
    const row = rowOf(id);
    out.set(id, Number.isNaN(row) ? size : { ...size, height: rowHeight.get(row) ?? size.height });
  }
  return out;
}

/** Size lookup with a safe standard-card fallback. */
export function sizeLookup(
  sizes: ReadonlyMap<string, CardSize>
): (id: string) => { width: number; height: number } {
  return (id) => sizes.get(id) ?? DEFAULT_CARD_SIZE;
}

export const DEFAULT_CARD_SIZE: CardSize = { width: CARD_MIN_WIDTH, height: 56, titleLines: 1 };
