/**
 * Read-only domain-integrity checker (Phase 13 release hardening).
 *
 * Scans EVERY company's data for the 18 corruption categories in
 * lib/domain/integrity-check.ts (hierarchy/root/level/cycle integrity,
 * duplicate codes, overlapping/invalid assignments, cross-company
 * reference leaks, last-admin protection, disabled-user session
 * revocation, and audit-event company consistency). It never repairs
 * anything it finds — this is a release gate/diagnostic, not a fixer.
 *
 * Usage:
 *   npm run check:integrity
 *   dotenv -e .env.test -- npm run check:integrity   (against the test DB)
 *
 * Exit code: 0 if no violations are found; 1 if any violation is found
 * (a release-blocking result — CI treats this as a required check, see
 * .github/workflows/ci.yml). This mirrors scripts/provision-user.ts's
 * plain `new PrismaClient()` CLI pattern rather than the shared
 * lib/db/prisma.ts singleton (that singleton's hot-reload caching logic
 * has no purpose in a one-shot script process).
 */
import { PrismaClient } from "@prisma/client";

import { runDomainIntegrityCheck } from "../lib/services/integrity-check.service";
import type { IntegrityViolation } from "../lib/domain/integrity-check";

function groupByCategory(violations: IntegrityViolation[]): Map<string, IntegrityViolation[]> {
  const map = new Map<string, IntegrityViolation[]>();
  for (const v of violations) {
    const list = map.get(v.category);
    if (list) list.push(v);
    else map.set(v.category, [v]);
  }
  return map;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    console.log("Running domain-integrity check across all companies (read-only)...\n");
    const report = await runDomainIntegrityCheck(prisma);

    if (report.violations.length === 0) {
      console.log(
        `PASS — no integrity violations found (checked at ${report.checkedAt.toISOString()}).`
      );
      process.exitCode = 0;
      return;
    }

    console.error(
      `FAIL — ${report.violations.length} integrity violation(s) found across ${report.companiesAffected} compan(y/ies):\n`
    );
    const grouped = groupByCategory(report.violations);
    for (const [category, violations] of grouped) {
      console.error(`  [${category}] (${violations.length})`);
      for (const v of violations) {
        console.error(`    - company ${v.companyId}: ${v.message}`);
      }
    }
    console.error("\nThis is a release-blocking result — see docs/DEFECT_REGISTER.md.");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("Unexpected error running the domain-integrity check:", error);
  process.exitCode = 1;
});
