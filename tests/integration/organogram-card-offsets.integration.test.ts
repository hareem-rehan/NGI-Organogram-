import { describe, expect, it } from "vitest";

import { DomainValidationError, NotFoundError } from "@/lib/domain/errors";
import {
  clearCardOffsets,
  listCardOffsets,
  resetCardOffsets,
  saveCardOffset,
} from "@/lib/services/organogram-layout.service";
import { reorderPositions } from "@/lib/services/position-order.service";
import { getOrganogramChartData } from "@/lib/services/organogram.service";
import { testPrisma } from "./setup";
import { makeChildPosition, makeCompany, makeDepartment, makeRootPosition } from "./fixtures";

// Card layout on the organogram. Hand placement (D38) is retired since D61:
// every card and box reorders along its row instead, with its branch. Old
// placements are ignored on screen and in exports, and "Reset positions"
// still clears them.

async function chart() {
  const company = await makeCompany();
  const dept = await makeDepartment(company.id, { code: "ENG", name: "Engineering" });
  const root = await makeRootPosition(company.id, dept.id);
  const child = await makeChildPosition(company.id, dept.id, root.id, root.organizationalLevel);
  return { company, dept, root, child };
}

describe("card placement is retired (D61)", () => {
  it("refuses to place any card or box by hand, saving nothing", async () => {
    const { company, dept, child } = await chart();
    for (const nodeKey of [child.id, `dept:${dept.id}`]) {
      await expect(
        saveCardOffset({ companyId: company.id, nodeKey, dx: 120, dy: 0 })
      ).rejects.toBeInstanceOf(DomainValidationError);
    }
    expect(await testPrisma.organogramCardOffset.count()).toBe(0);
  });

  it("ignores placements saved before D61, on screen and in exports", async () => {
    const { company, child } = await chart();
    await testPrisma.organogramCardOffset.create({
      data: { companyId: company.id, nodeKey: child.id, dx: 300, dy: 0 },
    });

    expect(await listCardOffsets(company.id)).toEqual({});
    const data = await getOrganogramChartData({ companyId: company.id });
    expect(data.cardOffsets).toEqual({});
  });

  it("clears only the named cards' old placements, and only in this company", async () => {
    const mine = await chart();
    const theirs = await chart();
    await testPrisma.organogramCardOffset.createMany({
      data: [
        { companyId: mine.company.id, nodeKey: mine.child.id, dx: 1, dy: 1 },
        { companyId: mine.company.id, nodeKey: mine.root.id, dx: 2, dy: 2 },
        { companyId: theirs.company.id, nodeKey: theirs.child.id, dx: 3, dy: 3 },
      ],
    });

    expect(
      await clearCardOffsets({
        companyId: mine.company.id,
        nodeKeys: [mine.child.id, theirs.child.id],
      })
    ).toBe(1);
    expect(await testPrisma.organogramCardOffset.count()).toBe(2);
  });

  it("reset clears every old placement for the company, audited once; a no-op reset is not audited", async () => {
    const { company, root, child } = await chart();
    await testPrisma.organogramCardOffset.createMany({
      data: [
        { companyId: company.id, nodeKey: root.id, dx: 1, dy: 1 },
        { companyId: company.id, nodeKey: child.id, dx: 2, dy: 2 },
      ],
    });

    expect(await resetCardOffsets({ companyId: company.id })).toBe(2);
    expect(await resetCardOffsets({ companyId: company.id })).toBe(0);
    const audits = await testPrisma.auditEvent.findMany({
      where: { companyId: company.id, entityType: "OrganogramLayout" },
    });
    expect(audits).toHaveLength(1);
  });
});

describe("reorderPositions (D61)", () => {
  async function headWithReports() {
    const { company, dept, root } = await chart();
    const make = (code: string) =>
      makeChildPosition(company.id, dept.id, root.id, root.organizationalLevel, {
        positionCode: code,
      });
    const [a, b, c] = [await make("R-A"), await make("R-B"), await make("R-C")];
    return { company, root, a, b, c };
  }

  it("saves the new left-to-right order, and the chart shows it", async () => {
    const { company, a, b, c } = await headWithReports();

    await reorderPositions({ companyId: company.id, orderedPositionIds: [c.id, a.id, b.id] });

    const rows = await testPrisma.position.findMany({
      where: { id: { in: [a.id, b.id, c.id] } },
      select: { id: true, displayOrder: true },
    });
    const orderOf = new Map(rows.map((r) => [r.id, r.displayOrder]));
    expect([orderOf.get(c.id), orderOf.get(a.id), orderOf.get(b.id)]).toEqual([1, 2, 3]);

    const { nodes } = await getOrganogramChartData({ companyId: company.id });
    const shown = nodes
      .filter((n) => [a.id, b.id, c.id].includes(n.positionId))
      .map((n) => n.positionId);
    expect(shown).toEqual([c.id, a.id, b.id]);
  });

  it("never changes a reporting line or a level, and audits only what moved", async () => {
    const { company, root, a, b } = await headWithReports();
    const before = await testPrisma.position.findMany({
      where: { companyId: company.id },
      select: { id: true, primaryReportsToPositionId: true, organizationalLevel: true },
      orderBy: { id: "asc" },
    });

    await reorderPositions({ companyId: company.id, orderedPositionIds: [b.id, a.id] });
    await reorderPositions({ companyId: company.id, orderedPositionIds: [b.id, a.id] });

    const after = await testPrisma.position.findMany({
      where: { companyId: company.id },
      select: { id: true, primaryReportsToPositionId: true, organizationalLevel: true },
      orderBy: { id: "asc" },
    });
    expect(after).toEqual(before);
    expect(after.find((p) => p.id === a.id)?.primaryReportsToPositionId).toBe(root.id);
    const audits = await testPrisma.auditEvent.count({
      where: { companyId: company.id, entityType: "Position", action: "UPDATED" },
    });
    expect(audits).toBe(2); // both moved once; the repeat changed nothing
  });

  it("refuses a position from another company and changes nothing", async () => {
    const mine = await headWithReports();
    const theirs = await headWithReports();

    await expect(
      reorderPositions({
        companyId: mine.company.id,
        orderedPositionIds: [mine.a.id, theirs.a.id],
      })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      await testPrisma.position.count({
        where: { companyId: mine.company.id, displayOrder: { not: null } },
      })
    ).toBe(0);
  });
});
