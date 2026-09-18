import { describe, expect, it } from "vitest";

import {
  createPositionSchema,
  listPositionsQuerySchema,
  movePositionSchema,
  updatePositionSchema,
} from "./position";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const VALID_UUID_2 = "22222222-2222-4222-8222-222222222222";

const VALID_CREATE = {
  title: "Engineering Manager",
  positionCode: "POS-ENGMGR",
  departmentId: VALID_UUID,
};

describe("createPositionSchema", () => {
  it("accepts a minimal valid payload", () => {
    expect(createPositionSchema.safeParse(VALID_CREATE).success).toBe(true);
  });

  it("accepts a full valid payload including a Reports-To position", () => {
    const result = createPositionSchema.safeParse({
      ...VALID_CREATE,
      jobGradeId: VALID_UUID_2,
      description: "Leads the platform team",
      location: "Remote",
      primaryReportsToPositionId: VALID_UUID_2,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a null primaryReportsToPositionId (root position)", () => {
    const result = createPositionSchema.safeParse({
      ...VALID_CREATE,
      primaryReportsToPositionId: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing title", () => {
    expect(
      createPositionSchema.safeParse({ positionCode: "POS-X", departmentId: VALID_UUID }).success
    ).toBe(false);
  });

  it("rejects a whitespace-only title", () => {
    expect(createPositionSchema.safeParse({ ...VALID_CREATE, title: "   " }).success).toBe(false);
  });

  it("rejects a title over 150 characters", () => {
    expect(
      createPositionSchema.safeParse({ ...VALID_CREATE, title: "a".repeat(151) }).success
    ).toBe(false);
  });

  it("rejects a missing departmentId", () => {
    const result = createPositionSchema.safeParse({ title: "X", positionCode: "POS-X" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID departmentId", () => {
    expect(
      createPositionSchema.safeParse({ ...VALID_CREATE, departmentId: "not-a-uuid" }).success
    ).toBe(false);
  });

  it("rejects an attempted organizationalLevel submission (unknown field)", () => {
    expect(
      createPositionSchema.safeParse({ ...VALID_CREATE, organizationalLevel: 3 }).success
    ).toBe(false);
  });

  it("rejects an attempted companyId submission (unknown field)", () => {
    expect(
      createPositionSchema.safeParse({ ...VALID_CREATE, companyId: "attacker-company" }).success
    ).toBe(false);
  });

  it("rejects a malformed payload (wrong types)", () => {
    expect(createPositionSchema.safeParse({ title: 1, positionCode: null }).success).toBe(false);
  });
});

describe("updatePositionSchema", () => {
  it("requires positionId", () => {
    expect(updatePositionSchema.safeParse({ title: "New Title" }).success).toBe(false);
  });

  it("allows a partial update", () => {
    const result = updatePositionSchema.safeParse({ positionId: VALID_UUID, title: "New Title" });
    expect(result.success).toBe(true);
  });

  it("rejects an attempted primaryReportsToPositionId submission (unknown field — use movePositionSchema instead)", () => {
    const result = updatePositionSchema.safeParse({
      positionId: VALID_UUID,
      primaryReportsToPositionId: VALID_UUID_2,
    });
    expect(result.success).toBe(false);
  });
});

describe("movePositionSchema", () => {
  it("accepts a null newParentPositionId (moving to root)", () => {
    const result = movePositionSchema.safeParse({
      positionId: VALID_UUID,
      newParentPositionId: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing newParentPositionId key entirely", () => {
    expect(movePositionSchema.safeParse({ positionId: VALID_UUID }).success).toBe(false);
  });
});

describe("listPositionsQuerySchema", () => {
  it("defaults page/pageSize when omitted", () => {
    const result = listPositionsQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it("rejects a status value outside the enum", () => {
    expect(listPositionsQuerySchema.safeParse({ status: "FILLED" }).success).toBe(false);
  });

  it("rejects excessively long search input", () => {
    expect(listPositionsQuerySchema.safeParse({ search: "a".repeat(200) }).success).toBe(false);
  });

  it("falls back to the safe default for an excessive pageSize", () => {
    expect(listPositionsQuerySchema.parse({ pageSize: "999999" }).pageSize).toBe(20);
  });

  it("accepts a valid occupancy filter value", () => {
    expect(listPositionsQuerySchema.safeParse({ occupancy: "vacant" }).success).toBe(true);
    expect(listPositionsQuerySchema.safeParse({ occupancy: "occupied" }).success).toBe(true);
  });

  it("rejects an occupancy value outside the enum (Phase 7 dashboard deep-link parameter)", () => {
    expect(listPositionsQuerySchema.safeParse({ occupancy: "FILLED" }).success).toBe(false);
  });
});
