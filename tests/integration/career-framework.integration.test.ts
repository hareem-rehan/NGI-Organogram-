import { describe, expect, it } from "vitest";

import {
  createCareerTrack,
  createJobFamily,
  createLevelMappingEntry,
  deleteCareerTrack,
  deleteJobFamily,
  deleteLevelMappingEntry,
  updateJobFamily,
} from "@/lib/services/career-framework.service";
import { ConflictError, CrossCompanyError, NotFoundError } from "@/lib/domain/errors";
import { testPrisma } from "./setup";
import { makeCompany, makeDepartment, makeJobGrade, makeRootPosition } from "./fixtures";

// The career framework is a separate concept from the reporting tree
// (docs/DECISIONS.md). These tests exercise the domain rules that keep
// each entity company-scoped, internally consistent, and safely deletable
// — never any reporting behavior, which the framework must not touch.

describe("career-framework.service — job family", () => {
  it("creates a job family under a department in the same company", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id, { code: "ENG", name: "Engineering" });

    const family = await createJobFamily({
      companyId: company.id,
      departmentId: dept.id,
      name: "Software Engineering",
      code: "SWE",
    });

    expect(family.departmentId).toBe(dept.id);
    expect(family.code).toBe("SWE");
    expect(family.name).toBe("Software Engineering");
  });

  it("rejects a department from another company (no cross-company anchor)", async () => {
    const a = await makeCompany({ code: "AA" });
    const b = await makeCompany({ code: "BB" });
    const deptB = await makeDepartment(b.id);

    await expect(
      createJobFamily({
        companyId: a.id,
        departmentId: deptB.id,
        name: "X",
        code: "X1",
      })
    ).rejects.toBeInstanceOf(CrossCompanyError);
  });

  it("rejects a duplicate family code within a company", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    await createJobFamily({ companyId: company.id, departmentId: dept.id, name: "A", code: "DUP" });

    await expect(
      createJobFamily({ companyId: company.id, departmentId: dept.id, name: "B", code: "dup" })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("updates a family's name/code", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const family = await createJobFamily({
      companyId: company.id,
      departmentId: dept.id,
      name: "QA",
      code: "QA",
    });

    const updated = await updateJobFamily({
      companyId: company.id,
      jobFamilyId: family.id,
      name: "Quality Assurance",
    });
    expect(updated.name).toBe("Quality Assurance");
  });

  it("refuses to delete a family that still classifies positions", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const family = await createJobFamily({
      companyId: company.id,
      departmentId: dept.id,
      name: "SWE",
      code: "SWE",
    });
    const pos = await makeRootPosition(company.id, dept.id);
    await testPrisma.position.update({
      where: { id: pos.id },
      data: { jobFamilyId: family.id },
    });

    await expect(
      deleteJobFamily({ companyId: company.id, jobFamilyId: family.id })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("deletes an unused family and cascades its tracks and level-mapping entries", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const grade = await makeJobGrade(company.id, { code: "L7", displayOrder: 7 });
    const family = await createJobFamily({
      companyId: company.id,
      departmentId: dept.id,
      name: "SWE",
      code: "SWE",
    });
    const track = await createCareerTrack({
      companyId: company.id,
      jobFamilyId: family.id,
      kind: "IC",
    });
    await createLevelMappingEntry({
      companyId: company.id,
      jobFamilyId: family.id,
      careerTrackId: track.id,
      jobGradeId: grade.id,
      title: "Principal Software Engineer",
    });

    await deleteJobFamily({ companyId: company.id, jobFamilyId: family.id });

    expect(await testPrisma.careerTrack.count({ where: { jobFamilyId: family.id } })).toBe(0);
    expect(await testPrisma.levelMappingEntry.count({ where: { jobFamilyId: family.id } })).toBe(0);
  });
});

describe("career-framework.service — career track", () => {
  it("creates IC and MANAGER tracks as PARALLEL ladders under one family", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const family = await createJobFamily({
      companyId: company.id,
      departmentId: dept.id,
      name: "SWE",
      code: "SWE",
    });

    const ic = await createCareerTrack({
      companyId: company.id,
      jobFamilyId: family.id,
      kind: "IC",
    });
    const mgr = await createCareerTrack({
      companyId: company.id,
      jobFamilyId: family.id,
      kind: "MANAGER",
    });

    expect(ic.kind).toBe("IC");
    expect(ic.name).toBe("Individual Contributor");
    expect(mgr.kind).toBe("MANAGER");
    expect(mgr.jobFamilyId).toBe(ic.jobFamilyId);
  });

  it("allows at most one track of each kind per family", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const family = await createJobFamily({
      companyId: company.id,
      departmentId: dept.id,
      name: "P",
      code: "P",
    });
    await createCareerTrack({ companyId: company.id, jobFamilyId: family.id, kind: "MANAGER" });

    await expect(
      createCareerTrack({ companyId: company.id, jobFamilyId: family.id, kind: "MANAGER" })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects a family from another company", async () => {
    const a = await makeCompany({ code: "AA" });
    const b = await makeCompany({ code: "BB" });
    const deptB = await makeDepartment(b.id);
    const familyB = await createJobFamily({
      companyId: b.id,
      departmentId: deptB.id,
      name: "B",
      code: "B",
    });

    await expect(
      createCareerTrack({ companyId: a.id, jobFamilyId: familyB.id, kind: "IC" })
    ).rejects.toBeInstanceOf(CrossCompanyError);
  });

  it("refuses to delete a track that still classifies positions, but deletes an unused one", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const family = await createJobFamily({
      companyId: company.id,
      departmentId: dept.id,
      name: "SWE",
      code: "SWE",
    });
    const track = await createCareerTrack({
      companyId: company.id,
      jobFamilyId: family.id,
      kind: "IC",
    });
    const pos = await makeRootPosition(company.id, dept.id);
    await testPrisma.position.update({ where: { id: pos.id }, data: { careerTrackId: track.id } });

    await expect(
      deleteCareerTrack({ companyId: company.id, careerTrackId: track.id })
    ).rejects.toBeInstanceOf(ConflictError);

    // Clear the reference, then it deletes cleanly.
    await testPrisma.position.update({ where: { id: pos.id }, data: { careerTrackId: null } });
    await deleteCareerTrack({ companyId: company.id, careerTrackId: track.id });
    expect(await testPrisma.careerTrack.findUnique({ where: { id: track.id } })).toBeNull();
  });
});

describe("career-framework.service — level mapping", () => {
  async function seedFamilyTrackGrade() {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const grade = await makeJobGrade(company.id, { code: "L7", displayOrder: 7 });
    const family = await createJobFamily({
      companyId: company.id,
      departmentId: dept.id,
      name: "SWE",
      code: "SWE",
    });
    const track = await createCareerTrack({
      companyId: company.id,
      jobFamilyId: family.id,
      kind: "IC",
    });
    return { company, dept, grade, family, track };
  }

  it("maps a title to a (family, track, level) cell", async () => {
    const { company, family, track, grade } = await seedFamilyTrackGrade();

    const entry = await createLevelMappingEntry({
      companyId: company.id,
      jobFamilyId: family.id,
      careerTrackId: track.id,
      jobGradeId: grade.id,
      title: "Principal Software Engineer",
    });

    expect(entry.title).toBe("Principal Software Engineer");
    expect(entry.jobGradeId).toBe(grade.id);
  });

  it("lets an IC L7 and a Manager L7 coexist without any reporting link", async () => {
    const { company, dept, family, track, grade } = await seedFamilyTrackGrade();
    const mgrTrack = await createCareerTrack({
      companyId: company.id,
      jobFamilyId: family.id,
      kind: "MANAGER",
    });

    const icEntry = await createLevelMappingEntry({
      companyId: company.id,
      jobFamilyId: family.id,
      careerTrackId: track.id,
      jobGradeId: grade.id,
      title: "Principal Software Engineer",
    });
    const mgrEntry = await createLevelMappingEntry({
      companyId: company.id,
      jobFamilyId: family.id,
      careerTrackId: mgrTrack.id,
      jobGradeId: grade.id,
      title: "Tech Lead",
    });

    // Both exist at the same level; neither carries or implies a
    // reporting relationship — that lives only on Position.
    expect(icEntry.jobGradeId).toBe(mgrEntry.jobGradeId);
    expect(icEntry.careerTrackId).not.toBe(mgrEntry.careerTrackId);
    void dept;
  });

  it("rejects a track that belongs to a different family", async () => {
    const { company, dept, family, grade } = await seedFamilyTrackGrade();
    const otherFamily = await createJobFamily({
      companyId: company.id,
      departmentId: dept.id,
      name: "QA",
      code: "QA",
    });
    const otherTrack = await createCareerTrack({
      companyId: company.id,
      jobFamilyId: otherFamily.id,
      kind: "IC",
    });

    await expect(
      createLevelMappingEntry({
        companyId: company.id,
        jobFamilyId: family.id,
        careerTrackId: otherTrack.id,
        jobGradeId: grade.id,
        title: "Mismatch",
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects a duplicate title in the same cell", async () => {
    const { company, family, track, grade } = await seedFamilyTrackGrade();
    await createLevelMappingEntry({
      companyId: company.id,
      jobFamilyId: family.id,
      careerTrackId: track.id,
      jobGradeId: grade.id,
      title: "Principal Software Engineer",
    });

    await expect(
      createLevelMappingEntry({
        companyId: company.id,
        jobFamilyId: family.id,
        careerTrackId: track.id,
        jobGradeId: grade.id,
        title: "Principal Software Engineer",
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("deletes a level-mapping entry", async () => {
    const { company, family, track, grade } = await seedFamilyTrackGrade();
    const entry = await createLevelMappingEntry({
      companyId: company.id,
      jobFamilyId: family.id,
      careerTrackId: track.id,
      jobGradeId: grade.id,
      title: "Architect",
    });

    await deleteLevelMappingEntry({ companyId: company.id, levelMappingEntryId: entry.id });
    expect(await testPrisma.levelMappingEntry.findUnique({ where: { id: entry.id } })).toBeNull();
  });

  it("does not find another company's family from this company's context", async () => {
    const a = await makeCompany({ code: "AA" });
    const b = await makeCompany({ code: "BB" });
    const deptA = await makeDepartment(a.id);
    const familyA = await createJobFamily({
      companyId: a.id,
      departmentId: deptA.id,
      name: "A",
      code: "A",
    });

    await expect(
      updateJobFamily({ companyId: b.id, jobFamilyId: familyA.id, name: "hijack" })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
