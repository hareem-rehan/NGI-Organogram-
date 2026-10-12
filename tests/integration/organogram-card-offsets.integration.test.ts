import { describe, expect, it } from "vitest";

import { CrossCompanyError, DomainValidationError } from "@/lib/domain/errors";
import {
  clearCardOffsets,
  listCardOffsets,
  resetCardOffsets,
  saveCardOffset,
} from "@/lib/services/organogram-layout.service";
import { getOrganogramChartData } from "@/lib/services/organogram.service";
import { testPrisma } from "./setup";
import { makeChildPosition, makeCompany, makeDepartment, makeRootPosition } from "./fixtures";

// HR-placed organogram cards (docs/DECISIONS.md D38): offsets are visual only,
// company-scoped, and never touch reporting lines or levels.

async function chart() {
  const company = await makeCompany();
  const dept = await makeDepartment(company.id, { code: "ENG", name: "Engineering" });
  const root = await makeRootPosition(company.id, dept.id);
  const child = await makeChildPosition(company.id, dept.id, root.id, root.organizationalLevel);
  return { company, dept, root, child };
}

describe("organogram card offsets", () => {
  it("saves, updates and lists a card's offset (rounded to whole pixels)", async () => {
    const { company, child } = await chart();
    await saveCardOffset({ companyId: company.id, nodeKey: child.id, dx: 120.4, dy: -30.6 });
    expect(await listCardOffsets(company.id)).toEqual({ [child.id]: { dx: 120, dy: -31 } });

    await saveCardOffset({ companyId: company.id, nodeKey: child.id, dx: 5, dy: 6 });
    expect(await listCardOffsets(company.id)).toEqual({ [child.id]: { dx: 5, dy: 6 } });
    expect(await testPrisma.organogramCardOffset.count()).toBe(1);
  });

  it("dragging a card back onto its automatic spot removes the saved offset", async () => {
    const { company, child } = await chart();
    await saveCardOffset({ companyId: company.id, nodeKey: child.id, dx: 50, dy: 0 });
    await saveCardOffset({ companyId: company.id, nodeKey: child.id, dx: 0.2, dy: -0.3 });
    expect(await listCardOffsets(company.id)).toEqual({});
  });

  it("refuses to place department and sub-division boxes, and ignores old placements (D55)", async () => {
    const { company, dept, root } = await chart();
    const family = await testPrisma.jobFamily.create({
      data: { companyId: company.id, departmentId: dept.id, code: "QA", name: "QA" },
    });
    const deptKey = `dept:${dept.id}`;
    const subdivKey = `subdiv:${root.id}:${family.id}`;
    await expect(
      saveCardOffset({ companyId: company.id, nodeKey: deptKey, dx: 10, dy: 0 })
    ).rejects.toBeInstanceOf(DomainValidationError);
    await expect(
      saveCardOffset({ companyId: company.id, nodeKey: subdivKey, dx: 0, dy: 40 })
    ).rejects.toBeInstanceOf(DomainValidationError);

    // Placements saved before D55 are skipped, so those boxes sit in the
    // automatic layout on screen and in exports.
    await testPrisma.organogramCardOffset.createMany({
      data: [
        { companyId: company.id, nodeKey: deptKey, dx: 10, dy: 0 },
        { companyId: company.id, nodeKey: subdivKey, dx: 0, dy: 40 },
      ],
    });
    await saveCardOffset({ companyId: company.id, nodeKey: root.id, dx: 200, dy: 50 });
    expect(await listCardOffsets(company.id)).toEqual({ [root.id]: { dx: 200, dy: 50 } });
  });

  it("also skips position cards that were group-dragged with a box (D55)", async () => {
    const { company, dept, root, child } = await chart();
    await testPrisma.organogramCardOffset.createMany({
      data: [
        // Box and the card dragged with it: the same shift, give or take a nudge.
        { companyId: company.id, nodeKey: `dept:${dept.id}`, dx: -900, dy: -1 },
        { companyId: company.id, nodeKey: child.id, dx: -902, dy: 4 },
        // A card placed on its own keeps its spot.
        { companyId: company.id, nodeKey: root.id, dx: 120, dy: 0 },
      ],
    });
    expect(await listCardOffsets(company.id)).toEqual({ [root.id]: { dx: 120, dy: 0 } });
  });

  it("refuses a card from another company, and malformed keys", async () => {
    const mine = await chart();
    const theirs = await chart();
    await expect(
      saveCardOffset({ companyId: mine.company.id, nodeKey: theirs.child.id, dx: 1, dy: 1 })
    ).rejects.toBeInstanceOf(CrossCompanyError);
    await expect(
      saveCardOffset({
        companyId: mine.company.id,
        nodeKey: `dept:${theirs.dept.id}`,
        dx: 1,
        dy: 1,
      })
      // Box keys are refused outright now (D55), whoever's box it is.
    ).rejects.toBeInstanceOf(DomainValidationError);
    await expect(
      saveCardOffset({ companyId: mine.company.id, nodeKey: "not-a-card", dx: 1, dy: 1 })
    ).rejects.toBeInstanceOf(DomainValidationError);
    expect(await testPrisma.organogramCardOffset.count()).toBe(0);
  });

  it("never changes a reporting line or a level", async () => {
    const { company, child } = await chart();
    const before = await testPrisma.position.findUniqueOrThrow({ where: { id: child.id } });
    await saveCardOffset({ companyId: company.id, nodeKey: child.id, dx: 400, dy: 200 });
    const after = await testPrisma.position.findUniqueOrThrow({ where: { id: child.id } });
    expect(after.primaryReportsToPositionId).toBe(before.primaryReportsToPositionId);
    expect(after.organizationalLevel).toBe(before.organizationalLevel);
  });

  it("clears only the named cards, and only in this company", async () => {
    const mine = await chart();
    const theirs = await chart();
    await saveCardOffset({ companyId: mine.company.id, nodeKey: mine.child.id, dx: 1, dy: 1 });
    await saveCardOffset({ companyId: mine.company.id, nodeKey: mine.root.id, dx: 2, dy: 2 });
    await saveCardOffset({ companyId: theirs.company.id, nodeKey: theirs.child.id, dx: 3, dy: 3 });

    expect(
      await clearCardOffsets({
        companyId: mine.company.id,
        nodeKeys: [mine.child.id, theirs.child.id],
      })
    ).toBe(1);
    expect(await listCardOffsets(mine.company.id)).toEqual({ [mine.root.id]: { dx: 2, dy: 2 } });
    expect(await listCardOffsets(theirs.company.id)).toEqual({
      [theirs.child.id]: { dx: 3, dy: 3 },
    });
  });

  it("reset clears every offset for the company, audited once; a no-op reset is not audited", async () => {
    const { company, root, child } = await chart();
    await saveCardOffset({ companyId: company.id, nodeKey: root.id, dx: 1, dy: 1 });
    await saveCardOffset({ companyId: company.id, nodeKey: child.id, dx: 2, dy: 2 });

    expect(await resetCardOffsets({ companyId: company.id })).toBe(2);
    expect(await resetCardOffsets({ companyId: company.id })).toBe(0);
    expect(await listCardOffsets(company.id)).toEqual({});
    const audits = await testPrisma.auditEvent.findMany({
      where: { companyId: company.id, entityType: "OrganogramLayout" },
    });
    expect(audits).toHaveLength(1);
  });

  it("the chart data carries the saved offsets for the screen and the export", async () => {
    const { company, child } = await chart();
    await saveCardOffset({ companyId: company.id, nodeKey: child.id, dx: 300, dy: 0 });
    const data = await getOrganogramChartData({ companyId: company.id });
    expect(data.cardOffsets).toEqual({ [child.id]: { dx: 300, dy: 0 } });
  });
});
