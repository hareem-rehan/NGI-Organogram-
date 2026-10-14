/**
 * Employee codes in reading order (user request, 2026-10-14): digit runs
 * compare as numbers, so EMP2 comes before EMP10 and EMP001 sits beside
 * EMP01; letters ignore case. Ties fall back to plain text order so the sort
 * is stable.
 */
export function compareEmployeeCodes(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }) || a.localeCompare(b);
}
