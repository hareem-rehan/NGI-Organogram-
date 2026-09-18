import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import {
  createAssignment,
  endAssignment,
  transferEmployee,
} from "@/lib/services/assignment.service";
import {
  changeEmployeeStatus,
  createEmployee,
  terminateEmployee,
  updateEmployee,
} from "@/lib/services/employee.service";
import { isVacantOnDate } from "@/lib/domain/assignment";
import {
  ConflictError,
  CrossCompanyError,
  DomainValidationError,
  NotFoundError,
  UnsafeMutationError,
} from "@/lib/domain/errors";
import { getActivePrimaryAssignmentForPosition } from "@/lib/repositories/assignment.repository";
import {
  listCurrentAssignmentsForEmployees,
  searchEmployees,
} from "@/lib/repositories/employee.repository";
import { testPrisma } from "./setup";
import {
  makeChildPosition,
  makeCompany,
  makeDepartment,
  makeEmployee,
  makeRootPosition,
} from "./fixtures";

describe("Employee", () => {
  it("creates a valid employee", async () => {
    const company = await makeCompany();
    const employee = await makeEmployee(company.id, { workEmail: "Jane.Doe@Example.TEST" });
    expect(employee.employmentStatus).toBe("ACTIVE");
  });

  it("rejects a duplicate employee code within a company", async () => {
    const company = await makeCompany();
    await makeEmployee(company.id, { employeeCode: "E1" });
    await expect(makeEmployee(company.id, { employeeCode: "E1" })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError
    );
  });

  it("allows multiple employees with no work email (nulls are not duplicates)", async () => {
    const company = await makeCompany();
    await expect(makeEmployee(company.id, { workEmail: null })).resolves.toBeDefined();
    await expect(makeEmployee(company.id, { workEmail: null })).resolves.toBeDefined();
  });

  it("allows an employee to exist without any position assignment", async () => {
    const company = await makeCompany();
    const employee = await makeEmployee(company.id);
    const assignment = await getActivePrimaryAssignmentForPosition(
      "00000000-0000-0000-0000-000000000000",
      company.id
    );
    expect(assignment).toBeNull();
    expect(employee.id).toBeDefined();
  });
});

describe("Position vacancy", () => {
  it("a position with no assignment is vacant", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const active = await getActivePrimaryAssignmentForPosition(position.id, company.id);
    expect(active).toBeNull();
  });

  it("a position with an active open-ended assignment is occupied", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const employee = await makeEmployee(company.id);
    await createAssignment({
      companyId: company.id,
      employeeId: employee.id,
      positionId: position.id,
      startDate: new Date("2023-01-01"),
    });
    const active = await getActivePrimaryAssignmentForPosition(position.id, company.id);
    expect(active).not.toBeNull();
  });

  it("remains after the employee's assignment ends (does not disappear)", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const employee = await makeEmployee(company.id);
    const assignment = await createAssignment({
      companyId: company.id,
      employeeId: employee.id,
      positionId: position.id,
      startDate: new Date("2023-01-01"),
    });
    await endAssignment(assignment.id, company.id, new Date("2023-06-01"));

    const stillThere = await testPrisma.position.findUnique({ where: { id: position.id } });
    expect(stillThere).not.toBeNull();
    const active = await getActivePrimaryAssignmentForPosition(position.id, company.id);
    expect(active).toBeNull(); // vacant again, but the position row itself persists
  });

  it("isVacantOnDate correctly evaluates a specific historical date", () => {
    const range = { startDate: new Date("2023-01-01"), endDate: new Date("2023-06-01") };
    expect(isVacantOnDate([range], new Date("2023-03-01"))).toBe(false);
    expect(isVacantOnDate([range], new Date("2023-07-01"))).toBe(true);
    expect(isVacantOnDate([range], new Date("2022-12-01"))).toBe(true);
  });
});

describe("Position assignment", () => {
  it("creates a valid assignment", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const employee = await makeEmployee(company.id);
    const assignment = await createAssignment({
      companyId: company.id,
      employeeId: employee.id,
      positionId: position.id,
      startDate: new Date("2023-01-01"),
    });
    expect(assignment.isPrimary).toBe(true);
  });

  it("rejects endDate before startDate", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const employee = await makeEmployee(company.id);
    await expect(
      createAssignment({
        companyId: company.id,
        employeeId: employee.id,
        positionId: position.id,
        startDate: new Date("2023-06-01"),
        endDate: new Date("2023-01-01"),
      })
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("rejects a cross-company assignment", async () => {
    const companyA = await makeCompany();
    const companyB = await makeCompany();
    const dept = await makeDepartment(companyA.id);
    const position = await makeRootPosition(companyA.id, dept.id);
    const employeeInB = await makeEmployee(companyB.id);
    await expect(
      createAssignment({
        companyId: companyA.id,
        employeeId: employeeInB.id,
        positionId: position.id,
        startDate: new Date("2023-01-01"),
      })
    ).rejects.toBeInstanceOf(CrossCompanyError);
  });

  it("rejects assigning a TERMINATED employee to a position (Phase 6)", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const employee = await makeEmployee(company.id);
    await testPrisma.employee.update({
      where: { id: employee.id },
      data: { employmentStatus: "TERMINATED" },
    });
    await expect(
      createAssignment({
        companyId: company.id,
        employeeId: employee.id,
        positionId: position.id,
        startDate: new Date("2023-01-01"),
      })
    ).rejects.toBeInstanceOf(UnsafeMutationError);
  });

  it("rejects assigning a TRANSFERRED employee to a position (Phase 6)", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const employee = await makeEmployee(company.id);
    await testPrisma.employee.update({
      where: { id: employee.id },
      data: { employmentStatus: "TRANSFERRED" },
    });
    await expect(
      createAssignment({
        companyId: company.id,
        employeeId: employee.id,
        positionId: position.id,
        startDate: new Date("2023-01-01"),
      })
    ).rejects.toBeInstanceOf(UnsafeMutationError);
  });

  it("rejects assigning to an INACTIVE position (Phase 6)", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    await testPrisma.position.update({ where: { id: position.id }, data: { status: "INACTIVE" } });
    const employee = await makeEmployee(company.id);
    await expect(
      createAssignment({
        companyId: company.id,
        employeeId: employee.id,
        positionId: position.id,
        startDate: new Date("2023-01-01"),
      })
    ).rejects.toBeInstanceOf(UnsafeMutationError);
  });

  it("allows assigning to a PLANNED position (future hiring is a legitimate use case)", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    await testPrisma.position.update({ where: { id: position.id }, data: { status: "PLANNED" } });
    const employee = await makeEmployee(company.id);
    const assignment = await createAssignment({
      companyId: company.id,
      employeeId: employee.id,
      positionId: position.id,
      startDate: new Date("2023-01-01"),
    });
    expect(assignment.isPrimary).toBe(true);
  });

  it("rejects transferring into a position that has since become INACTIVE (Phase 6)", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const fromPosition = await makeRootPosition(company.id, dept.id, { positionCode: "FROM" });
    const toPosition = await makeChildPosition(company.id, dept.id, fromPosition.id, 1, {
      positionCode: "TO",
    });
    await testPrisma.position.update({
      where: { id: toPosition.id },
      data: { status: "INACTIVE" },
    });
    const employee = await makeEmployee(company.id);
    const assignment = await createAssignment({
      companyId: company.id,
      employeeId: employee.id,
      positionId: fromPosition.id,
      startDate: new Date("2023-01-01"),
    });
    await expect(
      transferEmployee({
        companyId: company.id,
        employeeId: employee.id,
        fromAssignmentId: assignment.id,
        toPositionId: toPosition.id,
        transferDate: new Date("2023-06-01"),
      })
    ).rejects.toBeInstanceOf(UnsafeMutationError);
  });

  it("rejects transferring an employee who was terminated after their current assignment started (concurrent termination)", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const fromPosition = await makeRootPosition(company.id, dept.id, { positionCode: "FROM2" });
    const toPosition = await makeChildPosition(company.id, dept.id, fromPosition.id, 1, {
      positionCode: "TO2",
    });
    const employee = await makeEmployee(company.id);
    const assignment = await createAssignment({
      companyId: company.id,
      employeeId: employee.id,
      positionId: fromPosition.id,
      startDate: new Date("2023-01-01"),
    });
    await testPrisma.employee.update({
      where: { id: employee.id },
      data: { employmentStatus: "TERMINATED" },
    });
    await expect(
      transferEmployee({
        companyId: company.id,
        employeeId: employee.id,
        fromAssignmentId: assignment.id,
        toPositionId: toPosition.id,
        transferDate: new Date("2023-06-01"),
      })
    ).rejects.toBeInstanceOf(UnsafeMutationError);
  });

  it("rejects two active primary occupants for one position", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const employee1 = await makeEmployee(company.id);
    const employee2 = await makeEmployee(company.id);
    await createAssignment({
      companyId: company.id,
      employeeId: employee1.id,
      positionId: position.id,
      startDate: new Date("2023-01-01"),
    });
    await expect(
      createAssignment({
        companyId: company.id,
        employeeId: employee2.id,
        positionId: position.id,
        startDate: new Date("2023-02-01"),
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects one employee holding two active primary positions", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const positionA = await makeRootPosition(company.id, dept.id, { positionCode: "POS-A" });
    const positionB = await testPrisma.position.create({
      data: {
        companyId: company.id,
        departmentId: dept.id,
        title: "Sibling Position",
        positionCode: "POS-B",
        primaryReportsToPositionId: positionA.id,
        organizationalLevel: 2,
      },
    });
    const employee = await makeEmployee(company.id);
    await createAssignment({
      companyId: company.id,
      employeeId: employee.id,
      positionId: positionA.id,
      startDate: new Date("2023-01-01"),
    });
    await expect(
      createAssignment({
        companyId: company.id,
        employeeId: employee.id,
        positionId: positionB.id,
        startDate: new Date("2023-02-01"),
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("allows historical non-overlapping assignments for the same position", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const employee1 = await makeEmployee(company.id);
    const employee2 = await makeEmployee(company.id);
    await createAssignment({
      companyId: company.id,
      employeeId: employee1.id,
      positionId: position.id,
      startDate: new Date("2020-01-01"),
      endDate: new Date("2022-12-31"),
    });
    await expect(
      createAssignment({
        companyId: company.id,
        employeeId: employee2.id,
        positionId: position.id,
        startDate: new Date("2023-01-01"),
      })
    ).resolves.toBeDefined();
  });

  it("rejects overlapping historical assignment date ranges", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const employee1 = await makeEmployee(company.id);
    const employee2 = await makeEmployee(company.id);
    await createAssignment({
      companyId: company.id,
      employeeId: employee1.id,
      positionId: position.id,
      startDate: new Date("2020-01-01"),
      endDate: new Date("2022-12-31"),
    });
    await expect(
      createAssignment({
        companyId: company.id,
        employeeId: employee2.id,
        positionId: position.id,
        startDate: new Date("2022-06-01"),
        endDate: new Date("2023-01-01"),
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("allows a same-day handoff — a new assignment starting the exact day an old one there ended (Phase 6 regression)", async () => {
    // Regression test for a bug found via e2e/employees.spec.ts: the
    // position becomes vacant "from the end date forward" per the End
    // Assignment dialog's own copy, and lib/repositories/employee.repository.ts's
    // listCurrentAssignmentsForEmployees already treats endDate as
    // exclusive (endDate > onDate). dateRangesOverlap previously used
    // inclusive bounds on both sides, so a same-day handoff was
    // incorrectly rejected as an overlap — see lib/domain/assignment.ts.
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const employee1 = await makeEmployee(company.id);
    const employee2 = await makeEmployee(company.id);
    await createAssignment({
      companyId: company.id,
      employeeId: employee1.id,
      positionId: position.id,
      startDate: new Date("2023-01-01"),
      endDate: new Date("2023-06-01"),
    });
    await expect(
      createAssignment({
        companyId: company.id,
        employeeId: employee2.id,
        positionId: position.id,
        startDate: new Date("2023-06-01"),
      })
    ).resolves.toBeDefined();
  });

  it("still rejects a new assignment starting one day before the previous one ends", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const employee1 = await makeEmployee(company.id);
    const employee2 = await makeEmployee(company.id);
    await createAssignment({
      companyId: company.id,
      employeeId: employee1.id,
      positionId: position.id,
      startDate: new Date("2023-01-01"),
      endDate: new Date("2023-06-01"),
    });
    await expect(
      createAssignment({
        companyId: company.id,
        employeeId: employee2.id,
        positionId: position.id,
        startDate: new Date("2023-05-31"),
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("transfers an employee from one position to another inside a transaction", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const positionA = await makeRootPosition(company.id, dept.id, { positionCode: "POS-A" });
    const positionB = await testPrisma.position.create({
      data: {
        companyId: company.id,
        departmentId: dept.id,
        title: "Sibling Position",
        positionCode: "POS-B",
        primaryReportsToPositionId: positionA.id,
        organizationalLevel: 2,
      },
    });
    const employee = await makeEmployee(company.id);
    const original = await createAssignment({
      companyId: company.id,
      employeeId: employee.id,
      positionId: positionA.id,
      startDate: new Date("2023-01-01"),
    });

    const { ended, started } = await transferEmployee({
      companyId: company.id,
      employeeId: employee.id,
      fromAssignmentId: original.id,
      toPositionId: positionB.id,
      transferDate: new Date("2023-06-01"),
    });

    expect(ended.endDate?.toISOString().slice(0, 10)).toBe("2023-06-01");
    expect(started.positionId).toBe(positionB.id);
    expect(await getActivePrimaryAssignmentForPosition(positionA.id, company.id)).toBeNull();
    expect(await getActivePrimaryAssignmentForPosition(positionB.id, company.id)).not.toBeNull();
  });

  it("rolls back the entire transfer if the destination position already has an active occupant", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const positionA = await makeRootPosition(company.id, dept.id, { positionCode: "POS-A" });
    const positionB = await testPrisma.position.create({
      data: {
        companyId: company.id,
        departmentId: dept.id,
        title: "Sibling Position",
        positionCode: "POS-B",
        primaryReportsToPositionId: positionA.id,
        organizationalLevel: 2,
      },
    });
    const employee = await makeEmployee(company.id);
    const otherEmployee = await makeEmployee(company.id);

    const original = await createAssignment({
      companyId: company.id,
      employeeId: employee.id,
      positionId: positionA.id,
      startDate: new Date("2023-01-01"),
    });
    await createAssignment({
      companyId: company.id,
      employeeId: otherEmployee.id,
      positionId: positionB.id,
      startDate: new Date("2023-01-01"),
    });

    await expect(
      transferEmployee({
        companyId: company.id,
        employeeId: employee.id,
        fromAssignmentId: original.id,
        toPositionId: positionB.id,
        transferDate: new Date("2023-06-01"),
      })
    ).rejects.toBeInstanceOf(ConflictError);

    // Rollback verified: the ORIGINAL assignment must still be open-ended —
    // a failed transfer must never leave the employee with zero active assignments.
    const stillOriginal = await testPrisma.positionAssignment.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(stillOriginal.endDate).toBeNull();
  });

  it("rejects ending an assignment that does not exist", async () => {
    const company = await makeCompany();
    await expect(
      endAssignment("00000000-0000-0000-0000-000000000000", company.id, new Date())
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("allows exactly one of two concurrent attempts to fill the same position to succeed", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const employee1 = await makeEmployee(company.id);
    const employee2 = await makeEmployee(company.id);

    const results = await Promise.allSettled([
      createAssignment({
        companyId: company.id,
        employeeId: employee1.id,
        positionId: position.id,
        startDate: new Date("2023-01-01"),
      }),
      createAssignment({
        companyId: company.id,
        employeeId: employee2.id,
        positionId: position.id,
        startDate: new Date("2023-01-01"),
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const finalAssignments = await testPrisma.positionAssignment.findMany({
      where: { positionId: position.id, endDate: null },
    });
    expect(finalAssignments).toHaveLength(1);
  });
});

describe("Employee service (Phase 6)", () => {
  describe("createEmployee", () => {
    it("creates a valid employee with normalized code and email", async () => {
      const company = await makeCompany();
      const employee = await createEmployee({
        companyId: company.id,
        employeeCode: "emp-100",
        firstName: "Amara",
        lastName: "Chen",
        workEmail: "Amara.Chen@Example.TEST",
      });
      expect(employee.employeeCode).toBe("EMP-100");
      expect(employee.workEmail).toBe("amara.chen@example.test");
      expect(employee.employmentStatus).toBe("ACTIVE");
    });

    it("rejects a duplicate employee code with a clean error", async () => {
      const company = await makeCompany();
      await createEmployee({
        companyId: company.id,
        employeeCode: "EMP-1",
        firstName: "A",
        lastName: "B",
      });
      await expect(
        createEmployee({
          companyId: company.id,
          employeeCode: "emp-1",
          firstName: "C",
          lastName: "D",
        })
      ).rejects.toThrow(ConflictError);
    });

    it("rejects a duplicate work email with a clean error", async () => {
      const company = await makeCompany();
      await createEmployee({
        companyId: company.id,
        employeeCode: "EMP-1",
        firstName: "A",
        lastName: "B",
        workEmail: "dup@example.test",
      });
      await expect(
        createEmployee({
          companyId: company.id,
          employeeCode: "EMP-2",
          firstName: "C",
          lastName: "D",
          workEmail: "DUP@Example.test",
        })
      ).rejects.toThrow(ConflictError);
    });

    it("does not create any application User/Account row", async () => {
      const company = await makeCompany();
      const employee = await createEmployee({
        companyId: company.id,
        employeeCode: "EMP-1",
        firstName: "A",
        lastName: "B",
        workEmail: "noaccess@example.test",
      });
      expect(employee).not.toHaveProperty("role");
      const user = await testPrisma.user.findUnique({ where: { email: "noaccess@example.test" } });
      expect(user).toBeNull();
    });
  });

  describe("updateEmployee", () => {
    it("updates name/email fields without touching employmentStatus", async () => {
      const company = await makeCompany();
      const employee = await makeEmployee(company.id);
      const updated = await updateEmployee({
        companyId: company.id,
        employeeId: employee.id,
        firstName: "Renamed",
        workEmail: "renamed@example.test",
      });
      expect(updated.firstName).toBe("Renamed");
      expect(updated.workEmail).toBe("renamed@example.test");
      expect(updated.employmentStatus).toBe("ACTIVE");
    });

    it("rejects updating an employee that does not exist in this company", async () => {
      const company = await makeCompany();
      const other = await makeCompany();
      const employee = await makeEmployee(other.id);
      await expect(
        updateEmployee({ companyId: company.id, employeeId: employee.id, firstName: "Hijacked" })
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("changeEmployeeStatus / terminateEmployee", () => {
    it("changeEmployeeStatus sets employmentStatus directly", async () => {
      const company = await makeCompany();
      const employee = await makeEmployee(company.id);
      const updated = await changeEmployeeStatus(employee.id, company.id, "TRANSFERRED");
      expect(updated.employmentStatus).toBe("TRANSFERRED");
    });

    it("terminateEmployee with no active assignment sets status and leavingDate, ends nothing", async () => {
      const company = await makeCompany();
      const employee = await makeEmployee(company.id);
      const result = await terminateEmployee({
        companyId: company.id,
        employeeId: employee.id,
        terminationDate: new Date("2024-06-01"),
      });
      expect(result.employee.employmentStatus).toBe("TERMINATED");
      expect(result.employee.leavingDate?.toISOString().slice(0, 10)).toBe("2024-06-01");
      expect(result.endedAssignmentId).toBeNull();
    });

    it("terminateEmployee with an active assignment ends it and preserves the position", async () => {
      const company = await makeCompany();
      const dept = await makeDepartment(company.id);
      const position = await makeRootPosition(company.id, dept.id);
      const employee = await makeEmployee(company.id);
      const assignment = await createAssignment({
        companyId: company.id,
        employeeId: employee.id,
        positionId: position.id,
        startDate: new Date("2023-01-01"),
      });

      const result = await terminateEmployee({
        companyId: company.id,
        employeeId: employee.id,
        terminationDate: new Date("2024-06-01"),
      });

      expect(result.endedAssignmentId).toBe(assignment.id);
      const endedAssignment = await testPrisma.positionAssignment.findUniqueOrThrow({
        where: { id: assignment.id },
      });
      expect(endedAssignment.endDate?.toISOString().slice(0, 10)).toBe("2024-06-01");

      const stillExistingPosition = await testPrisma.position.findUnique({
        where: { id: position.id },
      });
      expect(stillExistingPosition).not.toBeNull();

      const activeNow = await getActivePrimaryAssignmentForPosition(position.id, company.id);
      expect(activeNow).toBeNull();
    });

    it("rejects terminating an already-terminated employee (repeated termination)", async () => {
      const company = await makeCompany();
      const employee = await makeEmployee(company.id);
      await terminateEmployee({
        companyId: company.id,
        employeeId: employee.id,
        terminationDate: new Date("2024-01-01"),
      });
      await expect(
        terminateEmployee({
          companyId: company.id,
          employeeId: employee.id,
          terminationDate: new Date("2024-06-01"),
        })
      ).rejects.toBeInstanceOf(DomainValidationError);
    });

    it("rejects a termination date before the active assignment's start date", async () => {
      const company = await makeCompany();
      const dept = await makeDepartment(company.id);
      const position = await makeRootPosition(company.id, dept.id);
      const employee = await makeEmployee(company.id);
      await createAssignment({
        companyId: company.id,
        employeeId: employee.id,
        positionId: position.id,
        startDate: new Date("2023-06-01"),
      });
      await expect(
        terminateEmployee({
          companyId: company.id,
          employeeId: employee.id,
          terminationDate: new Date("2023-01-01"),
        })
      ).rejects.toBeInstanceOf(DomainValidationError);
    });

    it("a terminated employee cannot be reassigned to a position", async () => {
      const company = await makeCompany();
      const dept = await makeDepartment(company.id);
      const position = await makeRootPosition(company.id, dept.id);
      const employee = await makeEmployee(company.id);
      await terminateEmployee({
        companyId: company.id,
        employeeId: employee.id,
        terminationDate: new Date("2024-01-01"),
      });
      await expect(
        createAssignment({
          companyId: company.id,
          employeeId: employee.id,
          positionId: position.id,
          startDate: new Date("2024-06-01"),
        })
      ).rejects.toBeInstanceOf(UnsafeMutationError);
    });
  });
});

describe("Employee search and derived assignment info (Phase 6)", () => {
  it("scopes results to the requesting company only", async () => {
    const company = await makeCompany();
    const other = await makeCompany();
    await makeEmployee(company.id, { employeeCode: "MINE" });
    await makeEmployee(other.id, { employeeCode: "THEIRS" });

    const result = await searchEmployees({ companyId: company.id, page: 1, pageSize: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.employeeCode).toBe("MINE");
  });

  it("includes unassigned employees by default (never silently excluded)", async () => {
    const company = await makeCompany();
    await makeEmployee(company.id);
    const result = await searchEmployees({ companyId: company.id, page: 1, pageSize: 20 });
    expect(result.totalCount).toBe(1);
  });

  it("filters by assigned/unassigned", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const assignedEmployee = await makeEmployee(company.id, { employeeCode: "ASSIGNED" });
    const unassignedEmployee = await makeEmployee(company.id, { employeeCode: "UNASSIGNED" });
    await createAssignment({
      companyId: company.id,
      employeeId: assignedEmployee.id,
      positionId: position.id,
      startDate: new Date("2023-01-01"),
    });

    const assignedOnly = await searchEmployees({
      companyId: company.id,
      assignment: "assigned",
      page: 1,
      pageSize: 20,
    });
    expect(assignedOnly.items.map((e) => e.id)).toEqual([assignedEmployee.id]);

    const unassignedOnly = await searchEmployees({
      companyId: company.id,
      assignment: "unassigned",
      page: 1,
      pageSize: 20,
    });
    expect(unassignedOnly.items.map((e) => e.id)).toEqual([unassignedEmployee.id]);
  });

  it("filters by employment status, including a TERMINATED filter", async () => {
    const company = await makeCompany();
    const active = await makeEmployee(company.id, { employeeCode: "ACTIVE1" });
    const terminated = await makeEmployee(company.id, { employeeCode: "TERM1" });
    await terminateEmployee({
      companyId: company.id,
      employeeId: terminated.id,
      terminationDate: new Date("2024-01-01"),
    });

    const result = await searchEmployees({
      companyId: company.id,
      status: "TERMINATED",
      page: 1,
      pageSize: 20,
    });
    expect(result.items.map((e) => e.id)).toEqual([terminated.id]);
    expect(active).toBeTruthy();
  });

  it("filters by search across name, code, and email", async () => {
    const company = await makeCompany();
    await makeEmployee(company.id, {
      employeeCode: "SEARCHME",
      firstName: "Zsofia",
      lastName: "Nagy",
      workEmail: "zsofia@example.test",
    });
    const byCode = await searchEmployees({
      companyId: company.id,
      search: "searchme",
      page: 1,
      pageSize: 20,
    });
    expect(byCode.totalCount).toBe(1);
    const byName = await searchEmployees({
      companyId: company.id,
      search: "zsofia",
      page: 1,
      pageSize: 20,
    });
    expect(byName.totalCount).toBe(1);
  });

  it("listCurrentAssignmentsForEmployees returns effective-date-correct current positions in bulk", async () => {
    const company = await makeCompany();
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id);
    const assignedEmployee = await makeEmployee(company.id);
    const unassignedEmployee = await makeEmployee(company.id);
    await createAssignment({
      companyId: company.id,
      employeeId: assignedEmployee.id,
      positionId: position.id,
      startDate: new Date("2023-01-01"),
    });

    const map = await listCurrentAssignmentsForEmployees(
      [assignedEmployee.id, unassignedEmployee.id],
      company.id,
      new Date()
    );
    expect(map.get(assignedEmployee.id)?.position.id).toBe(position.id);
    expect(map.has(unassignedEmployee.id)).toBe(false);
  });
});
