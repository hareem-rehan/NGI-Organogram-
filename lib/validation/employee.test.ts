import { describe, expect, it } from "vitest";

import {
  assignEmployeeSchema,
  changeEmployeeStatusSchema,
  createEmployeeSchema,
  endAssignmentSchema,
  listEmployeesQuerySchema,
  terminateEmployeeSchema,
  transferEmployeeSchema,
  updateEmployeeSchema,
} from "./employee";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const VALID_UUID_2 = "22222222-2222-4222-8222-222222222222";
const VALID_CREATE = { employeeCode: "EMP-001", firstName: "Amara", lastName: "Chen" };

describe("createEmployeeSchema", () => {
  it("accepts a minimal valid payload", () => {
    expect(createEmployeeSchema.safeParse(VALID_CREATE).success).toBe(true);
  });

  it("accepts a full valid payload", () => {
    const result = createEmployeeSchema.safeParse({
      ...VALID_CREATE,
      preferredName: "Mimi",
      workEmail: "amara.chen@example.test",
      joiningDate: "2023-01-15",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing employee code", () => {
    expect(createEmployeeSchema.safeParse({ firstName: "A", lastName: "B" }).success).toBe(false);
  });

  it("rejects an employee code shorter than 2 characters", () => {
    expect(createEmployeeSchema.safeParse({ ...VALID_CREATE, employeeCode: "E" }).success).toBe(
      false
    );
  });

  it("rejects a missing first name", () => {
    expect(createEmployeeSchema.safeParse({ employeeCode: "E1", lastName: "B" }).success).toBe(
      false
    );
  });

  it("rejects a missing last name", () => {
    expect(createEmployeeSchema.safeParse({ employeeCode: "E1", firstName: "A" }).success).toBe(
      false
    );
  });

  it("rejects a whitespace-only first name", () => {
    expect(createEmployeeSchema.safeParse({ ...VALID_CREATE, firstName: "   " }).success).toBe(
      false
    );
  });

  it("rejects a first/last name over 100 characters", () => {
    expect(
      createEmployeeSchema.safeParse({ ...VALID_CREATE, firstName: "a".repeat(101) }).success
    ).toBe(false);
  });

  it("rejects a preferred name over 100 characters", () => {
    expect(
      createEmployeeSchema.safeParse({ ...VALID_CREATE, preferredName: "a".repeat(101) }).success
    ).toBe(false);
  });

  it("accepts a valid work email", () => {
    expect(
      createEmployeeSchema.safeParse({ ...VALID_CREATE, workEmail: "a@example.test" }).success
    ).toBe(true);
  });

  it("rejects an invalid work email format", () => {
    expect(
      createEmployeeSchema.safeParse({ ...VALID_CREATE, workEmail: "not-an-email" }).success
    ).toBe(false);
  });

  it("treats an empty-string work email as absent (null), not an error", () => {
    const result = createEmployeeSchema.safeParse({ ...VALID_CREATE, workEmail: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.workEmail).toBeNull();
  });

  it("rejects an invalid joiningDate", () => {
    expect(
      createEmployeeSchema.safeParse({ ...VALID_CREATE, joiningDate: "not-a-date" }).success
    ).toBe(false);
  });

  it("rejects a malformed payload (wrong types)", () => {
    expect(createEmployeeSchema.safeParse({ employeeCode: 1, firstName: null }).success).toBe(
      false
    );
  });

  it("rejects an unknown field (e.g. an attempted companyId submission)", () => {
    expect(
      createEmployeeSchema.safeParse({ ...VALID_CREATE, companyId: "attacker-company" }).success
    ).toBe(false);
  });

  it("rejects an attempted role submission (unknown field)", () => {
    expect(createEmployeeSchema.safeParse({ ...VALID_CREATE, role: "ADMIN" }).success).toBe(false);
  });

  it("rejects an attempted manager/department/organizationalLevel submission (unknown fields)", () => {
    expect(
      createEmployeeSchema.safeParse({
        ...VALID_CREATE,
        managerId: VALID_UUID,
        departmentId: VALID_UUID,
        organizationalLevel: 3,
      }).success
    ).toBe(false);
  });

  it("rejects an attempted employmentStatus submission on create (unknown field — always defaults to ACTIVE)", () => {
    expect(
      createEmployeeSchema.safeParse({ ...VALID_CREATE, employmentStatus: "TERMINATED" }).success
    ).toBe(false);
  });
});

describe("updateEmployeeSchema", () => {
  it("requires employeeId", () => {
    expect(updateEmployeeSchema.safeParse({ firstName: "New" }).success).toBe(false);
  });

  it("allows a partial update", () => {
    expect(
      updateEmployeeSchema.safeParse({ employeeId: VALID_UUID, firstName: "New" }).success
    ).toBe(true);
  });

  it("rejects an attempted employmentStatus submission (unknown field — use changeEmployeeStatusSchema)", () => {
    expect(
      updateEmployeeSchema.safeParse({ employeeId: VALID_UUID, employmentStatus: "TERMINATED" })
        .success
    ).toBe(false);
  });
});

describe("changeEmployeeStatusSchema", () => {
  it("accepts a valid status", () => {
    expect(
      changeEmployeeStatusSchema.safeParse({ employeeId: VALID_UUID, status: "TRANSFERRED" })
        .success
    ).toBe(true);
  });

  it("rejects a status outside the enum", () => {
    expect(
      changeEmployeeStatusSchema.safeParse({ employeeId: VALID_UUID, status: "INACTIVE" }).success
    ).toBe(false);
  });
});

describe("terminateEmployeeSchema", () => {
  it("requires a termination date", () => {
    expect(terminateEmployeeSchema.safeParse({ employeeId: VALID_UUID }).success).toBe(false);
  });

  it("accepts a valid termination date", () => {
    expect(
      terminateEmployeeSchema.safeParse({ employeeId: VALID_UUID, terminationDate: "2024-01-01" })
        .success
    ).toBe(true);
  });
});

describe("assignEmployeeSchema", () => {
  it("requires employeeId, positionId, and startDate", () => {
    expect(assignEmployeeSchema.safeParse({ employeeId: VALID_UUID }).success).toBe(false);
  });

  it("accepts a valid payload", () => {
    expect(
      assignEmployeeSchema.safeParse({
        employeeId: VALID_UUID,
        positionId: VALID_UUID_2,
        startDate: "2024-01-01",
      }).success
    ).toBe(true);
  });
});

describe("transferEmployeeSchema", () => {
  it("requires all four fields", () => {
    expect(
      transferEmployeeSchema.safeParse({ employeeId: VALID_UUID, toPositionId: VALID_UUID_2 })
        .success
    ).toBe(false);
  });

  it("accepts a valid payload", () => {
    expect(
      transferEmployeeSchema.safeParse({
        employeeId: VALID_UUID,
        fromAssignmentId: VALID_UUID_2,
        toPositionId: VALID_UUID,
        transferDate: "2024-01-01",
      }).success
    ).toBe(true);
  });
});

describe("endAssignmentSchema", () => {
  it("requires assignmentId and endDate", () => {
    expect(endAssignmentSchema.safeParse({ assignmentId: VALID_UUID }).success).toBe(false);
  });
});

describe("listEmployeesQuerySchema", () => {
  it("defaults page/pageSize when omitted", () => {
    const result = listEmployeesQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it("rejects an assignment filter value outside the enum", () => {
    expect(listEmployeesQuerySchema.safeParse({ assignment: "half-assigned" }).success).toBe(false);
  });

  it("rejects a status filter value outside the enum", () => {
    expect(listEmployeesQuerySchema.safeParse({ status: "INACTIVE" }).success).toBe(false);
  });

  it("rejects excessively long search input", () => {
    expect(listEmployeesQuerySchema.safeParse({ search: "a".repeat(200) }).success).toBe(false);
  });

  it("falls back to the safe default for an excessive pageSize", () => {
    expect(listEmployeesQuerySchema.parse({ pageSize: "999999" }).pageSize).toBe(20);
  });
});
