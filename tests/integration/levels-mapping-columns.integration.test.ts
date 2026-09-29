import { describe, expect, it } from "vitest";

import {
  createJobFamilyLevelTitle,
  deleteJobFamilyLevelTitle,
  setLevelsMappingColumnVisibility,
  updateJobFamilyLevelTitle,
} from "@/lib/services/job-family-level-title.service";
import { listJobFamilyLevelTitlesForCompany } from "@/lib/repositories/job-family-level-title.repository";
import {
  ConflictError,
  CrossCompanyError,
  DomainValidationError,
  NotFoundError,
} from "@/lib/domain/errors";
import { testPrisma } from "./setup";
import { makeCompany, makeDepartment } from "./fixtures";

// Levels Mapping columns (docs/DECISIONS.md D34): sub-division level names
// and show / hide per department or sub-division. Career progression only —
// nothing here may change a department's ladders or any position.

async function makeSubDivision(companyId: string, departmentId: string, code = "QA") {
  return testPrisma.jobFamily.create({
    data: { companyId, departmentId, code, name: `${code} team` },
  });
}

describe("sub-division level names", () => {
  it("creates, renames and deletes a name, with an audit event for each", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id, { code: "ENG", name: "Engineering" });
    const qa = await makeSubDivision(company.id, dept.id);

    const created = await createJobFamilyLevelTitle({
      companyId: company.id,
      jobFamilyId: qa.id,
      jobGradeCode: "l3",
      kind: "IC",
      title: "  QA Engineer ",
    });
    expect(created).toMatchObject({ jobGradeCode: "L3", kind: "IC", title: "QA Engineer" });

    const renamed = await updateJobFamilyLevelTitle({
      companyId: company.id,
      id: created.id,
      title: "Software QA Engineer",
    });
    expect(renamed.title).toBe("Software QA Engineer");

    await deleteJobFamilyLevelTitle({ companyId: company.id, id: created.id });
    expect(await listJobFamilyLevelTitlesForCompany(company.id)).toEqual([]);

    const audits = await testPrisma.auditEvent.findMany({
      where: { companyId: company.id, entityType: "JobFamilyLevelTitle" },
      orderBy: { occurredAt: "asc" },
    });
    expect(audits.map((a) => a.action)).toEqual(["CREATED", "UPDATED", "DELETED"]);
  });

  it("rejects a sub-division from another company", async () => {
    const a = await makeCompany({ code: "AA" });
    const b = await makeCompany({ code: "BB" });
    const deptB = await makeDepartment(b.id);
    const famB = await makeSubDivision(b.id, deptB.id);

    await expect(
      createJobFamilyLevelTitle({
        companyId: a.id,
        jobFamilyId: famB.id,
        jobGradeCode: "L3",
        kind: "IC",
        title: "X",
      })
    ).rejects.toBeInstanceOf(CrossCompanyError);
    expect(await testPrisma.jobFamilyLevelTitle.count()).toBe(0);
  });

  it("rejects an unknown level code", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const qa = await makeSubDivision(company.id, dept.id);
    await expect(
      createJobFamilyLevelTitle({
        companyId: company.id,
        jobFamilyId: qa.id,
        jobGradeCode: "L99",
        kind: "IC",
        title: "X",
      })
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("rejects a duplicate name in the same cell but allows it on the other ladder", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const qa = await makeSubDivision(company.id, dept.id);
    const cell = { companyId: company.id, jobFamilyId: qa.id, jobGradeCode: "L5", title: "Lead" };

    await createJobFamilyLevelTitle({ ...cell, kind: "IC" });
    await expect(createJobFamilyLevelTitle({ ...cell, kind: "IC" })).rejects.toBeInstanceOf(
      ConflictError
    );
    await expect(createJobFamilyLevelTitle({ ...cell, kind: "MANAGER" })).resolves.toBeTruthy();
  });

  it("refuses to rename or delete another company's name", async () => {
    const a = await makeCompany({ code: "AA" });
    const b = await makeCompany({ code: "BB" });
    const deptB = await makeDepartment(b.id);
    const famB = await makeSubDivision(b.id, deptB.id);
    const row = await createJobFamilyLevelTitle({
      companyId: b.id,
      jobFamilyId: famB.id,
      jobGradeCode: "L3",
      kind: "IC",
      title: "Theirs",
    });

    await expect(
      updateJobFamilyLevelTitle({ companyId: a.id, id: row.id, title: "Mine" })
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteJobFamilyLevelTitle({ companyId: a.id, id: row.id })).rejects.toBeInstanceOf(
      NotFoundError
    );
    expect(
      (await testPrisma.jobFamilyLevelTitle.findUniqueOrThrow({ where: { id: row.id } })).title
    ).toBe("Theirs");
  });
});

describe("show / hide Levels Mapping columns", () => {
  it("hides and re-shows a department without touching its ladders or its names", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id, { code: "ENG", name: "Engineering" });
    await testPrisma.department.update({
      where: { id: dept.id },
      data: { showInLevelsMapping: true },
    });
    await testPrisma.departmentLevelTitle.create({
      data: {
        companyId: company.id,
        departmentId: dept.id,
        jobGradeCode: "L3",
        kind: "IC",
        title: "Engineer",
      },
    });

    const hidden = await setLevelsMappingColumnVisibility({
      companyId: company.id,
      target: "DEPARTMENT",
      id: dept.id,
      visible: false,
    });
    expect(hidden.showInLevelsMapping).toBe(false);
    const after = await testPrisma.department.findUniqueOrThrow({ where: { id: dept.id } });
    expect(after).toMatchObject({
      hasIcLadder: dept.hasIcLadder,
      hasManagerLadder: dept.hasManagerLadder,
    });
    expect(await testPrisma.departmentLevelTitle.count({ where: { departmentId: dept.id } })).toBe(
      1
    );

    await setLevelsMappingColumnVisibility({
      companyId: company.id,
      target: "DEPARTMENT",
      id: dept.id,
      visible: true,
    });
    const audits = await testPrisma.auditEvent.findMany({
      where: { companyId: company.id, entityType: "Department", category: "CAREER_FRAMEWORK" },
    });
    expect(audits).toHaveLength(2);
  });

  it("shows a sub-division, and records no audit when nothing changes", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const qa = await makeSubDivision(company.id, dept.id);
    expect(qa.showInLevelsMapping).toBe(false);

    const shown = await setLevelsMappingColumnVisibility({
      companyId: company.id,
      target: "SUB_DIVISION",
      id: qa.id,
      visible: true,
    });
    expect(shown.showInLevelsMapping).toBe(true);

    await setLevelsMappingColumnVisibility({
      companyId: company.id,
      target: "SUB_DIVISION",
      id: qa.id,
      visible: true,
    });
    const audits = await testPrisma.auditEvent.findMany({
      where: { companyId: company.id, entityType: "JobFamily" },
    });
    expect(audits).toHaveLength(1);
  });

  it("refuses another company's department or sub-division", async () => {
    const a = await makeCompany({ code: "AA" });
    const b = await makeCompany({ code: "BB" });
    const deptB = await makeDepartment(b.id);
    const famB = await makeSubDivision(b.id, deptB.id);

    await expect(
      setLevelsMappingColumnVisibility({
        companyId: a.id,
        target: "DEPARTMENT",
        id: deptB.id,
        visible: true,
      })
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      setLevelsMappingColumnVisibility({
        companyId: a.id,
        target: "SUB_DIVISION",
        id: famB.id,
        visible: true,
      })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      (await testPrisma.jobFamily.findUniqueOrThrow({ where: { id: famB.id } })).showInLevelsMapping
    ).toBe(false);
  });

  it("deleting a sub-division's names goes with the sub-division (cascade)", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const qa = await makeSubDivision(company.id, dept.id);
    await createJobFamilyLevelTitle({
      companyId: company.id,
      jobFamilyId: qa.id,
      jobGradeCode: "L3",
      kind: "IC",
      title: "QA Engineer",
    });
    await testPrisma.jobFamily.delete({ where: { id: qa.id } });
    expect(await testPrisma.jobFamilyLevelTitle.count({ where: { companyId: company.id } })).toBe(
      0
    );
  });
});
