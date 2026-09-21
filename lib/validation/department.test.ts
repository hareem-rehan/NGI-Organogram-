import { describe, expect, it } from "vitest";

import {
  createDepartmentSchema,
  listDepartmentsQuerySchema,
  moveDepartmentSchema,
  updateDepartmentSchema,
} from "./department";

const VALID_CREATE = { name: "Engineering", code: "ENG" };

describe("createDepartmentSchema", () => {
  it("accepts a minimal valid payload", () => {
    expect(createDepartmentSchema.safeParse(VALID_CREATE).success).toBe(true);
  });

  it("accepts a full valid payload", () => {
    const result = createDepartmentSchema.safeParse({
      ...VALID_CREATE,
      description: "Product engineering",
      color: "#16a34a",
      parentDepartmentId: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing name", () => {
    const result = createDepartmentSchema.safeParse({ code: "ENG" });
    expect(result.success).toBe(false);
  });

  it("rejects a whitespace-only name", () => {
    const result = createDepartmentSchema.safeParse({ ...VALID_CREATE, name: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects a name over 150 characters", () => {
    const result = createDepartmentSchema.safeParse({ ...VALID_CREATE, name: "a".repeat(151) });
    expect(result.success).toBe(false);
  });

  it("rejects a code shorter than 2 characters", () => {
    const result = createDepartmentSchema.safeParse({ ...VALID_CREATE, code: "E" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid hex color", () => {
    const result = createDepartmentSchema.safeParse({ ...VALID_CREATE, color: "green" });
    expect(result.success).toBe(false);
  });

  it("rejects a description over 500 characters", () => {
    const result = createDepartmentSchema.safeParse({
      ...VALID_CREATE,
      description: "a".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID parentDepartmentId", () => {
    const result = createDepartmentSchema.safeParse({
      ...VALID_CREATE,
      parentDepartmentId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown field (e.g. an attempted companyId submission)", () => {
    const result = createDepartmentSchema.safeParse({
      ...VALID_CREATE,
      companyId: "attacker-company",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed payload (wrong types)", () => {
    const result = createDepartmentSchema.safeParse({ name: 123, code: null });
    expect(result.success).toBe(false);
  });
});

describe("updateDepartmentSchema", () => {
  it("requires departmentId", () => {
    const result = updateDepartmentSchema.safeParse({ name: "New Name" });
    expect(result.success).toBe(false);
  });

  it("allows a partial update", () => {
    const result = updateDepartmentSchema.safeParse({
      departmentId: "11111111-1111-4111-8111-111111111111",
      name: "New Name",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown field", () => {
    const result = updateDepartmentSchema.safeParse({
      departmentId: "11111111-1111-4111-8111-111111111111",
      parentDepartmentId: "22222222-2222-4222-8222-222222222222",
    });
    expect(result.success).toBe(false);
  });
});

describe("moveDepartmentSchema", () => {
  it("accepts a null parent (moving to top-level)", () => {
    const result = moveDepartmentSchema.safeParse({
      departmentId: "11111111-1111-4111-8111-111111111111",
      newParentDepartmentId: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing newParentDepartmentId key entirely", () => {
    const result = moveDepartmentSchema.safeParse({
      departmentId: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.success).toBe(false);
  });
});

describe("listDepartmentsQuerySchema", () => {
  it("defaults page/pageSize when omitted", () => {
    const result = listDepartmentsQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it("coerces string page/pageSize from query params", () => {
    const result = listDepartmentsQuerySchema.parse({ page: "3", pageSize: "50" });
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(50);
  });

  it("falls back to defaults for an invalid page number instead of throwing", () => {
    const result = listDepartmentsQuerySchema.parse({ page: "-5" });
    expect(result.page).toBe(1);
  });

  it("falls back to the safe default for an excessive pageSize rather than allowing unlimited records", () => {
    const result = listDepartmentsQuerySchema.parse({ pageSize: "999999" });
    expect(result.pageSize).toBe(20);
  });

  it("rejects a status value outside the enum", () => {
    const result = listDepartmentsQuerySchema.safeParse({ status: "DELETED" });
    expect(result.success).toBe(false);
  });

  it("rejects excessively long search input", () => {
    const result = listDepartmentsQuerySchema.safeParse({ search: "a".repeat(200) });
    expect(result.success).toBe(false);
  });
});
