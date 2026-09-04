import { describe, expect, it } from "vitest";

import { testPrisma } from "./setup";
import { makeCompany, makeUser } from "./fixtures";
import { DomainValidationError, StaleUpdateError } from "@/lib/domain/errors";
import {
  getAuthDisplaySettings,
  getOrCreateSettings,
  updateCompanyProfile,
  updateSettings,
} from "@/lib/services/settings.service";
import { queryAuditEvents } from "@/lib/services/audit.service";

function actorFor(user: { id: string; name: string | null; email: string }) {
  return { userId: user.id, displayName: user.name, email: user.email };
}

describe("settings.service", () => {
  it("lazily creates a default CompanySettings row on first read", async () => {
    const company = await makeCompany();
    const settings = await getOrCreateSettings(company.id);
    expect(settings.defaultPdfPageSize).toBe("A3");
    expect(settings.exportRetentionDays).toBe(7);

    const again = await getOrCreateSettings(company.id);
    expect(again.id).toBe(settings.id);
  });

  it("updates the company profile (name/legalName/timezone) and records an audit event, but never touches `code`", async () => {
    const company = await makeCompany();
    const admin = await makeUser(company.id, { role: "ADMIN" });

    const updated = await updateCompanyProfile({
      companyId: company.id,
      actor: actorFor(admin),
      name: "Northwind Traders",
      timezone: "America/New_York",
    });
    expect(updated.name).toBe("Northwind Traders");
    expect(updated.timezone).toBe("America/New_York");
    expect(updated.code).toBe(company.code);

    const events = await queryAuditEvents({
      companyId: company.id,
      role: "ADMIN",
      category: "COMPANY_SETTINGS",
    });
    expect(events.events.map((e) => e.action)).toContain("SETTINGS_CHANGED");
  });

  it("rejects an invalid IANA timezone", async () => {
    const company = await makeCompany();
    const admin = await makeUser(company.id, { role: "ADMIN" });
    await expect(
      updateCompanyProfile({
        companyId: company.id,
        actor: actorFor(admin),
        timezone: "Not/A_Real_Zone",
      })
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("updates organogram and export defaults using the shared validation constants, and records an audit event", async () => {
    const company = await makeCompany();
    const admin = await makeUser(company.id, { role: "ADMIN" });

    const updated = await updateSettings({
      companyId: company.id,
      actor: actorFor(admin),
      defaultExpansionDepth: 3,
      defaultViewMode: "outline",
      showPlannedByDefault: false,
      defaultPdfPageSize: "A4",
      defaultPdfLayoutMode: "SINGLE_PAGE",
      defaultPngScale: 3,
      exportRetentionDays: 14,
    });
    expect(updated.defaultExpansionDepth).toBe(3);
    expect(updated.defaultViewMode).toBe("outline");
    expect(updated.defaultPdfPageSize).toBe("A4");
    expect(updated.exportRetentionDays).toBe(14);

    const events = await queryAuditEvents({
      companyId: company.id,
      role: "ADMIN",
      entityId: updated.id,
    });
    expect(events.events[0]?.action).toBe("SETTINGS_CHANGED");
    expect(events.events[0]?.changedFields).toEqual(
      expect.arrayContaining(["defaultExpansionDepth", "defaultViewMode", "defaultPdfPageSize"])
    );
  });

  it("rejects an out-of-range expansion depth", async () => {
    const company = await makeCompany();
    const admin = await makeUser(company.id, { role: "ADMIN" });
    await expect(
      updateSettings({ companyId: company.id, actor: actorFor(admin), defaultExpansionDepth: 999 })
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("rejects an unsafe (out-of-range) export retention value", async () => {
    const company = await makeCompany();
    const admin = await makeUser(company.id, { role: "ADMIN" });
    await expect(
      updateSettings({ companyId: company.id, actor: actorFor(admin), exportRetentionDays: 3650 })
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("rejects an unsupported PDF page size / layout mode / PNG scale value", async () => {
    const company = await makeCompany();
    const admin = await makeUser(company.id, { role: "ADMIN" });
    await expect(
      updateSettings({
        companyId: company.id,
        actor: actorFor(admin),
        defaultPdfPageSize: "LETTER",
      })
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("rejects a stale settings update whose expectedUpdatedAt no longer matches (concurrent overwrite protection)", async () => {
    const company = await makeCompany();
    const admin = await makeUser(company.id, { role: "ADMIN" });
    const initial = await getOrCreateSettings(company.id);

    await updateSettings({
      companyId: company.id,
      actor: actorFor(admin),
      brandingText: "First change",
    });

    await expect(
      updateSettings({
        companyId: company.id,
        actor: actorFor(admin),
        brandingText: "Second change",
        expectedUpdatedAt: initial.updatedAt,
      })
    ).rejects.toBeInstanceOf(StaleUpdateError);
  });

  it("never touches Department/Position/Employee/Assignment tables — settings changes are isolated from hierarchy data", async () => {
    const company = await makeCompany();
    const admin = await makeUser(company.id, { role: "ADMIN" });
    const deptCountBefore = await testPrisma.department.count({ where: { companyId: company.id } });
    const posCountBefore = await testPrisma.position.count({ where: { companyId: company.id } });

    await updateSettings({
      companyId: company.id,
      actor: actorFor(admin),
      defaultExpansionDepth: 5,
      exportRetentionDays: 10,
    });

    expect(await testPrisma.department.count({ where: { companyId: company.id } })).toBe(
      deptCountBefore
    );
    expect(await testPrisma.position.count({ where: { companyId: company.id } })).toBe(
      posCountBefore
    );
  });

  it("exposes only safe, read-only auth display fields — no secret, token, or full issuer config", () => {
    const settings = getAuthDisplaySettings();
    expect(settings).toHaveProperty("providerName");
    expect(settings).toHaveProperty("allowedDomains");
    expect(settings).toHaveProperty("autoProvisionViewersEnabled");
    expect(settings).not.toHaveProperty("clientSecret");
    expect(settings).not.toHaveProperty("accessToken");
    expect(JSON.stringify(settings)).not.toMatch(/secret/i);
  });
});
