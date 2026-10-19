import { describe, expect, it } from "vitest";

import { CrossCompanyError, DomainValidationError, NotFoundError } from "@/lib/domain/errors";
import {
  clearCardOffsets,
  listCardOffsets,
  resetCardOffsets,
  saveCardOffset,
  saveCardOffsets,
} from "@/lib/services/organogram-layout.service";
import { reorderPositions } from "@/lib/services/position-order.service";
import { getOrganogramChartData } from "@/lib/services/organogram.service";
import { testPrisma } from "./setup";
import { makeChildPosition, makeCompany, makeDepartment, makeRootPosition } from "./fixtures";

// Card layout on the organogram (D64): cards are never placed by hand any
// more — a drop reorders — so saved placements are ignored and new ones are
// refused. Reset still deletes old rows. Siblings reorder (D61).

async function chart() {
  const company = await makeCompany();
  const dept = await makeDepartment(company.id, { code: "ENG", name: "Engineering" });
  const root = await makeRootPosition(company.id, dept.id);
  const child = await makeChildPosition(company.id, dept.id, root.id, root.organizationalLevel);
  return { company, dept, root, child };
}

describe("hand placement retired (D64)", () => {
  it("ignores every saved placement, on screen and in exports", async () => {
    const { company, root, child } = await chart();
    await testPrisma.organogramCardOffset.createMany({
      data: [
        { companyId: company.id, nodeKey: root.id, dx: 120, dy: -30 },
        { companyId: company.id, nodeKey: child.id, dx: 300, dy: 0 },
      ],
    });
    expect(await listCardOffsets(company.id)).toEqual({});
    const data = await getOrganogramChartData({ companyId: company.id });
    expect(data.cardOffsets).toEqual({});
  });

  it("refuses a new placement and saves nothing; a zero offset just removes the row", async () => {
    const { company, child } = await chart();
    await expect(
      saveCardOffsets({ companyId: company.id, moves: [{ nodeKey: child.id, dx: 40, dy: 0 }] })
    ).rejects.toBeInstanceOf(DomainValidationError);
    await expect(
      saveCardOffset({ companyId: company.id, nodeKey: child.id, dx: 0, dy: 50 })
    ).rejects.toBeInstanceOf(DomainValidationError);
    expect(await testPrisma.organogramCardOffset.count()).toBe(0);

    await testPrisma.organogramCardOffset.create({
      data: { companyId: company.id, nodeKey: child.id, dx: 50, dy: 0 },
    });
    await saveCardOffset({ companyId: company.id, nodeKey: child.id, dx: 0.2, dy: -0.3 });
    expect(await testPrisma.organogramCardOffset.count()).toBe(0);
  });

  it("a zero offset naming another company's card is refused", async () => {
    const mine = await chart();
    const theirs = await chart();
    await expect(
      saveCardOffsets({
        companyId: mine.company.id,
        moves: [{ nodeKey: theirs.child.id, dx: 0, dy: 0 }],
      })
    ).rejects.toBeInstanceOf(CrossCompanyError);
  });

  it("clears only the named cards' rows, and only in this company", async () => {
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

  it("reset deletes every old row for the company, audited once; a no-op reset is not audited", async () => {
    const { company, root, child } = await chart();
    await testPrisma.organogramCardOffset.createMany({
      data: [
        { companyId: company.id, nodeKey: root.id, dx: 1, dy: 1 },
        { companyId: company.id, nodeKey: child.id, dx: 2, dy: 2 },
      ],
    });
    const before = await testPrisma.position.findUniqueOrThrow({ where: { id: child.id } });

    expect(await resetCardOffsets({ companyId: company.id })).toBe(2);
    expect(await resetCardOffsets({ companyId: company.id })).toBe(0);
    const audits = await testPrisma.auditEvent.findMany({
      where: { companyId: company.id, entityType: "OrganogramLayout" },
    });
    expect(audits).toHaveLength(1);
    // Reset tidies the layout only: reporting lines and levels are untouched.
    const after = await testPrisma.position.findUniqueOrThrow({ where: { id: child.id } });
    expect(after.primaryReportsToPositionId).toBe(before.primaryReportsToPositionId);
    expect(after.organizationalLevel).toBe(before.organizationalLevel);
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
