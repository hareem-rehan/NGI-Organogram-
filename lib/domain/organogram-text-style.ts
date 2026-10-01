/**
 * Organogram text styles (docs/DECISIONS.md D41): one style for every card
 * ("chart"), and optional per-card overrides. Each field is optional — unset
 * means "inherit": card → chart → the built-in card look. Pure: no DB, no React.
 */

export interface TextStyle {
  fontFamily?: string | null;
  /** Title size in px; the other lines scale with it. */
  fontSize?: number | null;
  /** #rrggbb */
  color?: string | null;
  bold?: boolean | null;
  italic?: boolean | null;
  underline?: boolean | null;
  strikethrough?: boolean | null;
}

/** The node key of the style that applies to every card. */
export const CHART_STYLE_KEY = "chart";

/** The built-in title size the other card lines are designed around. */
export const DEFAULT_TITLE_SIZE = 13;
export const MIN_FONT_SIZE = 9;
export const MAX_FONT_SIZE = 20;

export interface FontFamilyOption {
  id: string;
  label: string;
  /** CSS font-family stack for the screen. */
  css: string;
  /**
   * The PDF base-14 family exports use — the only fonts the PDF renderer can
   * draw without embedding a font file, so other families map to the nearest.
   */
  exportFamily: "Helvetica" | "Times" | "Courier";
}

export const FONT_FAMILIES: readonly FontFamilyOption[] = [
  { id: "arial", label: "Arial", css: "Arial, Helvetica, sans-serif", exportFamily: "Helvetica" },
  {
    id: "helvetica",
    label: "Helvetica",
    css: "Helvetica, Arial, sans-serif",
    exportFamily: "Helvetica",
  },
  {
    id: "verdana",
    label: "Verdana",
    css: "Verdana, Geneva, sans-serif",
    exportFamily: "Helvetica",
  },
  { id: "tahoma", label: "Tahoma", css: "Tahoma, Verdana, sans-serif", exportFamily: "Helvetica" },
  {
    id: "trebuchet",
    label: "Trebuchet MS",
    css: '"Trebuchet MS", Helvetica, sans-serif',
    exportFamily: "Helvetica",
  },
  { id: "georgia", label: "Georgia", css: "Georgia, serif", exportFamily: "Times" },
  {
    id: "times",
    label: "Times New Roman",
    css: '"Times New Roman", Times, serif',
    exportFamily: "Times",
  },
  {
    id: "garamond",
    label: "Garamond",
    css: 'Garamond, "Times New Roman", serif',
    exportFamily: "Times",
  },
  {
    id: "courier",
    label: "Courier New",
    css: '"Courier New", Courier, monospace',
    exportFamily: "Courier",
  },
];

export const FONT_FAMILY_IDS = FONT_FAMILIES.map((f) => f.id) as [string, ...string[]];

export function fontFamilyById(id: string | null | undefined): FontFamilyOption | undefined {
  return id ? FONT_FAMILIES.find((f) => f.id === id) : undefined;
}

const FIELDS = [
  "fontFamily",
  "fontSize",
  "color",
  "bold",
  "italic",
  "underline",
  "strikethrough",
] as const;

/** Drops unset fields, so `{}` means "nothing customised". */
export function compactTextStyle(style: TextStyle | null | undefined): TextStyle {
  const out: Record<string, unknown> = {};
  for (const field of FIELDS) {
    const value = style?.[field];
    if (value !== null && value !== undefined) out[field] = value;
  }
  return out as TextStyle;
}

export function isEmptyTextStyle(style: TextStyle | null | undefined): boolean {
  return Object.keys(compactTextStyle(style)).length === 0;
}

/** A card's effective style: its own settings win over the chart's. */
export function effectiveTextStyle(
  chart: TextStyle | null | undefined,
  card: TextStyle | null | undefined
): TextStyle {
  return { ...compactTextStyle(chart), ...compactTextStyle(card) };
}

/** How many times the built-in sizes the card's text should be. */
export function fontScaleOf(style: TextStyle): number {
  const size = style.fontSize ?? DEFAULT_TITLE_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size)) / DEFAULT_TITLE_SIZE;
}

/** The CSS text-decoration-line for a style, or undefined for none. */
export function textDecorationOf(style: TextStyle): string | undefined {
  const lines = [style.underline && "underline", style.strikethrough && "line-through"].filter(
    Boolean
  );
  return lines.length > 0 ? lines.join(" ") : undefined;
}

/**
 * Weight for a line of card text: bold on → everything bold, bold off →
 * everything regular, unset → the line's own built-in weight.
 */
export function fontWeightOf(style: TextStyle, builtIn: number): number {
  if (style.bold === true) return Math.max(builtIn, 700);
  if (style.bold === false) return 400;
  return builtIn;
}
