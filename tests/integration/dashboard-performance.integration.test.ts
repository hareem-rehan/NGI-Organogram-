import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { getDashboardSummary } from "@/lib/services/dashboard.service";
import { testPrisma } from "./setup";
import { makeCompany } from "./fixtures";

/**
 * Diagnostic-only performance check at the ~1,000-position representative
 * scale from docs/DECISIONS.md P7 — measures actual timing against a
 * synthetic dataset with deep AND wide hierarchy, mixed
 * occupied/vacant/planned positions, and historical assignments. Records
 * real numbers; does not claim an unverified production SLA
 * (docs/TEST_STRATEGY.md §11). Uses bulk `createMany` inserts (not one
 * row at a time) purely so this test itself completes quickly — this is
 * test-data setup, not the code path being measured.
 */
describe("Dashboard performance (diagnostic, ~1,000+ positions)", () => {
  it("computes the full dashboard summary for a large, deep-and-wide organization within a generous diagnostic threshold", async () => {
    const company = await makeCompany();

    const departmentCount = 15;
    const departments = Array.from({ length: departmentCount }, () => ({
      id: randomUUID(),
      companyId: company.id,
      name: `Dept ${randomUUID().slice(0, 8)}`,
      code: `D-${randomUUID().slice(0, 8).toUpperCase()}`,
    }));
    await testPrisma.department.createMany({ data: departments });

    // Build a deep-and-wide tree: a root, then a wide layer of ~30
    // managers, then deep chains of individual contributors under each
    // (targeting >1,000 total positions, per docs/DECISIONS.md P7).
    type PositionSeed = {
      id: string;
      companyId: string;
      departmentId: string;
      title: string;
      positionCode: string;
      status: "PLANNED" | "ACTIVE" | "INACTIVE";
      primaryReportsToPositionId: string | null;
      organizationalLevel: number;
    };
    const positions: PositionSeed[] = [];
    const rootId = randomUUID();
    positions.push({
      id: rootId,
      companyId: company.id,
      departmentId: departments[0]!.id,
      title: "Root",
      positionCode: `POS-ROOT-${randomUUID().slice(0, 8)}`,
      status: "ACTIVE",
      primaryReportsToPositionId: null,
      organizationalLevel: 1,
    });

    const WIDTH = 30;
    const DEPTH = 35;
    let counter = 0;
    for (let branch = 0; branch < WIDTH; branch++) {
      let parentId = rootId;
      for (let level = 0; level < DEPTH; level++) {
        const id = randomUUID();
        counter++;
        positions.push({
          id,
          companyId: company.id,
          departmentId: departments[counter % departmentCount]!.id,
          title: `Position ${counter}`,
          positionCode: `POS-${counter}-${randomUUID().slice(0, 6)}`,
          status: counter % 47 === 0 ? "PLANNED" : counter % 91 === 0 ? "INACTIVE" : "ACTIVE",
          primaryReportsToPositionId: parentId,
          organizationalLevel: level + 2,
        });
        parentId = id;
      }
    }
    expect(positions.length).toBeGreaterThan(1000);
    await testPrisma.position.createMany({ data: positions });

    const activePositions = positions.filter((p) => p.status === "ACTIVE");
    const employees = activePositions.slice(0, 500).map((_, i) => ({
      id: randomUUID(),
      companyId: company.id,
      employeeCode: `EMP-${i}-${randomUUID().slice(0, 6)}`,
      firstName: "Perf",
      lastName: `Test${i}`,
    }));
    await testPrisma.employee.createMany({ data: employees });

    const assignments = employees.map((employee, i) => ({
      id: randomUUID(),
      companyId: company.id,
      employeeId: employee.id,
      positionId: activePositions[i]!.id,
      isPrimary: true,
      startDate: new Date("2020-01-01"),
      // Every third assignment is historical (ended) rather than current,
      // for a realistic mix.
      endDate: i % 3 === 0 ? new Date("2021-01-01") : null,
    }));
    await testPrisma.positionAssignment.createMany({ data: assignments });

    const start = performance.now();
    const summary = await getDashboardSummary({
      companyId: company.id,
      canSeeManagementDetails: true,
    });
    const durationMs = performance.now() - start;

    console.log(
      `[dashboard-performance] ${positions.length} positions, ${employees.length} employees, ${assignments.length} assignments -> getDashboardSummary in ${durationMs.toFixed(0)}ms`
    );

    expect(summary.positions.totalActive).toBe(activePositions.length);
    expect(summary.positions.maxLevel).toBe(DEPTH + 1);
    expect(summary.departments.totalActive).toBe(departmentCount);
    // Generous diagnostic ceiling — not a production SLA, just a guard
    // against an accidental N+1/quadratic regression going unnoticed.
    expect(durationMs).toBeLessThan(8000);
  });
});
