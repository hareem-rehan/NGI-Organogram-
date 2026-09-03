/**
 * Real hex values copied from `app/globals.css`'s design tokens — the
 * SVG renderer is converted to PDF/PNG in complete isolation (sharp/
 * pdfkit never resolve CSS custom properties), so every color used in
 * exported output must be a literal hex string, not a `var(--...)`
 * reference. Keep in sync with `app/globals.css` by hand; a mismatch is
 * a cosmetic bug, never a security or correctness one.
 */
export const EXPORT_COLORS = {
  background: "#ffffff",
  foreground: "#0f172a",
  muted: "#f1f5f9",
  mutedForeground: "#475569",
  border: "#e2e8f0",
  primary: "#2563eb",
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
