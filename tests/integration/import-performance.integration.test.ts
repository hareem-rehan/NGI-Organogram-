import { describe, expect, it } from "vitest";

import { testPrisma } from "./setup";
import { makeCompany, makeDepartment, makeUser } from "./fixtures";
import {
  confirmImportJob,
  executeImportJob,
  uploadImportFile,
  validateImportJob,
} from "@/lib/services/import.service";

/**
 * Phase 13 Step 14 — CSV import performance at 1,000 and 5,000 rows,
 * against the REAL `import.service.ts` end-to-end pipeline (upload ->
 * validate -> confirm -> execute), exactly like
 * tests/integration/import.integration.test.ts's correctness tests, just
 * at bulk scale. All data is synthetic ("Fixture Position N" style codes/
 * titles), never real employee data (CLAUDE.md §1.11).
 *
 * Thresholds are pre-committed in docs/PERFORMANCE_REPORT.md (rows 7-8)
 * BEFORE this file was ever run against real numbers.
 */

function buildPositionCsv(rowCount: number, departmentCodes: string[]): string {
  const lines = ["positionCode,positionTitle,departmentCode,primaryManagerPositionCode"];
  lines.push("ROOT,Fixture Root Position,DEPT-0,__ROOT__");
  for (let i = 1; i < rowCount; i++) {
    const dept = departmentCodes[i % departmentCodes.length]!;
    lines.push(`POS${i},Fixture Position ${i},${dept},ROOT`);
  }
  return lines.join("\n") + "\n";
}

async function runFullImport(params: { companyId: string; userId: string; csv: string }) {
  const uploaded = await uploadImportFile({
    companyId: params.companyId,
    userId: params.userId,
    importType: "POSITION",
    importMode: "UPSERT",
    originalFilename: "bulk-import.csv",
    fileBuffer: Buffer.from(params.csv, "utf-8"),
  });
  const validated = await validateImportJob(uploaded.id, params.companyId);
  return validated;
}

describe("CSV import performance (1,000 / 5,000 synthetic position rows, real pipeline)", () => {
  it("imports 1,000 synthetic position rows (validate + confirm + execute) within threshold", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);
    const departments = await Promise.all(
      Array.from({ length: 5 }, (_, i) => makeDepartment(company.id, { code: `DEPT-${i}` }))
    );
    const csv = buildPositionCsv(
      1000,
      departments.map((d) => d.code)
    );

    const start = performance.now();
    const validated = await runFullImport({ companyId: company.id, userId: user.id, csv });
    expect(validated.status).toBe("VALIDATED");
    await confirmImportJob(validated.id, company.id, false);
    const executed = await executeImportJob(validated.id, company.id);
    const durationMs = performance.now() - start;

    console.log(
      `[import-performance][1000 rows] validate+confirm+execute -> ${durationMs.toFixed(0)}ms (threshold 10000ms)`
    );

    expect(executed.job.status).toBe("COMPLETED");
    expect(executed.job.createCount).toBe(1000);
    const count = await testPrisma.position.count({ where: { companyId: company.id } });
    expect(count).toBe(1000);
    expect(durationMs).toBeLessThan(10_000);
    // it()'s own Vitest timeout (60s, set below) is deliberately generous
    // relative to the 10s pre-committed performance threshold asserted
    // above, so a slow-but-completing run fails with a clear, informative
    // "actual ms vs threshold" assertion message instead of an
    // uninformative "test timed out". See DEF-009: with Phase 13's
    // transaction-timeout fix in place, this import no longer aborts
    // outright, but a real run was measured at ~31.8s, comfortably
    // within this 60s ceiling.
  }, 60_000);

  it("imports 5,000 synthetic position rows (validate + confirm + execute) within threshold", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);
    const departments = await Promise.all(
      Array.from({ length: 5 }, (_, i) => makeDepartment(company.id, { code: `DEPT-${i}` }))
    );
    const csv = buildPositionCsv(
      5000,
      departments.map((d) => d.code)
    );

    const start = performance.now();
    const validated = await runFullImport({ companyId: company.id, userId: user.id, csv });
    expect(validated.status).toBe("VALIDATED");
    await confirmImportJob(validated.id, company.id, false);
    const executed = await executeImportJob(validated.id, company.id);
    const durationMs = performance.now() - start;

    console.log(
      `[import-performance][5000 rows] validate+confirm+execute -> ${durationMs.toFixed(0)}ms (threshold 30000ms)`
    );

    expect(executed.job.status).toBe("COMPLETED");
    expect(executed.job.createCount).toBe(5000);
    const count = await testPrisma.position.count({ where: { companyId: company.id } });
    expect(count).toBe(5000);
    expect(durationMs).toBeLessThan(30_000);
    // Measured: this import does NOT complete even within 300 seconds
    // (5 minutes) — a real, confirmed finding (DEF-009), not a timeout-
    // tuning problem. 120s here keeps the CI cost of re-demonstrating
    // that bounded rather than chasing an ever-larger ceiling that
    // still wouldn't complete.
  }, 120_000);
});
