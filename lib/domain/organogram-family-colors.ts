/**
 * Job-family colour palette for the organogram's "Colour by: Sub-division"
 * mode.
 *
 * The hues are taken directly from the stakeholder's reference org chart
 * (docs reference: visily-multicomponents) so a family-coloured chart reads
 * the same as that reference: a light `fill` for the card body and a
 * stronger, same-hue `accent` for its left edge. Sub-divisions carry no
 * colour of their own in the data model, so colours are assigned
 * deterministically by the family's position in a stable, caller-supplied
 * order (see `buildFamilyColorMap`) — the same family always lands on the
 * same colour for a given set of families, and the palette cycles if there
 * are more families than entries.
 *
 * Career classification only — colouring a card by family never implies
 * anything about the reporting tree (docs/DECISIONS.md).
 */
export interface FamilyColor {
  /** Card-body fill. */
  fill: string;
  /** Same-hue edge/legend swatch colour. */
  accent: string;
  /**
   * Text colour for this fill when it isn't the default dark text: white on
   * a dark fill (an exact department colour can be any shade).
   */
  text?: string;
}

/** The reference palette, most-distinct first. */
export const FAMILY_COLOR_PALETTE: readonly FamilyColor[] = [
  { fill: "#cbf2b1", accent: "#6fbf3f" }, // green
  { fill: "#b6e5ff", accent: "#3aa4e8" }, // blue
  { fill: "#ffd720", accent: "#d7af00" }, // gold
  { fill: "#ffd5e9", accent: "#ec6fa8" }, // pink
  { fill: "#e7d2fd", accent: "#9b5fe0" }, // lavender
  { fill: "#ffa42f", accent: "#e8811a" }, // orange
  // The reference's deep purple (#aa57e5) left dark card text at 3.4:1 —
  // below WCAG AA — so the fill is lifted to the lightest shade that still
  // reads as the same vivid purple.
  { fill: "#c08cf0", accent: "#8a3fd0" }, // purple
];

/**
 * Assigns a palette colour to each family id, in the given order, cycling
 * the palette when there are more families than colours. Order is the
 * caller's responsibility (e.g. family name) so the mapping is stable and
 * reproducible across the interactive chart and any export.
 */
export function buildFamilyColorMap(familyIdsInOrder: readonly string[]): Map<string, FamilyColor> {
  const map = new Map<string, FamilyColor>();
  familyIdsInOrder.forEach((id, i) => {
    map.set(id, FAMILY_COLOR_PALETTE[i % FAMILY_COLOR_PALETTE.length]!);
  });
  return map;
}

/**
 * A light, readable pastel fill derived from a base colour — the card body
 * tint that makes a card read as "fully coloured" (like the reference org
 * chart) while keeping dark text legible. `weight` is how much of the base
 * colour to keep (the rest is blended toward white); the default is a light
 * pastel. Computed explicitly (not via CSS `color-mix`) so the same value
 * works in the browser AND in the SVG/PNG/PDF export renderers, which do
 * not support `color-mix`. A colour it cannot parse is returned unchanged.
 */
export function lightTint(hex: string, weight = 0.22): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const int = parseInt(m[1]!, 16);
  const r = (int >> 16) & 0xff;
  const g = (int >> 8) & 0xff;
  const b = int & 0xff;
  const mix = (c: number) => Math.round(c * weight + 255 * (1 - weight));
  const to2 = (c: number) => c.toString(16).padStart(2, "0");
  return `#${to2(mix(r))}${to2(mix(g))}${to2(mix(b))}`;
}

/** Neutral card colour for a department with no colour set. */
const NEUTRAL_ACCENT = "#94a3b8";

/**
 * A department's card colour from its OWN stored hex: the card is filled
 * with EXACTLY that colour (user request, 2026-10-02 — it used to be a
 * lighter version, so a deep blue showed as pale periwinkle), with text in
 * whichever of white or the dark card text reads better on it. Falls back to
 * a neutral grey card when unset/invalid.
 */
export function departmentColorFromHex(color: string | null | undefined): FamilyColor {
  const valid = color && /^#[0-9a-f]{6}$/i.test(color.trim());
  if (!valid) return { fill: vividFill(NEUTRAL_ACCENT), accent: NEUTRAL_ACCENT };
  const exact = color.trim().toLowerCase();
  return { fill: exact, accent: exact, text: cardTextColor(exact) };
}

/**
 * White or the dark card text — whichever contrasts more with `fill`, so a
 * card stays readable on any department colour.
 */
export function cardTextColor(fill: string): string {
  return contrastRatio(fill, "#ffffff") > contrastRatio(fill, CARD_TEXT_COLOR)
    ? "#ffffff"
    : CARD_TEXT_COLOR;
}

/** The card text colour (app/globals.css --color-foreground). */
export const CARD_TEXT_COLOR = "#2d2d2d";

function relativeLuminance(hex: string): number {
  const int = parseInt(hex.replace("#", ""), 16);
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((int >> 16) & 0xff) +
    0.7152 * channel((int >> 8) & 0xff) +
    0.0722 * channel(int & 0xff)
  );
}

/** WCAG 2.x contrast ratio between two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/**
 * A vivid card fill for any department colour that isn't one of the
 * reference swatches: half-strength (much livelier than the old 34% tint),
 * lightened only as far as needed to keep the card text at WCAG AA
 * (>= 4.5:1). A very dark colour therefore still yields a readable fill.
 */
export function vividFill(accent: string): string {
  for (let weight = 0.5; weight > 0; weight -= 0.05) {
    const fill = lightTint(accent, weight);
    if (contrastRatio(fill, CARD_TEXT_COLOR) >= 4.5) return fill;
  }
  return lightTint(accent, 0.1);
}

/** Mixes `hex` toward black (t < 0) or white (t > 0) by |t| (0–1). */
export function shadeOf(hex: string, t: number): string {
  if (t === 0) return hex.toLowerCase();
  if (t > 0) return lightTint(hex, 1 - t);
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const int = parseInt(m[1]!, 16);
  const darken = (c: number) => Math.round(c * (1 + t));
  const to2 = (c: number) => c.toString(16).padStart(2, "0");
  return `#${to2(darken((int >> 16) & 0xff))}${to2(darken((int >> 8) & 0xff))}${to2(darken(int & 0xff))}`;
}

/**
 * Sub-division colours for "Colour by: Sub-division" (user request,
 * 2026-10-02): each sub-division takes a SHADE of its own department's
 * colour, from deeper to lighter in the order given, so sub-divisions stay in
 * their department's colour family but can still be told apart. A department
 * with one sub-division uses its exact colour. Text is whichever of white or
 * dark reads better on each shade. Sub-divisions whose department has no
 * colour fall back to the fixed palette.
 */
export function buildSubdivisionShadeMap(
  families: readonly { id: string; departmentColor: string | null | undefined }[]
): Map<string, FamilyColor> {
  const byDepartment = new Map<string, string[]>();
  const uncoloured: string[] = [];
  for (const f of families) {
    const hex = f.departmentColor?.trim().toLowerCase();
    if (hex && /^#[0-9a-f]{6}$/.test(hex)) {
      byDepartment.set(hex, [...(byDepartment.get(hex) ?? []), f.id]);
    } else {
      uncoloured.push(f.id);
    }
  }
  const map = buildFamilyColorMap(uncoloured);
  for (const [hex, ids] of byDepartment) {
    ids.forEach((id, i) => {
      const t = ids.length === 1 ? 0 : -0.3 + (0.75 * i) / (ids.length - 1);
      const shade = shadeOf(hex, Math.round(t * 100) / 100);
      map.set(id, { fill: shade, accent: shade, text: cardTextColor(shade) });
    });
  }
  return map;
}

/**
 * The colour a chart card is painted in the active colour mode (shared by the
 * chart and the text-style panel, so both agree). "Sub-division" mode (D29):
 * only sub-divisions carry colour — department headings and cards outside
 * any sub-division are neutral (null). "Department" mode: every card,
 * including a sub-division box, takes its department's colour.
 */
export function chartCardColor(
  node: { kind?: string; departmentId: string; jobFamilyId: string | null },
  colorMode: "department" | "family",
  departmentColorById: ReadonlyMap<string, FamilyColor>,
  familyColorById: ReadonlyMap<string, FamilyColor>
): FamilyColor | null {
  if (colorMode === "family") {
    if (node.kind === "department") return null;
    return node.jobFamilyId ? (familyColorById.get(node.jobFamilyId) ?? null) : null;
  }
  return departmentColorById.get(node.departmentId) ?? null;
}
