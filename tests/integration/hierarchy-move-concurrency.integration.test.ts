import { describe, expect, it } from "vitest";

import { movePosition } from "@/lib/services/hierarchy.service";
import { runDomainIntegrityCheck } from "@/lib/services/integrity-check.service";
import { testPrisma } from "./setup";
import { makeChildPosition, makeCompany, makeDepartment, makeRootPosition } from "./fixtures";

/**
 * Phase 13 Step 14 — concurrency scenario for hierarchy mutation, per this
 * task's brief item 4 ("two overlapping mutations racing... e.g. two
 * hierarchy moves").
 *
 * A grep across tests/integration/*.ts for "concurrent" found existing
 * coverage for: two concurrent assignment-creation attempts on the same
 * position (employee-and-assignment.integration.test.ts:539), a concurrent
 * termination-vs-transfer race (same file:266), a stale optimistic-lock
 * settings update (settings.integration.test.ts:122), and a two-concurrent-
 * last-admin-disable race (user-admin.integration.test.ts:239) — none of
 * these exercises a hierarchy MOVE race, so this file adds exactly one new
 * scenario rather than duplicating any of the above.
 *
 * `movePosition` (lib/services/hierarchy.service.ts) has no optimistic-
 * lock/version check, and its cycle-detection read
 * (getPositionAncestorChain) runs inside a Prisma interactive transaction
 * at the default (Read Committed) isolation level — so it is not
 * self-evident, without a real test against the real database, that two
 * individually-valid concurrent moves can never jointly create a
 * reporting cycle. This test races exactly that: A is moved under B at the
 * same time B is moved under A (both valid in isolation — A and B start as
 * siblings with no ancestor relationship — but if both commit, the
 * company's hierarchy now has a 2-node cycle).
 *
 * There is no timing threshold for this scenario (docs/PERFORMANCE_REPORT.md
 * row 15) — the pass criterion is a correctness invariant: whatever the
 * outcome (one move rejected, or both applied in some serialized order),
 * `runDomainIntegrityCheck` must report zero cycle/self-report/level-
 * mismatch violations afterward.
 */
describe("Hierarchy move concurrency", () => {
  it("never allows two concurrently racing opposite moves to jointly create a reporting cycle", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const root = await makeRootPosition(company.id, dept.id);
    const positionA = await makeChildPosition(
      company.id,
      dept.id,
      root.id,
      root.organizationalLevel,
      {
        positionCode: "POS-A",
        title: "Position A",
      }
    );
    const positionB = await makeChildPosition(
      company.id,
      dept.id,
      root.id,
      root.organizationalLevel,
      {
        positionCode: "POS-B",
        title: "Position B",
      }
    );

    const results = await Promise.allSettled([
      movePosition({
        companyId: company.id,
        positionId: positionA.id,
        newParentPositionId: positionB.id,
      }),
      movePosition({
        companyId: company.id,
        positionId: positionB.id,
        newParentPositionId: positionA.id,
      }),
    ]);

    const fulfilledCount = results.filter((r) => r.status === "fulfilled").length;
    const rejectedCount = results.filter((r) => r.status === "rejected").length;
    console.log(
      `[hierarchy-concurrency] racing opposite moves -> fulfilled=${fulfilledCount} rejected=${rejectedCount}`
    );

    const report = await runDomainIntegrityCheck(testPrisma);
    const hierarchyCorruption = report.violations.filter((v) =>
      [
        "REPORTING_CYCLE",
        "SELF_REPORTING_POSITION",
        "CHILD_LEVEL_MISMATCH",
        "MULTIPLE_ROOT_POSITIONS",
      ].includes(v.category)
    );
    if (hierarchyCorruption.length > 0) {
      console.log(
        `[hierarchy-concurrency] INTEGRITY VIOLATIONS FOUND: ${JSON.stringify(hierarchyCorruption, null, 2)}`
      );
    }
    expect(hierarchyCorruption).toEqual([]);

    // At most one of the two racing moves should have actually persisted a
    // parent change that points at the other racer (i.e. the two
    // positions cannot both simultaneously report to each other) —
    // asserted directly, independent of the generic integrity check above.
    const [freshA, freshB] = await Promise.all([
      testPrisma.position.findUniqueOrThrow({ where: { id: positionA.id } }),
      testPrisma.position.findUniqueOrThrow({ where: { id: positionB.id } }),
    ]);
    const mutualCycle =
      freshA.primaryReportsToPositionId === positionB.id &&
      freshB.primaryReportsToPositionId === positionA.id;
    expect(mutualCycle).toBe(false);
  });
});
