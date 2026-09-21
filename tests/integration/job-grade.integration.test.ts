import { describe, expect, it } from "vitest";

import {
  ensureJobGradeByCode,
  normalizeGradeCode,
  provisionStandardLevels,
} from "@/lib/services/job-grade.service";
import { JOB_GRADE_SCALE } from "@/lib/domain/job-grade-mapping";
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

describe("provisionStandardLevels — one-click level scale", () => {
  it("creates the full standard scale as company-wide levels", async () => {
    const company = await makeCompany();

    const { created, alreadyExisted } = await provisionStandardLevels(
      company.id,
      "SYSTEM",
      testPrisma
    );

    expect(created).toHaveLength(JOB_GRADE_SCALE.length);
    expect(alreadyExisted).toBe(0);

    const grades = await testPrisma.jobGrade.findMany({
      where: { companyId: company.id },
      orderBy: { displayOrder: "asc" },
    });
    expect(grades).toHaveLength(JOB_GRADE_SCALE.length);
    // Company-wide (shared) scope, matching how the seed provisions them.
    expect(grades.every((g) => g.departmentId === null)).toBe(true);
    expect(grades.map((g) => g.code)).toEqual(JOB_GRADE_SCALE.map((s) => s.code));
    expect(grades.map((g) => g.name)).toEqual(JOB_GRADE_SCALE.map((s) => s.name));
    expect(grades.map((g) => g.displayOrder)).toEqual(JOB_GRADE_SCALE.map((s) => s.level));
  });

  it("is idempotent — a second run creates nothing and leaves one set", async () => {
    const company = await makeCompany();

    await provisionStandardLevels(company.id, "SYSTEM", testPrisma);
    const second = await provisionStandardLevels(company.id, "SYSTEM", testPrisma);

    expect(second.created).toHaveLength(0);
    expect(second.alreadyExisted).toBe(JOB_GRADE_SCALE.length);
    expect(await testPrisma.jobGrade.count({ where: { companyId: company.id } })).toBe(
      JOB_GRADE_SCALE.length
    );
  });

  it("only tops up the codes that are missing", async () => {
    const company = await makeCompany();
    // Pre-create one shared grade by hand; provisioning should add the rest.
    await testPrisma.jobGrade.create({
      data: {
        companyId: company.id,
        departmentId: null,
        code: "L7",
        name: "Custom Lead",
        displayOrder: 7,
        status: "ACTIVE",
      },
    });

    const { created, alreadyExisted } = await provisionStandardLevels(
      company.id,
      "SYSTEM",
      testPrisma
    );

    expect(alreadyExisted).toBe(1);
    expect(created).toHaveLength(JOB_GRADE_SCALE.length - 1);
    expect(created.some((g) => g.code === "L7")).toBe(false);
    // The pre-existing L7 keeps its custom name — provisioning never overwrites.
    const l7 = await testPrisma.jobGrade.findFirstOrThrow({
      where: { companyId: company.id, code: "L7", departmentId: null },
    });
    expect(l7.name).toBe("Custom Lead");
  });

  it("writes a single audit event describing the provisioning", async () => {
    const company = await makeCompany();

    await provisionStandardLevels(company.id, "SYSTEM", testPrisma);

    const events = await testPrisma.auditEvent.findMany({
      where: { companyId: company.id, entityType: "JobGrade" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.category).toBe("COMPANY_SETTINGS");
    expect(events[0]!.action).toBe("CREATED");
  });
});
