import { describe, expect, it } from "vitest";

import { CrossCompanyError } from "@/lib/domain/errors";
import { listTextStyles, saveTextStyle } from "@/lib/services/organogram-layout.service";
import { getOrganogramChartData } from "@/lib/services/organogram.service";
import { testPrisma } from "./setup";
import { makeChildPosition, makeCompany, makeDepartment, makeRootPosition } from "./fixtures";

// Organogram text styles (docs/DECISIONS.md D41): chart-wide plus per-card,
// company-scoped, audited, and purely visual.

async function chart() {
  const company = await makeCompany();
  const dept = await makeDepartment(company.id, { code: "ENG", name: "Engineering" });
  const root = await makeRootPosition(company.id, dept.id);
  const child = await makeChildPosition(company.id, dept.id, root.id, root.organizationalLevel);
  return { company, dept, root, child };
}

describe("organogram text styles", () => {
  it("saves the chart style and a card's own style, and lists them apart", async () => {
    const { company, child } = await chart();
    await saveTextStyle({
      companyId: company.id,
      nodeKey: "chart",
      style: { fontFamily: "georgia", fontSize: 15, italic: true },
    });
    await saveTextStyle({
      companyId: company.id,
      nodeKey: child.id,
      style: { color: "#FF0000", bold: false, italic: null },
    });
    expect(await listTextStyles(company.id)).toEqual({
      chart: { fontFamily: "georgia", fontSize: 15, italic: true },
      cards: { [child.id]: { color: "#ff0000", bold: false } },
    });
  });

  it("saving again replaces the style; an empty style removes the row", async () => {
    const { company, child } = await chart();
    await saveTextStyle({ companyId: company.id, nodeKey: child.id, style: { bold: true } });
    await saveTextStyle({ companyId: company.id, nodeKey: child.id, style: { underline: true } });
    expect((await listTextStyles(company.id)).cards).toEqual({ [child.id]: { underline: true } });
    await saveTextStyle({ companyId: company.id, nodeKey: child.id, style: {} });
    expect((await listTextStyles(company.id)).cards).toEqual({});
    expect(await testPrisma.organogramTextStyle.count({ where: { companyId: company.id } })).toBe(
      0
    );
  });

  it("refuses another company's card", async () => {
    const mine = await chart();
    const theirs = await chart();
    await expect(
      saveTextStyle({ companyId: mine.company.id, nodeKey: theirs.child.id, style: { bold: true } })
    ).rejects.toBeInstanceOf(CrossCompanyError);
    expect(await testPrisma.organogramTextStyle.count()).toBe(0);
  });

  it("keeps companies apart, and audits every change", async () => {
    const a = await chart();
    const b = await chart();
    await saveTextStyle({ companyId: a.company.id, nodeKey: "chart", style: { fontSize: 18 } });
    expect((await listTextStyles(b.company.id)).chart).toEqual({});
    const audits = await testPrisma.auditEvent.findMany({
      where: { companyId: a.company.id, entityType: "OrganogramTextStyle" },
    });
    expect(audits).toHaveLength(1);
  });

  it("never changes a reporting line or a level", async () => {
    const { company, child } = await chart();
    const before = await testPrisma.position.findUniqueOrThrow({ where: { id: child.id } });
    await saveTextStyle({ companyId: company.id, nodeKey: child.id, style: { fontSize: 20 } });
    const after = await testPrisma.position.findUniqueOrThrow({ where: { id: child.id } });
    expect(after.primaryReportsToPositionId).toBe(before.primaryReportsToPositionId);
    expect(after.organizationalLevel).toBe(before.organizationalLevel);
  });

  it("the chart data carries the styles for the screen and the export", async () => {
    const { company } = await chart();
    await saveTextStyle({ companyId: company.id, nodeKey: "chart", style: { bold: true } });
    const data = await getOrganogramChartData({ companyId: company.id });
    expect(data.textStyles).toEqual({ chart: { bold: true }, cards: {} });
  });
});
