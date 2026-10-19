import { describe, expect, it } from "vitest";

import { NotFoundError, DomainValidationError } from "@/lib/domain/errors";
import {
  createShareLink,
  exportSharedChart,
  getSharedChartData,
  listShareLinks,
  resolveShareLink,
  revokeShareLink,
  ShareLinkUnavailableError,
} from "@/lib/services/share-link.service";
import { testPrisma } from "./setup";
import { makeCompany, makeDepartment, makeEmployee, makeRootPosition } from "./fixtures";

// View-only organogram links (docs/DECISIONS.md D60): anyone with an active
// link can view the chart; nothing else about the company leaks.

async function companyWithChart() {
  const company = await makeCompany();
  const dept = await makeDepartment(company.id, { code: "ENG", name: "Engineering" });
  const root = await makeRootPosition(company.id, dept.id);
  const employee = await makeEmployee(company.id, { firstName: "Amara", lastName: "Chen" });
  await testPrisma.positionAssignment.create({
    data: {
      companyId: company.id,
      employeeId: employee.id,
      positionId: root.id,
      isPrimary: true,
      startDate: new Date("2020-01-01"),
    },
  });
  return { company, root, employee };
}

describe("share links — create, list, turn off", () => {
  it("creates an unguessable link with the chosen expiry, audited without the token", async () => {
    const { company } = await companyWithChart();
    const link = await createShareLink({
      companyId: company.id,
      label: "Board pack",
      expiresInDays: 7,
    });

    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(link.status).toBe("active");
    const days = (link.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);

    const never = await createShareLink({ companyId: company.id, expiresInDays: null });
    expect(never.expiresAt).toBeNull();
    expect(never.token).not.toBe(link.token);

    const audits = await testPrisma.auditEvent.findMany({
      where: { companyId: company.id, entityType: "OrganogramShareLink" },
    });
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain(link.token);
  });

  it("lists only this company's links, newest first, with their status", async () => {
    const mine = await companyWithChart();
    const theirs = await companyWithChart();
    const first = await createShareLink({ companyId: mine.company.id, expiresInDays: 30 });
    const second = await createShareLink({ companyId: mine.company.id, expiresInDays: null });
    await createShareLink({ companyId: theirs.company.id, expiresInDays: null });

    const links = await listShareLinks(mine.company.id);
    expect(links.map((l) => l.id)).toEqual([second.id, first.id]);
    expect(links.every((l) => l.status === "active")).toBe(true);
  });

  it("turns a link off for good; turning it off again changes nothing", async () => {
    const { company } = await companyWithChart();
    const link = await createShareLink({ companyId: company.id, expiresInDays: null });

    const off = await revokeShareLink({ companyId: company.id, shareLinkId: link.id });
    expect(off.status).toBe("off");
    const again = await revokeShareLink({ companyId: company.id, shareLinkId: link.id });
    expect(again.revokedAt).toEqual(off.revokedAt);
    await expect(resolveShareLink(link.token)).rejects.toBeInstanceOf(ShareLinkUnavailableError);
  });

  it("refuses to turn off another company's link", async () => {
    const mine = await companyWithChart();
    const theirs = await companyWithChart();
    const link = await createShareLink({ companyId: theirs.company.id, expiresInDays: null });

    await expect(
      revokeShareLink({ companyId: mine.company.id, shareLinkId: link.id })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await resolveShareLink(link.token)).id).toBe(link.id);
  });
});

describe("share links — what a viewer gets", () => {
  it("an unknown, expired or turned-off link gets the same 'not available' answer", async () => {
    const { company } = await companyWithChart();
    const expired = await createShareLink({ companyId: company.id, expiresInDays: 7 });
    await testPrisma.organogramShareLink.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const off = await createShareLink({ companyId: company.id, expiresInDays: null });
    await revokeShareLink({ companyId: company.id, shareLinkId: off.id });

    for (const token of [expired.token, off.token, "x".repeat(43)]) {
      await expect(getSharedChartData(token)).rejects.toBeInstanceOf(ShareLinkUnavailableError);
    }
  });

  it("shows the link's own company chart, with names but no employee record ids", async () => {
    const { company, root, employee } = await companyWithChart();
    await companyWithChart(); // another company, never visible through this link
    const link = await createShareLink({ companyId: company.id, expiresInDays: null });

    const data = await getSharedChartData(link.token);
    const node = data.nodes.find((n) => n.positionId === root.id)!;

    expect(data.company.name).toBe(company.name);
    expect(node.occupantDisplayName).toBe("Amara Chen");
    expect(node.occupantEmployeeId).toBeNull();
    expect(node.occupantEmployeeIds).toEqual([]);
    expect(JSON.stringify(data)).not.toContain(employee.id);
    expect(data.nodes.every((n) => n.departmentId)).toBe(true);
  });

  it("exports through the link, at most once per cooldown, audited against the link", async () => {
    const { company } = await companyWithChart();
    const link = await createShareLink({ companyId: company.id, expiresInDays: null });
    const options = { format: "PDF" as const, scope: "FULL_COMPANY" as const };

    const file = await exportSharedChart(link.token, options);
    expect(file.contentType).toBe("application/pdf");
    expect(file.buffer.length).toBeGreaterThan(1000);
    // No export job is stored for a link viewer.
    expect(await testPrisma.exportJob.count({ where: { companyId: company.id } })).toBe(0);

    await expect(exportSharedChart(link.token, options)).rejects.toBeInstanceOf(
      DomainValidationError
    );
    const audits = await testPrisma.auditEvent.findMany({
      where: { companyId: company.id, entityType: "OrganogramShareLink", category: "EXPORT" },
    });
    expect(audits).toHaveLength(1);
  });

  it("two exports at the same moment: only one is rendered", async () => {
    const { company } = await companyWithChart();
    const link = await createShareLink({ companyId: company.id, expiresInDays: null });
    const options = { format: "PDF" as const, scope: "FULL_COMPANY" as const };

    const results = await Promise.allSettled([
      exportSharedChart(link.token, options),
      exportSharedChart(link.token, options),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("a turned-off link can't export", async () => {
    const { company } = await companyWithChart();
    const link = await createShareLink({ companyId: company.id, expiresInDays: null });
    await revokeShareLink({ companyId: company.id, shareLinkId: link.id });

    await expect(
      exportSharedChart(link.token, { format: "PDF", scope: "FULL_COMPANY" })
    ).rejects.toBeInstanceOf(ShareLinkUnavailableError);
  });
});
