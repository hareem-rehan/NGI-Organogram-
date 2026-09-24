import { describe, expect, it } from "vitest";

import {
  deleteLevelByCode,
  ensureJobGradeByCode,
  normalizeGradeCode,
  provisionStandardLevel,
  provisionStandardLevels,
  removeUnusedLevels,
} from "@/lib/services/job-grade.service";
import { getJobGradeUsageCounts } from "@/lib/repositories/job-grade.repository";
import { createJobFamily, createLevelMappingEntry } from "@/lib/services/career-framework.service";
import { JOB_GRADE_SCALE } from "@/lib/domain/job-grade-mapping";
import { DomainValidationError, UnsafeMutationError } from "@/lib/domain/errors";
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

describe("level curation — usage counts, add, and remove", () => {
  it("provisionStandardLevel adds one company-wide level and is idempotent", async () => {
    const company = await makeCompany();

    const first = await provisionStandardLevel(company.id, "L9", "SYSTEM", testPrisma);
    const second = await provisionStandardLevel(company.id, "L9", "SYSTEM", testPrisma);

    expect(first.code).toBe("L9");
    expect(first.departmentId).toBeNull();
    expect(second.id).toBe(first.id); // idempotent — no duplicate
    const rows = await testPrisma.jobGrade.findMany({
      where: { companyId: company.id, code: "L9" },
    });
    expect(rows).toHaveLength(1);
  });

  it("provisionStandardLevel rejects a code outside the scale", async () => {
    const company = await makeCompany();
    await expect(
      provisionStandardLevel(company.id, "L99", "SYSTEM", testPrisma)
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("getJobGradeUsageCounts counts positions and titles per grade", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const l7 = await provisionStandardLevel(company.id, "L7", "SYSTEM", testPrisma);

    // One position at L7.
    await testPrisma.position.create({
      data: {
        companyId: company.id,
        departmentId: dept.id,
        positionCode: "POS-USG",
        title: "Principal",
        primaryReportsToPositionId: null,
        organizationalLevel: 1,
        jobGradeId: l7.id,
      },
    });
    // One career-matrix title at L7.
    const family = await createJobFamily({
      companyId: company.id,
      departmentId: dept.id,
      name: "SWE",
      code: "SWE",
    });
    await createLevelMappingEntry({
      companyId: company.id,
      jobFamilyId: family.id,
      jobGradeId: l7.id,
      title: "Principal Software Engineer",
    });

    const usage = await getJobGradeUsageCounts(company.id);
    expect(usage.get(l7.id)).toEqual({ positionCount: 1, titleCount: 1 });
  });

  it("deleteLevelByCode removes an unused level but refuses one in use", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const l7 = await provisionStandardLevel(company.id, "L7", "SYSTEM", testPrisma);
    await provisionStandardLevel(company.id, "L9", "SYSTEM", testPrisma);

    // L7 is used by a position; L9 is used by nothing.
    await testPrisma.position.create({
      data: {
        companyId: company.id,
        departmentId: dept.id,
        positionCode: "POS-L7",
        title: "Principal",
        primaryReportsToPositionId: null,
        organizationalLevel: 1,
        jobGradeId: l7.id,
      },
    });

    await expect(deleteLevelByCode(company.id, "L7", "SYSTEM", testPrisma)).rejects.toBeInstanceOf(
      UnsafeMutationError
    );
    // L7 is untouched.
    await expect(
      testPrisma.jobGrade.findFirst({ where: { companyId: company.id, code: "L7" } })
    ).resolves.not.toBeNull();

    // L9 (unused) deletes cleanly.
    const result = await deleteLevelByCode(company.id, "L9", "SYSTEM", testPrisma);
    expect(result.deletedCount).toBe(1);
    await expect(
      testPrisma.jobGrade.findFirst({ where: { companyId: company.id, code: "L9" } })
    ).resolves.toBeNull();
  });

  it("removeUnusedLevels clears only the levels nothing references", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    // Provision the whole scale, then use exactly one level.
    await provisionStandardLevels(company.id, "SYSTEM", testPrisma);
    const l7 = await testPrisma.jobGrade.findFirstOrThrow({
      where: { companyId: company.id, code: "L7", departmentId: null },
    });
    await testPrisma.position.create({
      data: {
        companyId: company.id,
        departmentId: dept.id,
        positionCode: "POS-KEEP",
        title: "Principal",
        primaryReportsToPositionId: null,
        organizationalLevel: 1,
        jobGradeId: l7.id,
      },
    });

    const before = await testPrisma.jobGrade.count({ where: { companyId: company.id } });
    const { removedCodes } = await removeUnusedLevels(company.id, "SYSTEM", testPrisma);

    // Every scale level except the used L7 is removed.
    expect(removedCodes).not.toContain("L7");
    expect(removedCodes.length).toBe(before - 1);
    const remaining = await testPrisma.jobGrade.findMany({ where: { companyId: company.id } });
    expect(remaining.map((g) => g.code)).toEqual(["L7"]);
  });
});
