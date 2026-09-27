import { describe, expect, it } from "vitest";

import {
  createDepartmentLevelTitle,
  deleteDepartmentLevelTitle,
  updateDepartmentLevelTitle,
} from "@/lib/services/department-level-title.service";
import {
  listDepartmentLevelTitlesForCompany,
  listDepartmentLevelTitlesForDepartment,
} from "@/lib/repositories/department-level-title.repository";
import {
  ConflictError,
  CrossCompanyError,
  DomainValidationError,
  NotFoundError,
} from "@/lib/domain/errors";
import { testPrisma } from "./setup";
import { makeCompany, makeDepartment } from "./fixtures";

// The Levels Mapping grid is department-scoped career progression only
// (docs/DECISIONS.md). These tests exercise the domain rules that keep each
// row company-scoped, valid against the level scale, and free of duplicates —
// never any reporting behaviour, which this must not touch.

describe("department-level-title.service", () => {
  it("creates a level name for a (department, ladder, level) cell", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id, { code: "ENG", name: "Engineering" });

    const created = await createDepartmentLevelTitle({
      companyId: company.id,
      departmentId: dept.id,
      jobGradeCode: "L7",
      kind: "IC",
      title: "Principal Software Engineer",
    });

    expect(created.departmentId).toBe(dept.id);
    expect(created.jobGradeCode).toBe("L7");
    expect(created.kind).toBe("IC");
    expect(created.title).toBe("Principal Software Engineer");
  });

  it("rejects a department from another company (no cross-company anchor)", async () => {
    const a = await makeCompany({ code: "AA" });
    const b = await makeCompany({ code: "BB" });
    const deptB = await makeDepartment(b.id);

    await expect(
      createDepartmentLevelTitle({
        companyId: a.id,
        departmentId: deptB.id,
        jobGradeCode: "L7",
        kind: "IC",
        title: "X",
      })
    ).rejects.toBeInstanceOf(CrossCompanyError);
  });

  it("rejects an unknown level code (not on the standard scale)", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);

    await expect(
      createDepartmentLevelTitle({
        companyId: company.id,
        departmentId: dept.id,
        jobGradeCode: "L99",
        kind: "IC",
        title: "X",
      })
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("rejects a duplicate title in the same cell", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    await createDepartmentLevelTitle({
      companyId: company.id,
      departmentId: dept.id,
      jobGradeCode: "L7",
      kind: "IC",
      title: "Principal Software Engineer",
    });

    await expect(
      createDepartmentLevelTitle({
        companyId: company.id,
        departmentId: dept.id,
        jobGradeCode: "L7",
        kind: "IC",
        title: "Principal Software Engineer",
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("allows the same title on a different ladder or level (distinct cells)", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const base = {
      companyId: company.id,
      departmentId: dept.id,
      title: "Lead",
    };
    const a = await createDepartmentLevelTitle({ ...base, jobGradeCode: "L7", kind: "IC" });
    const b = await createDepartmentLevelTitle({ ...base, jobGradeCode: "L7", kind: "MANAGER" });
    const c = await createDepartmentLevelTitle({ ...base, jobGradeCode: "L8", kind: "IC" });

    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
  });

  it("updates a level name's title", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const created = await createDepartmentLevelTitle({
      companyId: company.id,
      departmentId: dept.id,
      jobGradeCode: "L3",
      kind: "IC",
      title: "SW Engineer",
    });

    const updated = await updateDepartmentLevelTitle({
      companyId: company.id,
      id: created.id,
      title: "Software Engineer",
    });
    expect(updated.title).toBe("Software Engineer");
  });

  it("does not update another company's row from this company's context", async () => {
    const a = await makeCompany({ code: "AA" });
    const b = await makeCompany({ code: "BB" });
    const deptA = await makeDepartment(a.id);
    const rowA = await createDepartmentLevelTitle({
      companyId: a.id,
      departmentId: deptA.id,
      jobGradeCode: "L4",
      kind: "IC",
      title: "Engineer",
    });

    await expect(
      updateDepartmentLevelTitle({ companyId: b.id, id: rowA.id, title: "hijack" })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("deletes a level name", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const created = await createDepartmentLevelTitle({
      companyId: company.id,
      departmentId: dept.id,
      jobGradeCode: "L5",
      kind: "IC",
      title: "Senior Engineer",
    });

    await deleteDepartmentLevelTitle({ companyId: company.id, id: created.id });
    expect(
      await testPrisma.departmentLevelTitle.findUnique({ where: { id: created.id } })
    ).toBeNull();
  });
});

describe("department-level-title.repository", () => {
  it("lists a company's rows and scopes by department, isolating other companies", async () => {
    const a = await makeCompany({ code: "AA" });
    const b = await makeCompany({ code: "BB" });
    const deptA1 = await makeDepartment(a.id, { code: "ENG", name: "Engineering" });
    const deptA2 = await makeDepartment(a.id, { code: "HR", name: "HR" });
    const deptB = await makeDepartment(b.id);

    await createDepartmentLevelTitle({
      companyId: a.id,
      departmentId: deptA1.id,
      jobGradeCode: "L3",
      kind: "IC",
      title: "Engineer",
    });
    await createDepartmentLevelTitle({
      companyId: a.id,
      departmentId: deptA2.id,
      jobGradeCode: "L3",
      kind: "MANAGER",
      title: "HR Exec",
    });
    await createDepartmentLevelTitle({
      companyId: b.id,
      departmentId: deptB.id,
      jobGradeCode: "L3",
      kind: "IC",
      title: "Other Co Engineer",
    });

    const allForA = await listDepartmentLevelTitlesForCompany(a.id);
    expect(allForA).toHaveLength(2);
    expect(allForA.every((r) => r.companyId === a.id)).toBe(true);

    const eng = await listDepartmentLevelTitlesForDepartment(deptA1.id, a.id);
    expect(eng).toHaveLength(1);
    expect(eng[0]!.title).toBe("Engineer");
  });
});
