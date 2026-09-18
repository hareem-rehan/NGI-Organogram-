import { describe, expect, it } from "vitest";

import { ensureJobGradeByCode, normalizeGradeCode } from "@/lib/services/job-grade.service";
import { DomainValidationError } from "@/lib/domain/errors";
import { testPrisma } from "./setup";
import { makeCompany, makeDepartment } from "./fixtures";

describe("ensureJobGradeByCode — per-department levels", () => {
  it("creates a department's level from the scale on first use, named from the scale by default", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);

    const grade = await ensureJobGradeByCode(company.id, dept.id, "L7", null, testPrisma);

    expect(grade.code).toBe("L7");
    expect(grade.departmentId).toBe(dept.id);
    expect(grade.name).toBe("Lead / Principal");
    expect(grade.displayOrder).toBe(7);
  });

  it("uses the caller's name when one is given, and updates it on a later call", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);

    const first = await ensureJobGradeByCode(
      company.id,
      dept.id,
      "L7",
      "Principal Engineer",
      testPrisma
    );
    expect(first.name).toBe("Principal Engineer");

    const renamed = await ensureJobGradeByCode(
      company.id,
      dept.id,
      "L7",
      "Staff Engineer",
      testPrisma
    );
    expect(renamed.id).toBe(first.id);
    expect(renamed.name).toBe("Staff Engineer");
  });

  it("lets the SAME code carry a different name in a different department", async () => {
    const company = await makeCompany();
    const eng = await makeDepartment(company.id, { code: "ENG" });
    const hr = await makeDepartment(company.id, { code: "HR" });

    const engL7 = await ensureJobGradeByCode(
      company.id,
      eng.id,
      "L7",
      "Principal Engineer",
      testPrisma
    );
    const hrL7 = await ensureJobGradeByCode(company.id, hr.id, "L7", "HR Lead", testPrisma);

    expect(engL7.id).not.toBe(hrL7.id);
    expect(engL7.name).toBe("Principal Engineer");
    expect(hrL7.name).toBe("HR Lead");
    // Same universal rank in both.
    expect(engL7.displayOrder).toBe(7);
    expect(hrL7.displayOrder).toBe(7);
  });

  it("does not overwrite an existing name when no name is passed", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);

    await ensureJobGradeByCode(company.id, dept.id, "L7", "Principal Engineer", testPrisma);
    const again = await ensureJobGradeByCode(company.id, dept.id, "L7", null, testPrisma);

    expect(again.name).toBe("Principal Engineer");
  });

  it("normalizes case and whitespace", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);

    const a = await ensureJobGradeByCode(company.id, dept.id, "l7", null, testPrisma);
    const b = await ensureJobGradeByCode(company.id, dept.id, " L7 ", null, testPrisma);

    expect(normalizeGradeCode(" l7 ")).toBe("L7");
    expect(b.id).toBe(a.id);
  });

  it("rejects a code that is not on the scale", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);

    await expect(
      ensureJobGradeByCode(company.id, dept.id, "PLATINUM", null, testPrisma)
    ).rejects.toBeInstanceOf(DomainValidationError);
    expect(await testPrisma.jobGrade.count({ where: { companyId: company.id } })).toBe(0);
  });
});
