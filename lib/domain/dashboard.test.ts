import { describe, expect, it } from "vitest";

import {
  buildLevelDistribution,
  calculateVacancyRate,
  detectHierarchyIntegrityWarnings,
  findMaxLevel,
} from "./dashboard";

describe("calculateVacancyRate", () => {
  it("computes a normal rate", () => {
    expect(calculateVacancyRate(3, 12)).toEqual({ vacantCount: 3, eligibleCount: 12, percent: 25 });
  });

  it("returns null percent (not 0/NaN/Infinity) when eligibleCount is zero", () => {
    const result = calculateVacancyRate(0, 0);
    expect(result.percent).toBeNull();
    expect(result.vacantCount).toBe(0);
    expect(result.eligibleCount).toBe(0);
  });

  it("returns 0% when there are zero vacancies but eligible positions exist", () => {
    expect(calculateVacancyRate(0, 10).percent).toBe(0);
  });

  it("returns 100% when every eligible position is vacant", () => {
    expect(calculateVacancyRate(5, 5).percent).toBe(100);
  });

  it("rounds to the nearest whole percentage point consistently", () => {
    expect(calculateVacancyRate(1, 3).percent).toBe(33);
    expect(calculateVacancyRate(2, 3).percent).toBe(67);
  });
});

describe("buildLevelDistribution", () => {
  it("groups and sorts by level ascending", () => {
    const positions = [
      { organizationalLevel: 3 },
      { organizationalLevel: 1 },
      { organizationalLevel: 3 },
      { organizationalLevel: 2 },
    ];
    expect(buildLevelDistribution(positions)).toEqual([
      { level: 1, count: 1 },
      { level: 2, count: 1 },
      { level: 3, count: 2 },
    ]);
  });

  it("returns an empty array for zero positions", () => {
    expect(buildLevelDistribution([])).toEqual([]);
  });

  it("omits levels with no active positions rather than padding with zero rows", () => {
    const positions = [{ organizationalLevel: 1 }, { organizationalLevel: 5 }];
    expect(buildLevelDistribution(positions)).toEqual([
      { level: 1, count: 1 },
      { level: 5, count: 1 },
    ]);
  });
});

describe("findMaxLevel", () => {
  it("returns the highest level", () => {
    expect(findMaxLevel([{ organizationalLevel: 2 }, { organizationalLevel: 5 }])).toBe(5);
  });

  it("returns null for zero positions", () => {
    expect(findMaxLevel([])).toBeNull();
  });

  it("returns the single level when there is exactly one position", () => {
    expect(findMaxLevel([{ organizationalLevel: 1 }])).toBe(1);
  });
});

describe("detectHierarchyIntegrityWarnings", () => {
  it("reports a clean single-root tree as fully connected", () => {
    const positions = [
      { id: "root", status: "ACTIVE" as const, primaryReportsToPositionId: null },
      { id: "child", status: "ACTIVE" as const, primaryReportsToPositionId: "root" },
      { id: "grandchild", status: "ACTIVE" as const, primaryReportsToPositionId: "child" },
    ];
    const result = detectHierarchyIntegrityWarnings(positions);
    expect(result.rootId).toBe("root");
    expect(result.extraRootIds).toEqual([]);
    expect(result.cycleActivePositionIds).toEqual([]);
    expect(result.disconnectedActivePositionIds).toEqual([]);
  });

  it("treats a chain through an archived (INACTIVE) manager as still connected", () => {
    const positions = [
      { id: "root", status: "ACTIVE" as const, primaryReportsToPositionId: null },
      { id: "archived-manager", status: "INACTIVE" as const, primaryReportsToPositionId: "root" },
      { id: "report", status: "ACTIVE" as const, primaryReportsToPositionId: "archived-manager" },
    ];
    const result = detectHierarchyIntegrityWarnings(positions);
    expect(result.disconnectedActivePositionIds).toEqual([]);
  });

  it("detects a genuine cycle without infinite looping", () => {
    const positions = [
      { id: "a", status: "ACTIVE" as const, primaryReportsToPositionId: "b" },
      { id: "b", status: "ACTIVE" as const, primaryReportsToPositionId: "a" },
    ];
    const result = detectHierarchyIntegrityWarnings(positions);
    expect(result.rootId).toBeNull();
    expect(result.cycleActivePositionIds.sort()).toEqual(["a", "b"]);
    expect(result.disconnectedActivePositionIds).toEqual([]);
  });

  it("detects an indirect cycle (A -> B -> C -> A)", () => {
    const positions = [
      { id: "a", status: "ACTIVE" as const, primaryReportsToPositionId: "b" },
      { id: "b", status: "ACTIVE" as const, primaryReportsToPositionId: "c" },
      { id: "c", status: "ACTIVE" as const, primaryReportsToPositionId: "a" },
    ];
    const result = detectHierarchyIntegrityWarnings(positions);
    expect(result.cycleActivePositionIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("reports a position with a dangling (non-existent) parent as disconnected, not a crash", () => {
    const positions = [
      { id: "root", status: "ACTIVE" as const, primaryReportsToPositionId: null },
      { id: "orphan", status: "ACTIVE" as const, primaryReportsToPositionId: "does-not-exist" },
    ];
    const result = detectHierarchyIntegrityWarnings(positions);
    expect(result.disconnectedActivePositionIds).toEqual(["orphan"]);
  });

  it("only reports ACTIVE positions in the cycle/disconnected lists, never PLANNED/INACTIVE", () => {
    const positions = [
      { id: "a", status: "PLANNED" as const, primaryReportsToPositionId: "b" },
      { id: "b", status: "INACTIVE" as const, primaryReportsToPositionId: "a" },
    ];
    const result = detectHierarchyIntegrityWarnings(positions);
    expect(result.cycleActivePositionIds).toEqual([]);
    expect(result.disconnectedActivePositionIds).toEqual([]);
  });

  it("returns a null rootId for a company with zero positions", () => {
    const result = detectHierarchyIntegrityWarnings([]);
    expect(result.rootId).toBeNull();
    expect(result.disconnectedActivePositionIds).toEqual([]);
  });

  it("reports a root position that exists but is not ACTIVE as having no active root (via the caller comparing rootId's own status, not this function directly)", () => {
    // detectHierarchyIntegrityWarnings only reports connectivity; "no
    // active root" itself is derived by the service layer comparing the
    // root position's own status — this test documents that this
    // function still correctly identifies rootId even when it's PLANNED.
    const positions = [
      { id: "root", status: "PLANNED" as const, primaryReportsToPositionId: null },
      { id: "child", status: "ACTIVE" as const, primaryReportsToPositionId: "root" },
    ];
    const result = detectHierarchyIntegrityWarnings(positions);
    expect(result.rootId).toBe("root");
    expect(result.disconnectedActivePositionIds).toEqual([]);
  });

  it("flags extra roots when more than one position has a null parent (defensive — unreachable via the real DB constraint)", () => {
    const positions = [
      { id: "root-1", status: "ACTIVE" as const, primaryReportsToPositionId: null },
      { id: "root-2", status: "ACTIVE" as const, primaryReportsToPositionId: null },
    ];
    const result = detectHierarchyIntegrityWarnings(positions);
    expect(result.rootId).toBe("root-1");
    expect(result.extraRootIds).toEqual(["root-2"]);
  });

  it("detects a cycle within the walk bound", () => {
    const positions = Array.from({ length: 50 }, (_, i) => ({
      id: `p${i}`,
      status: "ACTIVE" as const,
      primaryReportsToPositionId: `p${(i + 1) % 50}`,
    }));
    const result = detectHierarchyIntegrityWarnings(positions);
    expect(result.cycleActivePositionIds.length).toBe(50);
  });

  it("does not loop forever or crash on a cycle longer than the walk bound — still reports it (as disconnected, since the bound is exceeded before a repeat is seen), never hangs", () => {
    const positions = Array.from({ length: 300 }, (_, i) => ({
      id: `p${i}`,
      status: "ACTIVE" as const,
      primaryReportsToPositionId: `p${(i + 1) % 300}`,
    }));
    const start = Date.now();
    const result = detectHierarchyIntegrityWarnings(positions);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(result.cycleActivePositionIds.length + result.disconnectedActivePositionIds.length).toBe(
      300
    );
  });
});
