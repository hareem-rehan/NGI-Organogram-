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
  /** Light card-body fill (dark text stays readable on every entry). */
  fill: string;
  /** Stronger same-hue edge/legend swatch colour. */
  accent: string;
}

/** The reference palette, most-distinct first. */
export const FAMILY_COLOR_PALETTE: readonly FamilyColor[] = [
  { fill: "#cbf2b1", accent: "#6fbf3f" }, // green
  { fill: "#b6e5ff", accent: "#3aa4e8" }, // blue
  { fill: "#ffd720", accent: "#d7af00" }, // gold
  { fill: "#ffd5e9", accent: "#ec6fa8" }, // pink
  { fill: "#e7d2fd", accent: "#9b5fe0" }, // lavender
  { fill: "#ffa42f", accent: "#e8811a" }, // orange
  { fill: "#aa57e5", accent: "#8a3fd0" }, // purple
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
 * The exact card colours of the stakeholder's reference chart
 * (visily-multicomponents), keyed by the department colour the Visily config
 * stores (lib/domain/visily-level-mappings.ts). Fills and borders were sampled
 * from the reference PDF, so a department using one of these colours renders
 * exactly like the reference — a computed tint of the stored hex came out
 * visibly paler (HR and Marketing especially).
 *
 * One deliberate deviation: the reference's CEO purple (#9f5bdd) is too dark
 * for the card's dark text (3.3:1, below WCAG AA's 4.5:1), so the Founder
 * swatch keeps the hue but is lightened just enough to pass. Every fill here
 * is asserted ≥ 4.5:1 against the card text in organogram-family-colors.test.ts.
 */
export const VISILY_DEPARTMENT_SWATCHES: ReadonlyMap<string, FamilyColor> = new Map([
  ["#6d28d9", { fill: "#b184e8", accent: "#8a3fd0" }], // Founder / CEO
  ["#4fae2f", { fill: "#d3f1b7", accent: "#95d25f" }], // Engineering
  ["#d9a400", { fill: "#f8d850", accent: "#d1b544" }], // Human Resources
  ["#9b7fe0", { fill: "#e3d3fa", accent: "#be9feb" }], // Finance
  ["#e8811a", { fill: "#f2a84b", accent: "#bc7529" }], // Marketing
  ["#3aa4e8", { fill: "#bfe4fc", accent: "#7bc0f1" }], // Client Delivery Services
  ["#ec6fa8", { fill: "#f8d7e8", accent: "#eaa9c9" }], // Delivery Org / Administration
]);

/**
 * A department's card colour from its OWN stored hex. A Visily reference
 * colour maps to that reference's exact fill/border
 * (`VISILY_DEPARTMENT_SWATCHES`); any other hex is the strong `accent`
 * (border/legend swatch) with a pastel of it as the body `fill`. Falls back
 * to a neutral grey when unset/invalid.
 */
export function departmentColorFromHex(color: string | null | undefined): FamilyColor {
  const accent = color && /^#[0-9a-f]{6}$/i.test(color.trim()) ? color.trim() : NEUTRAL_ACCENT;
  const swatch = VISILY_DEPARTMENT_SWATCHES.get(accent.toLowerCase());
  if (swatch) return swatch;
  return { fill: lightTint(accent, 0.34), accent };
}
