/**
 * Every Prisma migration THIS version of the code needs applied, in order.
 *
 * The readiness probe (app/api/health/ready) compares this list with what
 * the database has actually finished applying, so a deployment whose code
 * is ahead of its database — new code deployed, migration not yet run —
 * reports "not ready" instead of green while pages fail (the 2026-09-28
 * staging incident: 10 of 11 applied, readiness still said "ready").
 *
 * Kept as a constant (not read from prisma/migrations at runtime) because
 * the serverless bundle does not ship that folder. `expected-migrations.test.ts`
 * fails if this list and prisma/migrations ever disagree, so adding a
 * migration without updating it cannot slip through CI.
 */
export const EXPECTED_MIGRATIONS: readonly string[] = [
  "20260901094021_init",
  "20260901102848_add_auth_models",
  "20260902064230_add_import_models",
  "20260902121430_add_export_models",
  "20260902153408_add_audit_admin_settings",
  "20260915202031_add_deleted_audit_action",
  "20260917132026_career_framework_entities",
  "20260917144244_job_grade_per_department",
  "20260927152408_add_department_level_titles",
  "20260927220208_department_ladders_and_position_ladderkind",
  "20260928120000_position_co_heads",
  "20260929120000_levels_mapping_columns",
  "20261001120000_organogram_card_offsets",
];

/**
 * Which expected migrations the database has not finished applying.
 * Extra migrations in the database (e.g. after rolling the code back) are
 * fine — the schema is at least as new as this code needs.
 */
export function findPendingMigrations(
  expected: readonly string[],
  appliedNames: readonly string[]
): string[] {
  const applied = new Set(appliedNames);
  return expected.filter((name) => !applied.has(name));
}
