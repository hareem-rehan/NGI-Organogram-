import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { ConflictError } from "@/lib/domain/errors";
import { createCompany } from "@/lib/services/company-setup.service";
import { testPrisma } from "./setup";

const code = () => `SETUP${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

describe("createCompany (D71)", () => {
  it("creates the company a fresh database needs, code upper-cased", async () => {
    const c = code();
    const company = await createCompany({
      code: c.toLowerCase(),
      name: "The DotZero",
      timezone: "Asia/Karachi",
    });
    expect(company).toMatchObject({
      code: c,
      name: "The DotZero",
      legalName: null,
      timezone: "Asia/Karachi",
      status: "ACTIVE",
    });
    expect(await testPrisma.company.findUnique({ where: { code: c } })).not.toBeNull();
  });

  it("defaults the timezone to UTC", async () => {
    const company = await createCompany({ code: code(), name: "Default TZ Co" });
    expect(company.timezone).toBe("UTC");
  });

  it("refuses a duplicate code, whatever its case", async () => {
    const c = code();
    await createCompany({ code: c, name: "First" });
    await expect(createCompany({ code: c.toLowerCase(), name: "Second" })).rejects.toBeInstanceOf(
      ConflictError
    );
    expect(await testPrisma.company.count({ where: { code: c } })).toBe(1);
  });

  it("refuses a bad code, a missing name, an unknown timezone or an extra field", async () => {
    for (const input of [
      { code: "x", name: "Too short" },
      { code: "BAD CODE", name: "Space" },
      { code: code(), name: "" },
      { code: code(), name: "Mars", timezone: "Mars/Base" },
      { code: code(), name: "Extra", companyId: "nope" },
    ]) {
      await expect(createCompany(input)).rejects.toBeInstanceOf(ZodError);
    }
  });
});
