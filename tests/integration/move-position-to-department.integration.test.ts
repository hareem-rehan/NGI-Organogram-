import { describe, expect, it } from "vitest";

import { movePositionToDepartment } from "@/lib/services/hierarchy.service";
import { runDomainIntegrityCheck } from "@/lib/services/integrity-check.service";
import { CycleError, DomainValidationError } from "@/lib/domain/errors";
import { testPrisma } from "./setup";
import { makeChildPosition, makeCompany, makeDepartment, makeRootPosition } from "./fixtures";

/**
 * Organogram drag-and-drop onto a department heading (docs/DECISIONS.md D29).
 *
 *   CEO (Exec)
 *   ├── CTO (Eng) ── Lead (Eng) ── Dev (Eng)
 *   └── CCO (CDS) ── Manager (CDS) ── Analyst (CDS)
 */
async function buildOrg() {
  const company = await makeCompany();
  const exec = await makeDepartment(company.id, { name: "Exec" });
  const eng = await makeDepartment(company.id, { name: "Engineering" });
  const cds = await makeDepartment(company.id, { name: "CDS" });
  const empty = await makeDepartment(company.id, { name: "Empty" });
  const ceo = await makeRootPosition(company.id, exec.id, { title: "CEO" });
  const cto = await makeChildPosition(company.id, eng.id, ceo.id, 1, { title: "CTO" });
  const lead = await makeChildPosition(company.id, eng.id, cto.id, 2, { title: "Lead" });
  const dev = await makeChildPosition(company.id, eng.id, lead.id, 3, { title: "Dev" });
  const cco = await makeChildPosition(company.id, cds.id, ceo.id, 1, { title: "CCO" });
  const manager = await makeChildPosition(company.id, cds.id, cco.id, 2, { title: "Manager" });
  const analyst = await makeChildPosition(company.id, cds.id, manager.id, 3, {
    title: "Analyst",
  });
  return { company, exec, eng, cds, empty, ceo, cto, lead, dev, cco, manager, analyst };
}

async function row(id: string) {
  return testPrisma.position.findUniqueOrThrow({ where: { id } });
}

async function expectNoViolations(companyId: string) {
  const report = await runDomainIntegrityCheck(testPrisma);
  expect(report.violations.filter((v) => v.companyId === companyId)).toEqual([]);
}

describe("movePositionToDepartment", () => {
  it("moves a position and its whole branch into the department, under its top position", async () => {
    const org = await buildOrg();

    const result = await movePositionToDepartment({
      companyId: org.company.id,
      positionId: org.manager.id,
      departmentId: org.eng.id,
    });

    expect(result.newHeadPositionId).toBe(org.cto.id);
    expect(result.departmentChangedCount).toBe(2);
    const manager = await row(org.manager.id);
    const analyst = await row(org.analyst.id);
    expect(manager.primaryReportsToPositionId).toBe(org.cto.id);
    expect(manager.departmentId).toBe(org.eng.id);
    expect(manager.organizationalLevel).toBe(3);
    // The branch keeps its own reporting line and joins the department too.
    expect(analyst.primaryReportsToPositionId).toBe(org.manager.id);
    expect(analyst.departmentId).toBe(org.eng.id);
    expect(analyst.organizationalLevel).toBe(4);
    await expectNoViolations(org.company.id);
  });

  it("reports to the company root when the department has no positions yet", async () => {
    const org = await buildOrg();

    const result = await movePositionToDepartment({
      companyId: org.company.id,
      positionId: org.lead.id,
      departmentId: org.empty.id,
    });

    expect(result.newHeadPositionId).toBe(org.ceo.id);
    expect((await row(org.lead.id)).departmentId).toBe(org.empty.id);
    expect((await row(org.dev.id)).departmentId).toBe(org.empty.id);
    expect((await row(org.lead.id)).organizationalLevel).toBe(2);
    await expectNoViolations(org.company.id);
  });

  it("re-maps each moved position's level to the same level code in the new department", async () => {
    const org = await buildOrg();
    const cdsGrade = await testPrisma.jobGrade.create({
      data: {
        companyId: org.company.id,
        departmentId: org.cds.id,
        code: "L9",
        name: "CDS Lead",
        displayOrder: 9,
      },
    });
    await testPrisma.position.update({
      where: { id: org.manager.id },
      data: { jobGradeId: cdsGrade.id },
    });

    await movePositionToDepartment({
      companyId: org.company.id,
      positionId: org.manager.id,
      departmentId: org.eng.id,
    });

    const moved = await row(org.manager.id);
    const grade = await testPrisma.jobGrade.findUniqueOrThrow({ where: { id: moved.jobGradeId! } });
    expect(grade.code).toBe("L9");
    expect(grade.departmentId).toBe(org.eng.id);
  });

  it("clears a sub-division that belongs to the old department", async () => {
    const org = await buildOrg();
    const family = await testPrisma.jobFamily.create({
      data: { companyId: org.company.id, departmentId: org.cds.id, name: "Product", code: "PROD" },
    });
    await testPrisma.position.update({
      where: { id: org.analyst.id },
      data: { jobFamilyId: family.id },
    });

    await movePositionToDepartment({
      companyId: org.company.id,
      positionId: org.manager.id,
      departmentId: org.eng.id,
    });

    expect((await row(org.analyst.id)).jobFamilyId).toBeNull();
  });

  it("refuses to move the company root", async () => {
    const org = await buildOrg();
    await expect(
      movePositionToDepartment({
        companyId: org.company.id,
        positionId: org.ceo.id,
        departmentId: org.eng.id,
      })
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("never picks the department's head from inside the branch being moved", async () => {
    // CTO's branch (Lead, Dev) sits entirely in Engineering. Dropping CCO's
    // branch into Engineering must pick CTO; and when CTO itself is dropped
    // onto CDS, the head is CCO, never one of CTO's own reports.
    const org = await buildOrg();
    const result = await movePositionToDepartment({
      companyId: org.company.id,
      positionId: org.cto.id,
      departmentId: org.cds.id,
    });
    expect(result.newHeadPositionId).toBe(org.cco.id);
    expect((await row(org.lead.id)).primaryReportsToPositionId).toBe(org.cto.id);
    expect((await row(org.dev.id)).departmentId).toBe(org.cds.id);
    await expectNoViolations(org.company.id);
  });

  it("refuses a move that would put a position under its own second-head descendant", async () => {
    const org = await buildOrg();
    // A Engineering position (Dev) also reports to Manager (second head). Drop
    // Manager onto Engineering after making Dev the ONLY Engineering member
    // outside Manager's head-1 branch… Dev is below Manager through its
    // second head, so reporting to Dev would be a cycle.
    await testPrisma.position.update({
      where: { id: org.dev.id },
      data: {
        primaryReportsToPositionId: org.ceo.id,
        coReportsToPositionId: org.manager.id,
        organizationalLevel: 4,
      },
    });
    await testPrisma.position.deleteMany({ where: { id: { in: [org.lead.id] } } });
    await testPrisma.position.deleteMany({ where: { id: { in: [org.cto.id] } } });

    await expect(
      movePositionToDepartment({
        companyId: org.company.id,
        positionId: org.manager.id,
        departmentId: org.eng.id,
      })
    ).rejects.toBeInstanceOf(CycleError);

    const manager = await row(org.manager.id);
    expect(manager.primaryReportsToPositionId).toBe(org.cco.id);
    expect(manager.departmentId).toBe(org.cds.id);
  });

  it("is a no-op for a position already heading that department", async () => {
    const org = await buildOrg();
    const result = await movePositionToDepartment({
      companyId: org.company.id,
      positionId: org.cto.id,
      departmentId: org.eng.id,
    });
    expect(result.departmentChangedCount).toBe(0);
    expect((await row(org.cto.id)).primaryReportsToPositionId).toBe(org.ceo.id);
  });

  it("records a HIERARCHY event for the move and a POSITION event per department change", async () => {
    const org = await buildOrg();
    await movePositionToDepartment({
      companyId: org.company.id,
      positionId: org.manager.id,
      departmentId: org.eng.id,
    });
    const events = await testPrisma.auditEvent.findMany({ where: { companyId: org.company.id } });
    expect(events.filter((e) => e.category === "HIERARCHY")).toHaveLength(1);
    expect(events.filter((e) => e.category === "POSITION" && e.action === "UPDATED")).toHaveLength(
      2
    );
  });
});
