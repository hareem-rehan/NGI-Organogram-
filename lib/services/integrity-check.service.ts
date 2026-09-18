// Deliberately no `import "server-only"` — see the identical note in
// lib/repositories/integrity-check.repository.ts; this module is
// consumed by scripts/check-domain-integrity.ts, a plain CLI process.
import type { PrismaClient } from "@prisma/client";

import { fetchIntegrityCheckInput } from "@/lib/repositories/integrity-check.repository";
import { runAllIntegrityChecks, type IntegrityViolation } from "@/lib/domain/integrity-check";

export interface IntegrityCheckReport {
  violations: IntegrityViolation[];
  checkedAt: Date;
  companiesAffected: number;
}

/**
 * Read-only, system-wide domain-integrity check (Phase 13 release
 * hardening — scripts/check-domain-integrity.ts is the CLI entry
 * point). Never repairs anything it finds; a non-empty `violations`
 * array means the release gate should fail (see the CLI script's exit
 * code).
 */
export async function runDomainIntegrityCheck(db: PrismaClient): Promise<IntegrityCheckReport> {
  const input = await fetchIntegrityCheckInput(db);
  const violations = runAllIntegrityChecks(input);
  const companiesAffected = new Set(violations.map((v) => v.companyId).filter(Boolean)).size;

  return { violations, checkedAt: new Date(), companiesAffected };
}
