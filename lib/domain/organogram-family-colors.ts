/**
 * Job-family colour palette for the organogram's "Colour by: Job family"
 * mode.
 *
 * The hues are taken directly from the stakeholder's reference org chart
 * (docs reference: visily-multicomponents) so a family-coloured chart reads
 * the same as that reference: a light `fill` for the card body and a
 * stronger, same-hue `accent` for its left edge. Job families carry no
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
