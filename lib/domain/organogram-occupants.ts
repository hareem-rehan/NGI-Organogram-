/**
 * How a card names the people holding a position (docs/DECISIONS.md D56).
 * A position may hold several employees. Up to three are named, one per
 * line; with more, the card names the first two and adds a "+N more" line,
 * so a card never grows past three name lines. The details panel lists
 * everyone.
 */
export const MAX_CARD_OCCUPANT_LINES = 3;

export function occupantCardLines(names: readonly string[]): string[] {
  if (names.length <= MAX_CARD_OCCUPANT_LINES) return [...names];
  const shown = names.slice(0, MAX_CARD_OCCUPANT_LINES - 1);
  return [...shown, `+${names.length - shown.length} more`];
}

/**
 * What a card on screen shows (client request, 2026-10-19): one name; with
 * several people, the first name plus a "+N Show Names" toggle (N = the
 * people not shown). Opened, every name plus "Hide Names" — the card grows to
 * fit and the chart re-lays out around it. Exports keep the compact `occupantCardLines` form.
 */
export function occupantCardView(
  names: readonly string[],
  expanded: boolean
): { names: string[]; toggle: string | null } {
  if (names.length <= 1) return { names: [...names], toggle: null };
  if (expanded) return { names: [...names], toggle: "Hide Names" };
  return { names: names.slice(0, 1), toggle: `+${names.length - 1} Show Names` };
}

/** Every holder's name for a node: the full list when known, else the single name. */
export function occupantNamesOf(node: {
  occupancyStatus: string;
  occupantDisplayName: string | null;
  occupantDisplayNames?: readonly string[];
}): string[] {
  if (node.occupancyStatus !== "occupied") return [];
  if (node.occupantDisplayNames && node.occupantDisplayNames.length > 0) {
    return [...node.occupantDisplayNames];
  }
  return node.occupantDisplayName ? [node.occupantDisplayName] : [];
}
