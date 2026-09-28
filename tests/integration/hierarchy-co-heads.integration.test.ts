import { describe, expect, it } from "vitest";

import {
  changeReportsTo,
  createPosition,
  deletePosition,
  deletePositionSubtree,
  movePosition,
  setCoReportsTo,
} from "@/lib/services/hierarchy.service";
import { runDomainIntegrityCheck } from "@/lib/services/integrity-check.service";
import {
  CrossCompanyError,
  CycleError,
  DomainValidationError,
  UnsafeMutationError,
} from "@/lib/domain/errors";
import { testPrisma } from "./setup";
import { makeChildPosition, makeCompany, makeDepartment, makeRootPosition } from "./fixtures";

/**
 * Co-heads (docs/DECISIONS.md D27): a position may report to at most two
 * heads, both equal. Level = deepest head + 1. Every scenario below ends by
 * asserting the company has zero integrity violations, so a passing
 * rejection can never hide a half-applied write.
 *
 * Fixture tree:
 *   root (L1)
 *   ├── A (L2) ── A1 (L3) ── A2 (L4)
 *   └── B (L2) ── T (L3) ── T1 (L4)
 */
async function buildTree() {
  const company = await makeCompany();
  const dept = await makeDepartment(company.id);
  const root = await makeRootPosition(company.id, dept.id);
  const a = await makeChildPosition(company.id, dept.id, root.id, 1, { title: "A" });
  const a1 = await makeChildPosition(company.id, dept.id, a.id, 2, { title: "A1" });
  const a2 = await makeChildPosition(company.id, dept.id, a1.id, 3, { title: "A2" });
  const b = await makeChildPosition(company.id, dept.id, root.id, 1, { title: "B" });
  const t = await makeChildPosition(company.id, dept.id, b.id, 2, { title: "T" });
  const t1 = await makeChildPosition(company.id, dept.id, t.id, 3, { title: "T1" });
  return { company, dept, root, a, a1, a2, b, t, t1 };
}

async function levelOf(id: string): Promise<number> {
  const row = await testPrisma.position.findUniqueOrThrow({ where: { id } });
  return row.organizationalLevel;
}

async function expectNoViolations(companyId: string) {
  const report = await runDomainIntegrityCheck(testPrisma);
  expect(report.violations.filter((v) => v.companyId === companyId)).toEqual([]);
}

describe("Co-heads — setting, changing and clearing a second head", () => {
  it("sets a second head and re-levels the position and its descendants to deepest head + 1", async () => {
    const { company, a2, b, t, t1 } = await buildTree();

    const updated = await setCoReportsTo({
      companyId: company.id,
      positionId: t.id,
      coReportsToPositionId: a2.id,
    });

    expect(updated.primaryReportsToPositionId).toBe(b.id);
    expect(updated.coReportsToPositionId).toBe(a2.id);
    expect(await levelOf(t.id)).toBe(5); // A2 is L4 → deepest head + 1
    expect(await levelOf(t1.id)).toBe(6);
    await expectNoViolations(company.id);
  });

  it("changes the second head and re-levels again", async () => {
    const { company, a, a2, t, t1 } = await buildTree();
    await setCoReportsTo({ companyId: company.id, positionId: t.id, coReportsToPositionId: a2.id });

    await setCoReportsTo({ companyId: company.id, positionId: t.id, coReportsToPositionId: a.id });

    // Heads now B (L2) and A (L2) → T is L3 again.
    expect(await levelOf(t.id)).toBe(3);
    expect(await levelOf(t1.id)).toBe(4);
    await expectNoViolations(company.id);
  });

  it("clears the second head and restores single-head levels", async () => {
    const { company, a2, t, t1 } = await buildTree();
    await setCoReportsTo({ companyId: company.id, positionId: t.id, coReportsToPositionId: a2.id });

    const cleared = await setCoReportsTo({
      companyId: company.id,
      positionId: t.id,
      coReportsToPositionId: null,
    });

    expect(cleared.coReportsToPositionId).toBeNull();
    expect(await levelOf(t.id)).toBe(3);
    expect(await levelOf(t1.id)).toBe(4);
    await expectNoViolations(company.id);
  });

  it("records a HIERARCHY audit event for the change", async () => {
    const { company, a2, t } = await buildTree();
    await setCoReportsTo({ companyId: company.id, positionId: t.id, coReportsToPositionId: a2.id });

    const events = await testPrisma.auditEvent.findMany({
      where: { companyId: company.id, entityId: t.id, category: "HIERARCHY" },
    });
    expect(events).toHaveLength(1);
  });

  it("moving one head of a co-headed position re-levels it from the deepest head", async () => {
    // T1 gets a second head A2 (L4): T1 = max(T L3, A2 L4) + 1 = L5.
    const { company, a2, b, t1 } = await buildTree();
    await setCoReportsTo({
      companyId: company.id,
      positionId: t1.id,
      coReportsToPositionId: a2.id,
    });
    expect(await levelOf(t1.id)).toBe(5);

    // Moving A2 up under B (L2) → A2 L3, so T1 = max(T L3, A2 L3) + 1 = L4.
    await movePosition({ companyId: company.id, positionId: a2.id, newParentPositionId: b.id });
    expect(await levelOf(a2.id)).toBe(3);
    expect(await levelOf(t1.id)).toBe(4);
    await expectNoViolations(company.id);
  });
});

describe("Co-heads — rejected changes leave everything untouched", () => {
  async function expectUnchanged(
    ids: { id: string; level: number; co: string | null }[],
    companyId: string
  ) {
    for (const { id, level, co } of ids) {
      const row = await testPrisma.position.findUniqueOrThrow({ where: { id } });
      expect(row.organizationalLevel).toBe(level);
      expect(row.coReportsToPositionId).toBe(co);
    }
    await expectNoViolations(companyId);
  }

  it("rejects a position as its own second head", async () => {
    const { company, t } = await buildTree();
    await expect(
      setCoReportsTo({ companyId: company.id, positionId: t.id, coReportsToPositionId: t.id })
    ).rejects.toBeInstanceOf(CycleError);
    await expectUnchanged([{ id: t.id, level: 3, co: null }], company.id);
  });

  it("rejects a second head equal to the first head", async () => {
    const { company, b, t } = await buildTree();
    await expect(
      setCoReportsTo({ companyId: company.id, positionId: t.id, coReportsToPositionId: b.id })
    ).rejects.toBeInstanceOf(DomainValidationError);
    await expectUnchanged([{ id: t.id, level: 3, co: null }], company.id);
  });

  it("rejects a second head on the root", async () => {
    const { company, root, a } = await buildTree();
    await expect(
      setCoReportsTo({ companyId: company.id, positionId: root.id, coReportsToPositionId: a.id })
    ).rejects.toBeInstanceOf(DomainValidationError);
    await expectUnchanged([{ id: root.id, level: 1, co: null }], company.id);
  });

  it("rejects a direct descendant as second head (direct cycle)", async () => {
    const { company, t, t1 } = await buildTree();
    await expect(
      setCoReportsTo({ companyId: company.id, positionId: t.id, coReportsToPositionId: t1.id })
    ).rejects.toBeInstanceOf(CycleError);
    await expectUnchanged(
      [
        { id: t.id, level: 3, co: null },
        { id: t1.id, level: 4, co: null },
      ],
      company.id
    );
  });

  it("rejects an indirect descendant as second head (indirect cycle)", async () => {
    const { company, a, a2 } = await buildTree();
    await expect(
      setCoReportsTo({ companyId: company.id, positionId: a.id, coReportsToPositionId: a2.id })
    ).rejects.toBeInstanceOf(CycleError);
    await expectUnchanged([{ id: a.id, level: 2, co: null }], company.id);
  });

  it("rejects a cycle that only closes through ANOTHER position's second head", async () => {
    // T gets second head A2. Then making A a second head of... A2's ancestor
    // chain via second heads: moving A under T1 must be refused, because T1
    // is below T, and T is below A2 (second head), which is below A.
    const { company, a, a2, t, t1 } = await buildTree();
    await setCoReportsTo({ companyId: company.id, positionId: t.id, coReportsToPositionId: a2.id });

    await expect(
      movePosition({ companyId: company.id, positionId: a.id, newParentPositionId: t1.id })
    ).rejects.toBeInstanceOf(CycleError);
    await expectUnchanged(
      [
        { id: a.id, level: 2, co: null },
        { id: t.id, level: 5, co: a2.id },
      ],
      company.id
    );
  });

  it("rejects a second head from another company", async () => {
    const { company, t } = await buildTree();
    const other = await buildTree();
    await expect(
      setCoReportsTo({
        companyId: company.id,
        positionId: t.id,
        coReportsToPositionId: other.a.id,
      })
    ).rejects.toBeInstanceOf(CrossCompanyError);
    await expectUnchanged([{ id: t.id, level: 3, co: null }], company.id);
  });

  it("rejects moving head 1 onto the current second head", async () => {
    const { company, a2, t } = await buildTree();
    await setCoReportsTo({ companyId: company.id, positionId: t.id, coReportsToPositionId: a2.id });

    await expect(
      movePosition({ companyId: company.id, positionId: t.id, newParentPositionId: a2.id })
    ).rejects.toBeInstanceOf(DomainValidationError);
    await expectUnchanged([{ id: t.id, level: 5, co: a2.id }], company.id);
  });

  it("rejects making a co-headed position the root", async () => {
    const { company, a2, t } = await buildTree();
    await setCoReportsTo({ companyId: company.id, positionId: t.id, coReportsToPositionId: a2.id });

    await expect(
      movePosition({ companyId: company.id, positionId: t.id, newParentPositionId: null })
    ).rejects.toBeInstanceOf(DomainValidationError);
    await expectUnchanged([{ id: t.id, level: 5, co: a2.id }], company.id);
  });

  it("refuses to delete a position that is still someone's second head", async () => {
    const { company, a2, t } = await buildTree();
    await setCoReportsTo({ companyId: company.id, positionId: t.id, coReportsToPositionId: a2.id });

    await expect(deletePosition(a2.id, company.id)).rejects.toBeInstanceOf(UnsafeMutationError);
    expect(await testPrisma.position.findUnique({ where: { id: a2.id } })).not.toBeNull();
    await expectNoViolations(company.id);
  });

  it("refuses to delete a branch when a position in it also reports outside the branch", async () => {
    const { company, a2, b, t } = await buildTree();
    await setCoReportsTo({ companyId: company.id, positionId: t.id, coReportsToPositionId: a2.id });

    // Deleting B's branch would take T, whose second head A2 is outside it.
    await expect(deletePositionSubtree(b.id, company.id)).rejects.toBeInstanceOf(
      UnsafeMutationError
    );
    expect(await testPrisma.position.findUnique({ where: { id: t.id } })).not.toBeNull();
    await expectNoViolations(company.id);
  });

  it("deletes a branch whose shared position has BOTH heads inside the branch", async () => {
    const { company, a, a1, a2 } = await buildTree();
    // A2's heads: A1 (head 1) and A (head 2) — both inside A's branch.
    await setCoReportsTo({ companyId: company.id, positionId: a2.id, coReportsToPositionId: a.id });

    const result = await deletePositionSubtree(a.id, company.id);
    expect(result.deletedCount).toBe(3);
    expect(await testPrisma.position.count({ where: { id: { in: [a.id, a1.id, a2.id] } } })).toBe(
      0
    );
    await expectNoViolations(company.id);
  });
});

describe("Co-heads — create with two heads", () => {
  it("creates a position under two heads at deepest head + 1", async () => {
    const { company, dept, a2, b } = await buildTree();

    const created = await createPosition({
      companyId: company.id,
      departmentId: dept.id,
      title: "Shared Report",
      positionCode: "POS-SHARED",
      primaryReportsToPositionId: b.id,
      coReportsToPositionId: a2.id,
    });

    expect(created.coReportsToPositionId).toBe(a2.id);
    expect(created.organizationalLevel).toBe(5);
    await expectNoViolations(company.id);
  });

  it("refuses to create the root with a second head", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const otherRootCompany = await buildTree();
    await expect(
      createPosition({
        companyId: company.id,
        departmentId: dept.id,
        title: "Root",
        positionCode: "POS-R",
        primaryReportsToPositionId: null,
        coReportsToPositionId: otherRootCompany.a.id,
      })
    ).rejects.toBeInstanceOf(DomainValidationError);
    expect(await testPrisma.position.count({ where: { companyId: company.id } })).toBe(0);
  });

  it("refuses to create with the same position as both heads", async () => {
    const { company, dept, b } = await buildTree();
    await expect(
      createPosition({
        companyId: company.id,
        departmentId: dept.id,
        title: "Dup Heads",
        positionCode: "POS-DUP",
        primaryReportsToPositionId: b.id,
        coReportsToPositionId: b.id,
      })
    ).rejects.toBeInstanceOf(DomainValidationError);
  });
});

describe("Co-heads — database constraints (defence in depth)", () => {
  it("rejects raw writes that break the second-head rules", async () => {
    const { root, a, b, t } = await buildTree();

    await expect(
      testPrisma.position.update({ where: { id: t.id }, data: { coReportsToPositionId: t.id } })
    ).rejects.toThrow();
    await expect(
      testPrisma.position.update({ where: { id: t.id }, data: { coReportsToPositionId: b.id } })
    ).rejects.toThrow();
    await expect(
      testPrisma.position.update({ where: { id: root.id }, data: { coReportsToPositionId: a.id } })
    ).rejects.toThrow();
  });
});

describe("Co-heads — concurrency", () => {
  it("two racing second-head changes (A↔B) can never jointly create a cycle", async () => {
    const { company, a, b } = await buildTree();
    // A and B are siblings under root; each is individually a valid second
    // head of the other's child... but here we race A.co = B against B.co = A.
    // Neither is root and neither is the other's head 1, so both are valid
    // in isolation; together they would form A→B→A.
    const results = await Promise.allSettled([
      setCoReportsTo({ companyId: company.id, positionId: a.id, coReportsToPositionId: b.id }),
      setCoReportsTo({ companyId: company.id, positionId: b.id, coReportsToPositionId: a.id }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(CycleError);
    await expectNoViolations(company.id);
  });

  it("a racing move and second-head change can never jointly create a cycle", async () => {
    const { company, a, b } = await buildTree();
    const results = await Promise.allSettled([
      movePosition({ companyId: company.id, positionId: a.id, newParentPositionId: b.id }),
      setCoReportsTo({ companyId: company.id, positionId: b.id, coReportsToPositionId: a.id }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expectNoViolations(company.id);
  });
});

describe("Co-heads — changing both reporting lines at once (changeReportsTo)", () => {
  it("swaps head 1 and head 2 in one save", async () => {
    const { company, a2, b, t, t1 } = await buildTree();
    await setCoReportsTo({ companyId: company.id, positionId: t.id, coReportsToPositionId: a2.id });

    const updated = await changeReportsTo({
      companyId: company.id,
      positionId: t.id,
      newParentPositionId: a2.id,
      coReportsToPositionId: b.id,
    });

    expect(updated.primaryReportsToPositionId).toBe(a2.id);
    expect(updated.coReportsToPositionId).toBe(b.id);
    expect(await levelOf(t.id)).toBe(5);
    expect(await levelOf(t1.id)).toBe(6);
    await expectNoViolations(company.id);
  });

  it("rolls back EVERY step when a later step fails — no half-applied change", async () => {
    const { company, a, a2, b, t, t1 } = await buildTree();
    await setCoReportsTo({ companyId: company.id, positionId: t.id, coReportsToPositionId: a2.id });

    // Clearing head 2 would succeed, but moving head 1 under T's own
    // descendant T1 is a cycle — the whole save must be refused.
    await expect(
      changeReportsTo({
        companyId: company.id,
        positionId: t.id,
        newParentPositionId: t1.id,
        coReportsToPositionId: a.id,
      })
    ).rejects.toBeInstanceOf(CycleError);

    const row = await testPrisma.position.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.primaryReportsToPositionId).toBe(b.id);
    expect(row.coReportsToPositionId).toBe(a2.id);
    expect(row.organizationalLevel).toBe(5);
    await expectNoViolations(company.id);
  });

  it("is a no-op when nothing changed", async () => {
    const { company, b, t } = await buildTree();
    const before = await testPrisma.auditEvent.count({ where: { companyId: company.id } });

    await changeReportsTo({
      companyId: company.id,
      positionId: t.id,
      newParentPositionId: b.id,
      coReportsToPositionId: null,
    });

    expect(await testPrisma.auditEvent.count({ where: { companyId: company.id } })).toBe(before);
  });
});
