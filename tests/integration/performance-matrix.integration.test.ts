import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { getOrganogramData } from "@/lib/services/organogram.service";
import { getDashboardSummary } from "@/lib/services/dashboard.service";
import { testPrisma } from "./setup";
import { makeCompany } from "./fixtures";

/**
 * Phase 13 Step 14 release-gate performance matrix — 100/500/1,000-position
 * scale across wide (shallow, many siblings), deep (one long chain), and
 * mixed (existing diagnostic files' wide-AND-deep shape) hierarchies.
 *
 * This EXTENDS, not replaces, the existing ~1,051-position diagnostic checks
 * in dashboard-performance.integration.test.ts and
 * organogram-performance.integration.test.ts (those stay as-is). It reuses
 * the same synthetic-fixture generation approach (bulk `createMany`, no
 * `Math.random()`/wall-clock dependence beyond `randomUUID()` for
 * uniqueness) rather than inventing a new one.
 *
 * Thresholds are pre-committed in docs/PERFORMANCE_REPORT.md BEFORE this
 * file was ever run against real numbers — see that file for the full
 * rationale. Do not adjust the thresholds below to make a result pass;
 * fix the report/defect register instead if a threshold is ever revisited.
 */

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

type Shape = "wide" | "deep" | "mixed";

/**
 * Builds a synthetic position tree of exactly (or, for "mixed", at least)
 * `count` positions in the given shape:
 *  - wide: a root plus (count - 1) direct children (depth 2, very shallow,
 *    maximal breadth) — stresses per-level fan-out.
 *  - deep: a single chain of `count` positions (depth == count, breadth 1)
 *    — stresses recursive/ancestor-walk logic and level count.
 *  - mixed: the same wide-AND-deep shape as the existing diagnostic files
 *    (a wide layer of branches, each a deep chain) — stresses both at once.
 */
function buildPositionTree(
  companyId: string,
  departmentIds: string[],
  shape: Shape,
  count: number
): PositionSeed[] {
  const positions: PositionSeed[] = [];
  const rootId = randomUUID();
  let counter = 0;
  const nextStatus = (n: number): "ACTIVE" | "PLANNED" | "INACTIVE" =>
    n % 47 === 0 ? "PLANNED" : n % 91 === 0 ? "INACTIVE" : "ACTIVE";
  const deptFor = (n: number) => departmentIds[n % departmentIds.length]!;

  positions.push({
    id: rootId,
    companyId,
    departmentId: departmentIds[0]!,
    title: "Root",
    positionCode: `POS-ROOT-${randomUUID().slice(0, 8)}`,
    status: "ACTIVE",
    primaryReportsToPositionId: null,
    organizationalLevel: 1,
  });

  if (shape === "wide") {
    for (let i = 1; i < count; i++) {
      counter++;
      positions.push({
        id: randomUUID(),
        companyId,
        departmentId: deptFor(counter),
        title: `Position ${counter}`,
        positionCode: `POS-${counter}-${randomUUID().slice(0, 6)}`,
        status: nextStatus(counter),
        primaryReportsToPositionId: rootId,
        organizationalLevel: 2,
      });
    }
  } else if (shape === "deep") {
    // A handful of very deep chains (as opposed to "mixed"'s many
    // moderate-depth chains) — but capped comfortably under
    // lib/domain/hierarchy.ts's MAX_HIERARCHY_DEPTH (200): a single-chain
    // hierarchy hundreds of levels deep is explicitly treated by this
    // codebase as "disconnected or corrupted hierarchy data, not a
    // legitimately deep org chart" (HierarchyDepthExceededError), so
    // testing beyond that ceiling would be testing an out-of-spec shape
    // this application deliberately refuses to support, not a
    // performance question. DEEP_CAP intentionally stays well under 200
    // to leave headroom below the hard limit.
    const DEEP_CAP = 150;
    const chainCount = Math.max(1, Math.ceil((count - 1) / DEEP_CAP));
    const depthPerChain = Math.ceil((count - 1) / chainCount);
    for (let chain = 0; chain < chainCount; chain++) {
      let parentId = rootId;
      for (let level = 0; level < depthPerChain; level++) {
        counter++;
        const id = randomUUID();
        positions.push({
          id,
          companyId,
          departmentId: deptFor(counter),
          title: `Position ${counter}`,
          positionCode: `POS-${counter}-${randomUUID().slice(0, 6)}`,
          status: nextStatus(counter),
          primaryReportsToPositionId: parentId,
          organizationalLevel: level + 2,
        });
        parentId = id;
      }
    }
  } else {
    // mixed: WIDTH branches, each a chain of DEPTH nodes, sized so
    // WIDTH * DEPTH + 1 (root) is at least `count`.
    const WIDTH = Math.max(2, Math.round(Math.sqrt(count)));
    const DEPTH = Math.max(1, Math.ceil((count - 1) / WIDTH));
    for (let branch = 0; branch < WIDTH; branch++) {
      let parentId = rootId;
      for (let level = 0; level < DEPTH; level++) {
        counter++;
        const id = randomUUID();
        positions.push({
          id,
          companyId,
          departmentId: deptFor(counter),
          title: `Position ${counter}`,
          positionCode: `POS-${counter}-${randomUUID().slice(0, 6)}`,
          status: nextStatus(counter),
          primaryReportsToPositionId: parentId,
          organizationalLevel: level + 2,
        });
        parentId = id;
      }
    }
  }

  return positions;
}

async function seedScenario(shape: Shape, count: number) {
  const company = await makeCompany();
  const departmentCount = 10;
  const departments = Array.from({ length: departmentCount }, () => ({
    id: randomUUID(),
    companyId: company.id,
    name: `Dept ${randomUUID().slice(0, 8)}`,
    code: `D-${randomUUID().slice(0, 8).toUpperCase()}`,
  }));
  await testPrisma.department.createMany({ data: departments });

  const positions = buildPositionTree(
    company.id,
    departments.map((d) => d.id),
    shape,
    count
  );
  await testPrisma.position.createMany({ data: positions });

  const activePositions = positions.filter((p) => p.status === "ACTIVE");
  const employeeTarget = Math.min(activePositions.length, Math.max(1, Math.floor(count / 2)));
  const employees = activePositions.slice(0, employeeTarget).map((_, i) => ({
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

  return { company, positions, employees, assignments };
}

const SCALES = [100, 500, 1000] as const;
const SHAPES: Shape[] = ["wide", "deep", "mixed"];

// Threshold-per-scale (ms), applied identically to organogram assembly and
// dashboard summary — see docs/PERFORMANCE_REPORT.md table rows 1-6.
const THRESHOLD_MS: Record<(typeof SCALES)[number], number> = {
  100: 500,
  500: 1500,
  1000: 3000,
};

describe("Performance matrix — organogram data assembly and dashboard summary (100/500/1,000 x wide/deep/mixed)", () => {
  for (const shape of SHAPES) {
    for (const count of SCALES) {
      it(`assembles the organogram payload for a ${count}-position ${shape} hierarchy within threshold`, async () => {
        const { company, positions } = await seedScenario(shape, count);

        const start = performance.now();
        const data = await getOrganogramData({ companyId: company.id, now: new Date() });
        const durationMs = performance.now() - start;

        console.log(
          `[perf-matrix][organogram][${shape}][${count}] ${positions.length} positions -> ${durationMs.toFixed(0)}ms (threshold ${THRESHOLD_MS[count]}ms)`
        );

        expect(data.nodes.length).toBe(positions.length);
        expect(data.safety).toEqual({
          hasRoot: true,
          extraRootCount: 0,
          cyclePositionCount: 0,
          disconnectedPositionCount: 0,
        });
        expect(durationMs).toBeLessThan(THRESHOLD_MS[count]);
      });

      it(`computes the dashboard summary for a ${count}-position ${shape} hierarchy within threshold`, async () => {
        const { company, positions } = await seedScenario(shape, count);

        const start = performance.now();
        const summary = await getDashboardSummary({
          companyId: company.id,
          canSeeManagementDetails: true,
        });
        const durationMs = performance.now() - start;

        console.log(
          `[perf-matrix][dashboard][${shape}][${count}] ${positions.length} positions -> ${durationMs.toFixed(0)}ms (threshold ${THRESHOLD_MS[count]}ms)`
        );

        const activeCount = positions.filter((p) => p.status === "ACTIVE").length;
        expect(summary.positions.totalActive).toBe(activeCount);
        expect(durationMs).toBeLessThan(THRESHOLD_MS[count]);
      });
    }
  }
});
