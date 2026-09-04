import { describe, expect, it } from "vitest";

import { assertSeedAllowed, runSeed } from "../../prisma/seed";
import { testPrisma } from "./setup";

describe("Seed", () => {
  it("blocks running when NODE_ENV looks production-like or is unset", () => {
    expect(() => assertSeedAllowed("production")).toThrow(/development.*test/);
    // Passing the literal string "" (not `undefined`) so JS default-parameter
    // substitution doesn't silently fall back to the real process.env.NODE_ENV.
    expect(() => assertSeedAllowed("")).toThrow();
  });

  it("allows development and test environments", () => {
    expect(() => assertSeedAllowed("development")).not.toThrow();
    expect(() => assertSeedAllowed("test")).not.toThrow();
  });

  it("completes successfully and produces a valid, connected hierarchy", async () => {
    const result = await runSeed(testPrisma);

    const positions = await testPrisma.position.findMany({
      where: { companyId: result.company.id },
    });
    const roots = positions.filter((p) => p.primaryReportsToPositionId === null);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.organizationalLevel).toBe(1);

    // Every non-root position's parent must exist within the same seeded set.
    const idSet = new Set(positions.map((p) => p.id));
    for (const position of positions) {
      if (position.primaryReportsToPositionId !== null) {
        expect(idSet.has(position.primaryReportsToPositionId)).toBe(true);
      }
    }
  });

  it("includes at least one vacant position", async () => {
    const result = await runSeed(testPrisma);
    const activeAssignments = await testPrisma.positionAssignment.findMany({
      where: { companyId: result.company.id, isPrimary: true, endDate: null },
    });
    const occupiedPositionIds = new Set(activeAssignments.map((a) => a.positionId));
    const activePositions = await testPrisma.position.findMany({
      where: { companyId: result.company.id, status: "ACTIVE" },
    });
    const vacant = activePositions.filter((p) => !occupiedPositionIds.has(p.id));
    expect(vacant.length).toBeGreaterThan(0);
  });

  it("includes at least one planned position", async () => {
    const result = await runSeed(testPrisma);
    const planned = await testPrisma.position.findMany({
      where: { companyId: result.company.id, status: "PLANNED" },
    });
    expect(planned.length).toBeGreaterThan(0);
  });

  it("includes at least one historical (ended) assignment", async () => {
    const result = await runSeed(testPrisma);
    const ended = await testPrisma.positionAssignment.findMany({
      where: { companyId: result.company.id, endDate: { not: null } },
    });
    expect(ended.length).toBeGreaterThan(0);
  });

  it("includes a nested department", async () => {
    const result = await runSeed(testPrisma);
    const nested = await testPrisma.department.findMany({
      where: { companyId: result.company.id, parentDepartmentId: { not: null } },
    });
    expect(nested.length).toBeGreaterThan(0);
  });

  it("can be run more than once without creating duplicates", async () => {
    await runSeed(testPrisma);
    const after1 = await testPrisma.position.count();
    await runSeed(testPrisma);
    const after2 = await testPrisma.position.count();
    expect(after2).toBe(after1);

    const companies = await testPrisma.company.count();
    expect(companies).toBe(1);
  });

  it("contains no fields that look like real production employee data (fictional domain check)", async () => {
    const result = await runSeed(testPrisma);
    const employees = await testPrisma.employee.findMany({
      where: { companyId: result.company.id },
    });
    for (const employee of employees) {
      expect(employee.workEmail).toMatch(/@northwind-example\.test$/);
    }
  });
});
