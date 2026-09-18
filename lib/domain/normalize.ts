/**
 * Shared normalization rules so "the same code/email typed differently"
 * can't slip past a uniqueness check. Pure functions — no I/O.
 */

/** Trims and uppercases a code (department/position/employee/job-grade code) for comparison/storage. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Trims and lowercases a work email for comparison/storage. Returns null for empty/whitespace-only input. */
export function normalizeWorkEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Preferred name if set, else "First Last" — the one display-name rule,
 * previously duplicated in app/(app)/employees/_components/employees-view.tsx
 * and employee-details-view.tsx. Used server-side by
 * lib/repositories/organogram.repository.ts so the organogram can expose
 * an occupant's display name without shipping the raw Employee record to
 * the client (docs/ORGANOGRAM_RENDERING.md "Security and Privacy").
 */
export function formatEmployeeDisplayName(employee: {
  firstName: string;
  lastName: string;
  preferredName: string | null;
}): string {
  return employee.preferredName?.trim() || `${employee.firstName} ${employee.lastName}`;
}
