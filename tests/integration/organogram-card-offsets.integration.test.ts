import { describe, expect, it } from "vitest";

import { CrossCompanyError, DomainValidationError, NotFoundError } from "@/lib/domain/errors";
import {
  BRANCH_MOVES_SINCE,
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

// Card layout on the organogram: a position card can be moved to a free spot
// together with its whole branch (D62); siblings swap and reorder (D61).
// Single-card placements from before D62 are ignored.

async function chart() {
  const company = await makeCompany();
  const dept = await makeDepartment(company.id, { code: "ENG", name: "Engineering" });
  const root = await makeRootPosition(company.id, dept.id);
  const child = await makeChildPosition(company.id, dept.id, root.id, root.organizationalLevel);
  return { company, dept, root, child };
}

describe("moving a card with its branch (D62)", () => {
  it("saves every moved card's offset in one go, rounded, and lists them", async () => {
    const { company, root, child } = await chart();
    await saveCardOffsets({
      companyId: company.id,
      moves: [
        { nodeKey: root.id, dx: 120.4, dy: -30.6 },
        { nodeKey: child.id, dx: 120.4, dy: -30.6 },
      ],
    });
    expect(await listCardOffsets(company.id)).toEqual({
      [root.id]: { dx: 120, dy: -31 },
      [child.id]: { dx: 120, dy: -31 },
    });
    const data = await getOrganogramChartData({ companyId: company.id });
    expect(data.cardOffsets[child.id]).toEqual({ dx: 120, dy: -31 });
  });

  it("moving a card back onto its automatic spot removes its row", async () => {
    const { company, child } = await chart();
    await saveCardOffset({ companyId: company.id, nodeKey: child.id, dx: 50, dy: 0 });
    await saveCardOffset({ companyId: company.id, nodeKey: child.id, dx: 0.2, dy: -0.3 });
    expect(await listCardOffsets(company.id)).toEqual({});
    expect(await testPrisma.organogramCardOffset.count()).toBe(0);
  });

  it("refuses a card from another company — and then saves none of the move", async () => {
    const mine = await chart();
    const theirs = await chart();
    await expect(
      saveCardOffsets({
        companyId: mine.company.id,
        moves: [
          { nodeKey: mine.child.id, dx: 10, dy: 10 },
          { nodeKey: theirs.child.id, dx: 10, dy: 10 },
        ],
      })
    ).rejects.toBeInstanceOf(CrossCompanyError);
    await expect(
      saveCardOffsets({ companyId: mine.company.id, moves: [{ nodeKey: "nope", dx: 1, dy: 1 }] })
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

  it("ignores single-card placements saved before branch moves existed", async () => {
    const { company, root, child } = await chart();
    const stale = new Date(BRANCH_MOVES_SINCE.getTime() - 60_000);
    await testPrisma.organogramCardOffset.create({
      data: { companyId: company.id, nodeKey: child.id, dx: 300, dy: 0, updatedAt: stale },
    });
    await saveCardOffset({ companyId: company.id, nodeKey: root.id, dx: 5, dy: 5 });
    expect(await listCardOffsets(company.id)).toEqual({ [root.id]: { dx: 5, dy: 5 } });
  });

  it("clears only the named cards' moves, and only in this company", async () => {
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

  it("reset clears every move for the company, audited once; a no-op reset is not audited", async () => {
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
