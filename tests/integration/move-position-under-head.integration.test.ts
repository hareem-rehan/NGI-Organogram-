import { describe, expect, it } from "vitest";

import { movePositionUnderHead, undoMovePositionUnderHead } from "@/lib/services/hierarchy.service";
import { runDomainIntegrityCheck } from "@/lib/services/integrity-check.service";
import { CycleError, NotFoundError } from "@/lib/domain/errors";
import { testPrisma } from "./setup";
import { makeChildPosition, makeCompany, makeDepartment, makeRootPosition } from "./fixtures";

/**
 * Organogram drag-and-drop onto another card (client request, 2026-10-20):
 * the card reports to it and, when that head is in another department,
 * joins its department with its branch, so the chart draws it right there.
 *
 *   CEO (Exec)
 *   ├── CTO (Eng) ── Designer (Eng, sub-division UI/UX) ── Junior (Eng, UI/UX)
 *   └── PM (Project)
 */
async function buildOrg() {
  const company = await makeCompany();
  const exec = await makeDepartment(company.id, { name: "Exec" });
  const eng = await makeDepartment(company.id, { name: "Engineering" });
  const project = await makeDepartment(company.id, { name: "Project" });
  const uiux = await testPrisma.jobFamily.create({
    data: { companyId: company.id, departmentId: eng.id, name: "UI/UX", code: "UX" },
  });
  const track = await testPrisma.careerTrack.create({
    data: { companyId: company.id, jobFamilyId: uiux.id, kind: "IC", name: "UI/UX IC" },
  });
  const ceo = await makeRootPosition(company.id, exec.id, { title: "CEO" });
  const cto = await makeChildPosition(company.id, eng.id, ceo.id, 1, { title: "CTO" });
  const pm = await makeChildPosition(company.id, project.id, ceo.id, 1, { title: "PM" });
  const designer = await makeChildPosition(company.id, eng.id, cto.id, 2, { title: "Designer" });
  const junior = await makeChildPosition(company.id, eng.id, designer.id, 3, { title: "Junior" });
  await testPrisma.position.updateMany({
    where: { id: { in: [designer.id, junior.id] } },
    data: { jobFamilyId: uiux.id, careerTrackId: track.id },
  });
  return { company, exec, eng, project, uiux, track, ceo, cto, pm, designer, junior };
}

const row = (id: string) => testPrisma.position.findUniqueOrThrow({ where: { id } });

async function expectNoViolations(companyId: string) {
  const report = await runDomainIntegrityCheck(testPrisma);
  expect(report.violations.filter((v) => v.companyId === companyId)).toEqual([]);
}

describe("movePositionUnderHead", () => {
  it("onto a head in another department: reports to it and joins its department with its branch", async () => {
    const org = await buildOrg();

    const result = await movePositionUnderHead({
      companyId: org.company.id,
      positionId: org.designer.id,
      newParentPositionId: org.pm.id,
    });

    expect(result.previousHeadPositionId).toBe(org.cto.id);
    expect(result.departmentChanges.map((c) => c.positionId).sort()).toEqual(
      [org.designer.id, org.junior.id].sort()
    );
    const designer = await row(org.designer.id);
    const junior = await row(org.junior.id);
    expect(designer.primaryReportsToPositionId).toBe(org.pm.id);
    expect(junior.primaryReportsToPositionId).toBe(org.designer.id);
    for (const moved of [designer, junior]) {
      expect(moved.departmentId).toBe(org.project.id);
      // Engineering's sub-division doesn't belong in Project.
      expect(moved.jobFamilyId).toBeNull();
      expect(moved.careerTrackId).toBeNull();
    }
    await expectNoViolations(org.company.id);
  });

  it("onto a head in the same department: only the reporting line changes", async () => {
    const org = await buildOrg();
    const other = await makeChildPosition(org.company.id, org.eng.id, org.cto.id, 2, {
      title: "Other",
    });

    const result = await movePositionUnderHead({
      companyId: org.company.id,
      positionId: org.junior.id,
      newParentPositionId: other.id,
    });

    expect(result.departmentChanges).toEqual([]);
    const junior = await row(org.junior.id);
    expect(junior.primaryReportsToPositionId).toBe(other.id);
    expect(junior.jobFamilyId).toBe(org.uiux.id);
  });

  it("Undo puts back the head, department, sub-division and career track", async () => {
    const org = await buildOrg();
    const before = await Promise.all([row(org.designer.id), row(org.junior.id)]);
    const result = await movePositionUnderHead({
      companyId: org.company.id,
      positionId: org.designer.id,
      newParentPositionId: org.pm.id,
    });

    await undoMovePositionUnderHead({
      companyId: org.company.id,
      positionId: org.designer.id,
      previousHeadPositionId: result.previousHeadPositionId!,
      departmentChanges: result.departmentChanges,
    });

    const after = await Promise.all([row(org.designer.id), row(org.junior.id)]);
    const pick = (p: (typeof before)[number]) => ({
      head: p.primaryReportsToPositionId,
      dept: p.departmentId,
      family: p.jobFamilyId,
      track: p.careerTrackId,
      grade: p.jobGradeId,
      level: p.organizationalLevel,
    });
    expect(after.map(pick)).toEqual(before.map(pick));
    await expectNoViolations(org.company.id);
  });

  it("a cycle is refused and nothing changes", async () => {
    const org = await buildOrg();
    await expect(
      movePositionUnderHead({
        companyId: org.company.id,
        positionId: org.designer.id,
        newParentPositionId: org.junior.id,
      })
    ).rejects.toBeInstanceOf(CycleError);
    const designer = await row(org.designer.id);
    expect(designer.primaryReportsToPositionId).toBe(org.cto.id);
    expect(designer.departmentId).toBe(org.eng.id);
  });

  it("Undo refuses a snapshot naming another company's sub-division, and changes nothing", async () => {
    const org = await buildOrg();
    const theirs = await buildOrg();
    const result = await movePositionUnderHead({
      companyId: org.company.id,
      positionId: org.designer.id,
      newParentPositionId: org.pm.id,
    });

    await expect(
      undoMovePositionUnderHead({
        companyId: org.company.id,
        positionId: org.designer.id,
        previousHeadPositionId: result.previousHeadPositionId!,
        departmentChanges: result.departmentChanges.map((c) => ({
          ...c,
          jobFamilyId: theirs.uiux.id,
        })),
      })
    ).rejects.toBeInstanceOf(NotFoundError);
    const designer = await row(org.designer.id);
    expect(designer.primaryReportsToPositionId).toBe(org.pm.id);
    expect(designer.departmentId).toBe(org.project.id);
  });
});
