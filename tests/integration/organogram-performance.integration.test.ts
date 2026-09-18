import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { getOrganogramData } from "@/lib/services/organogram.service";
import { testPrisma } from "./setup";
import { makeCompany } from "./fixtures";

/**
 * Diagnostic-only performance check at the ~1,000-position representative
 * scale from docs/DECISIONS.md P7 — same synthetic deep-and-wide fixture
 * shape as tests/integration/dashboard-performance.integration.test.ts
 * (Phase 7), reused here for the organogram's own bulk-fetch + pure-graph
 * -building pipeline. Records real numbers; does not claim an unverified
 * production SLA (docs/TEST_STRATEGY.md §11). Bulk `createMany` inserts
 * are test-data setup, not the code path being measured.
 */
describe("Organogram performance (diagnostic, ~1,000+ positions)", () => {
  it("assembles the full organogram payload for a large, deep-and-wide organization within a generous diagnostic threshold", async () => {
    const company = await makeCompany();

    const departmentCount = 15;
    const departments = Array.from({ length: departmentCount }, () => ({
      id: randomUUID(),
      companyId: company.id,
      name: `Dept ${randomUUID().slice(0, 8)}`,
      code: `D-${randomUUID().slice(0, 8).toUpperCase()}`,
    }));
    await testPrisma.department.createMany({ data: departments });

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
      endDate: i % 3 === 0 ? new Date("2021-01-01") : null,
    }));
    await testPrisma.positionAssignment.createMany({ data: assignments });

    const start = performance.now();
    const data = await getOrganogramData({ companyId: company.id, now: new Date() });
    const durationMs = performance.now() - start;

    console.log(
      `[organogram-performance] ${positions.length} positions, ${employees.length} employees, ${assignments.length} assignments -> getOrganogramData in ${durationMs.toFixed(0)}ms`
    );

    expect(data.nodes.length).toBe(positions.length);
    expect(data.safety).toEqual({
      hasRoot: true,
      extraRootCount: 0,
      cyclePositionCount: 0,
      disconnectedPositionCount: 0,
    });
    // Generous diagnostic ceiling — not a production SLA, just a guard
    // against an accidental N+1/quadratic regression going unnoticed.
    expect(durationMs).toBeLessThan(8000);
  });
});
