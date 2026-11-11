import { describe, expect, it } from "vitest";

import {
  changeAssignmentStartDate,
  createAssignment,
  endAssignment,
  removeAssignment,
} from "@/lib/services/assignment.service";
import { ConflictError, NotFoundError, UnsafeMutationError } from "@/lib/domain/errors";
import { testPrisma } from "./setup";
import { makeCompany, makeDepartment, makeEmployee, makeRootPosition } from "./fixtures";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Today as a date-only value, the way assignment dates are stored. */
const today = () => new Date(new Date().toISOString().slice(0, 10));

async function seed() {
  const company = await makeCompany();
  const dept = await makeDepartment(company.id);
  const position = await makeRootPosition(company.id, dept.id, {
    title: "Head of Sales and Startup Ventures",
  });
  const employee = await makeEmployee(company.id, { firstName: "Riley", lastName: "Gonta" });
  return { company, position, employee };
}

describe("Readable assignment overlap errors (D70)", () => {
  it("names the person, the position and the dates, never raw ids", async () => {
    const { company, position, employee } = await seed();
    await createAssignment({
      companyId: company.id,
      employeeId: employee.id,
      positionId: position.id,
      startDate: new Date("2025-06-22"),
      endDate: new Date("2026-11-05"),
    });

    const attempt = createAssignment({
      companyId: company.id,
      employeeId: employee.id,
      positionId: position.id,
      startDate: new Date("2025-06-02"),
    });
    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    const message = await attempt.catch((e: Error) => e.message);
    expect(message).toContain("Riley Gonta already held Head of Sales and Startup Ventures");
    expect(message).toContain("2025-06-22 to 2026-11-05");
    expect(message).toContain("can't start before 2026-11-05");
    expect(message).not.toMatch(UUID);
  });
});

describe("removeAssignment (D70)", () => {
  it("removes a mistaken history row and audits it, leaving the position untouched", async () => {
    const { company, position, employee } = await seed();
    const old = await createAssignment({
      companyId: company.id,
      employeeId: employee.id,
      positionId: position.id,
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-06-01"),
    });

    await removeAssignment(old.id, company.id);

    expect(await testPrisma.positionAssignment.findUnique({ where: { id: old.id } })).toBeNull();
    const after = await testPrisma.position.findUnique({ where: { id: position.id } });
    expect(after).toMatchObject({
      id: position.id,
      positionCode: position.positionCode,
      primaryReportsToPositionId: null,
      organizationalLevel: position.organizationalLevel,
    });
    expect(await testPrisma.employee.findUnique({ where: { id: employee.id } })).not.toBeNull();
    const audit = await testPrisma.auditEvent.findFirst({
      where: { companyId: company.id, entityId: old.id, action: "DELETED" },
    });
    expect(audit?.category).toBe("ASSIGNMENT");
  });

  it("refuses to remove the assignment the employee holds today", async () => {
    const { company, position, employee } = await seed();
    const current = await createAssignment({
      companyId: company.id,
      employeeId: employee.id,
      positionId: position.id,
      startDate: new Date("2024-01-01"),
    });
    await expect(removeAssignment(current.id, company.id)).rejects.toBeInstanceOf(
      UnsafeMutationError
    );
    expect(
      await testPrisma.positionAssignment.findUnique({ where: { id: current.id } })
    ).not.toBeNull();
  });

  it("can remove a future assignment entered by mistake", async () => {
    const { company, position, employee } = await seed();
    const future = await createAssignment({
      companyId: company.id,
      employeeId: employee.id,
      positionId: position.id,
      startDate: new Date("2999-01-01"),
    });
    await expect(removeAssignment(future.id, company.id)).resolves.toBeDefined();
  });

  it("can't touch another company's assignment", async () => {
    const { company, position, employee } = await seed();
    const old = await createAssignment({
      companyId: company.id,
      employeeId: employee.id,
      positionId: position.id,
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-06-01"),
    });
    const other = await makeCompany();
    await expect(removeAssignment(old.id, other.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(
      await testPrisma.positionAssignment.findUnique({ where: { id: old.id } })
    ).not.toBeNull();
  });
});

describe("Fixing Riley's history (client report, 2026-11-11)", () => {
  it("remove the two mistaken rows, then move the current start back to the joining date", async () => {
    const { company, position, employee } = await seed();
    const base = { companyId: company.id, employeeId: employee.id, positionId: position.id };
    // The state on staging: the original assignment ended today, a same-day
    // row, and a new current one from today.
    const original = await createAssignment({ ...base, startDate: new Date("2025-06-22") });
    await endAssignment(original.id, company.id, today());
    const sameDay = await createAssignment({
      ...base,
      startDate: today(),
      endDate: today(),
    });
    const current = await createAssignment({ ...base, startDate: today() });

    // What the client tried: refused, now with a readable reason.
    await expect(
      changeAssignmentStartDate(current.id, company.id, new Date("2025-06-02"))
    ).rejects.toThrow(/Head of Sales and Startup Ventures \(2025-06-22 to /);

    await removeAssignment(original.id, company.id);
    await removeAssignment(sameDay.id, company.id);
    const fixed = await changeAssignmentStartDate(current.id, company.id, new Date("2025-06-02"));

    expect(fixed.startDate.toISOString().slice(0, 10)).toBe("2025-06-02");
    const rows = await testPrisma.positionAssignment.findMany({
      where: { employeeId: employee.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.endDate).toBeNull();
  });
});
