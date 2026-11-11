import { describe, expect, it } from "vitest";

import {
  changeAssignmentStartDate,
  createAssignment,
  transferEmployee,
} from "@/lib/services/assignment.service";
import { ConflictError, DomainValidationError, NotFoundError } from "@/lib/domain/errors";
import { testPrisma } from "./setup";
import {
  makeChildPosition,
  makeCompany,
  makeDepartment,
  makeEmployee,
  makeRootPosition,
} from "./fixtures";

/** An employee assigned to a root position from 2026-10-02. */
async function seed() {
  const company = await makeCompany();
  const dept = await makeDepartment(company.id);
  const root = await makeRootPosition(company.id, dept.id);
  const employee = await makeEmployee(company.id);
  const assignment = await createAssignment({
    companyId: company.id,
    employeeId: employee.id,
    positionId: root.id,
    startDate: new Date("2026-10-02"),
  });
  return { company, dept, root, employee, assignment };
}

describe("changeAssignmentStartDate (D69)", () => {
  it("moves the start date and records the change in the audit log", async () => {
    const { company, root, assignment } = await seed();

    const updated = await changeAssignmentStartDate(
      assignment.id,
      company.id,
      new Date("2026-09-15")
    );

    expect(updated.startDate.toISOString().slice(0, 10)).toBe("2026-09-15");
    expect(updated.positionId).toBe(root.id);
    expect(updated.endDate).toBeNull();
    const audit = await testPrisma.auditEvent.findFirst({
      where: { companyId: company.id, entityId: assignment.id, action: "UPDATED" },
    });
    expect(audit?.category).toBe("ASSIGNMENT");
  });

  it("refuses a start date after the assignment's end date", async () => {
    const { company, employee, root } = await seed();
    const ended = await createAssignment({
      companyId: company.id,
      employeeId: employee.id,
      positionId: root.id,
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-06-01"),
    });
    await expect(
      changeAssignmentStartDate(ended.id, company.id, new Date("2025-07-01"))
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("refuses a start that would overlap the employee's previous position", async () => {
    const { company, dept, root, employee, assignment } = await seed();
    const child = await makeChildPosition(company.id, dept.id, root.id, root.organizationalLevel);
    const { started } = await transferEmployee({
      companyId: company.id,
      employeeId: employee.id,
      fromAssignmentId: assignment.id,
      toPositionId: child.id,
      transferDate: new Date("2026-11-01"),
    });

    // Earlier than the day the previous assignment ended: two positions at once.
    await expect(
      changeAssignmentStartDate(started.id, company.id, new Date("2026-10-20"))
    ).rejects.toBeInstanceOf(ConflictError);
    // The same day it ended is a clean handoff and is allowed.
    await expect(
      changeAssignmentStartDate(started.id, company.id, new Date("2026-11-01"))
    ).resolves.toBeDefined();
    // Later is fine too.
    const later = await changeAssignmentStartDate(started.id, company.id, new Date("2026-11-05"));
    expect(later.startDate.toISOString().slice(0, 10)).toBe("2026-11-05");
  });

  it("can't touch another company's assignment", async () => {
    const { assignment } = await seed();
    const other = await makeCompany();
    await expect(
      changeAssignmentStartDate(assignment.id, other.id, new Date("2026-09-01"))
    ).rejects.toBeInstanceOf(NotFoundError);
    const unchanged = await testPrisma.positionAssignment.findUnique({
      where: { id: assignment.id },
    });
    expect(unchanged?.startDate.toISOString().slice(0, 10)).toBe("2026-10-02");
  });
});
