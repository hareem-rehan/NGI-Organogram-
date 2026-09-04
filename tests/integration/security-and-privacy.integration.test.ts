import { afterEach, describe, expect, it, vi } from "vitest";

import { createDepartment } from "@/lib/services/department.service";
import { createPosition } from "@/lib/services/hierarchy.service";
import { makeCompany, makeDepartment } from "./fixtures";

describe("Security and privacy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never leaks the DATABASE_URL/connection string in a translated conflict error", async () => {
    const company = await makeCompany();
    await createDepartment({ companyId: company.id, name: "Engineering", code: "ENG" });

    await expect(
      createDepartment({ companyId: company.id, name: "Engineering 2", code: "ENG" })
    ).rejects.toThrow(/already in use/);

    try {
      await createDepartment({ companyId: company.id, name: "Engineering 3", code: "ENG" });
      throw new Error("expected createDepartment to throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(process.env.DATABASE_URL);
      expect(message.toLowerCase()).not.toContain("password");
      expect(message).not.toMatch(/postgres(ql)?:\/\//);
    }
  });

  it("never leaks a raw foreign-key/database error message for a cross-company reference", async () => {
    const companyA = await makeCompany();
    const companyB = await makeCompany();
    const deptA = await makeDepartment(companyA.id);

    try {
      await createPosition({
        companyId: companyA.id,
        departmentId: deptA.id,
        title: "Should Fail",
        positionCode: "POS-X",
        primaryReportsToPositionId: null,
        jobGradeId: (await makeCompanyScopedJobGradeInOtherCompany(companyB.id)).id,
      });
      throw new Error("expected createPosition to throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message.toLowerCase()).not.toContain("prisma");
      expect(message.toLowerCase()).not.toContain("constraint");
      expect(message).not.toMatch(/postgres(ql)?:\/\//);
    }
  });

  it("does not log the DATABASE_URL when a service call is made", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const company = await makeCompany();
    await createDepartment({ companyId: company.id, name: "Engineering", code: "ENG" });

    const allLoggedText = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(" ");
    expect(allLoggedText).not.toContain(process.env.DATABASE_URL);
  });
});

async function makeCompanyScopedJobGradeInOtherCompany(companyId: string) {
  const { testPrisma } = await import("./setup");
  return testPrisma.jobGrade.create({ data: { companyId, code: "OTHER", name: "Other Grade" } });
}
