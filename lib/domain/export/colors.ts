/**
 * Real hex values copied from `app/globals.css`'s design tokens — the
 * SVG renderer is converted to PDF/PNG in complete isolation (sharp/
 * pdfkit never resolve CSS custom properties), so every color used in
 * exported output must be a literal hex string, not a `var(--...)`
 * reference. Keep in sync with `app/globals.css` by hand; a mismatch is
 * a cosmetic bug, never a security or correctness one. (The DotZero
 * rebrand initially updated `globals.css` alone and left these stale, so
 * every export still rendered in the pre-rebrand blue/slate palette —
 * `svg-renderer.test.ts` now asserts these values against the real
 * tokens so the two cannot drift apart silently again.)
 */
export const EXPORT_COLORS = {
  background: "#ffffff",
  foreground: "#2d2d2d", // Dark Slate
  muted: "#f7f7f7", // Soft White
  mutedForeground: "#5d5b5b", // Ash Gray
  border: "#d3d3d3", // Soft Silver
  primary: "#d72d39", // Velocity Red, darkened for contrast (docs/BRANDING.md)
  primaryForeground: "#ffffff",
  statusFilled: "#166534",
  statusVacant: "#b45309",
  statusPlanned: "#2563eb",
  statusPlannedForeground: "#1e3a8a",
  statusInactive: "#64748b",
} as const;

/** Falls back to the neutral border color exactly as `position-node.tsx` does for a null/missing department color. */
export function resolveDepartmentColor(color: string | null): string {
  return color ?? EXPORT_COLORS.border;
}
