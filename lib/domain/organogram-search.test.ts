import { describe, expect, it } from "vitest";

import {
  normalizeSearchQuery,
  searchOrganogramNodes,
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MAX_RESULTS,
  type OrganogramSearchResult,
} from "./organogram-search";
import type { OrganogramNode } from "./organogram";

function node(overrides: Partial<OrganogramNode> & { positionId: string }): OrganogramNode {
  return {
    positionCode: `POS-${overrides.positionId}`,
    title: `Title ${overrides.positionId}`,
    departmentId: "dept-1",
    departmentName: "Engineering",
    departmentCode: "ENG",
    departmentColor: "#16a34a",
    jobGradeId: null,
    jobGradeName: null,
    organizationalLevel: 1,
    positionStatus: "ACTIVE",
    occupancyStatus: "vacant",
    occupantDisplayName: null,
    occupantEmployeeId: null,
    directReportCount: 0,
    primaryReportsToPositionId: null,
    hasChildren: false,
    isPlanned: false,
    isActive: true,
    ...overrides,
  };
}

describe("normalizeSearchQuery", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normalizeSearchQuery("  Amara   Chen  ")).toBe("Amara Chen");
  });

  it("hard-caps to the maximum length", () => {
    const long = "a".repeat(SEARCH_MAX_QUERY_LENGTH + 50);
    expect(normalizeSearchQuery(long).length).toBe(SEARCH_MAX_QUERY_LENGTH);
  });
});

describe("searchOrganogramNodes", () => {
  it("matches an exact position-code", () => {
    const nodes = [node({ positionId: "a", positionCode: "ENG-001" })];
    const results = searchOrganogramNodes(nodes, "ENG-001");
    expect(results).toHaveLength(1);
    expect(results[0]?.matchType).toBe("positionCode");
    expect(results[0]?.isExactMatch).toBe(true);
  });

  it("matches a partial title", () => {
    const nodes = [node({ positionId: "a", title: "VP Engineering" })];
    const results = searchOrganogramNodes(nodes, "engine");
    expect(results[0]?.matchType).toBe("title");
    expect(results[0]?.isExactMatch).toBe(false);
  });

  it("matches an exact position-code case-insensitively", () => {
    const nodes = [node({ positionId: "a", positionCode: "ENG-001" })];
    const results = searchOrganogramNodes(nodes, "eng-001");
    expect(results).toHaveLength(1);
  });

  it("matches an occupant's display name", () => {
    const nodes = [
      node({ positionId: "a", occupancyStatus: "occupied", occupantDisplayName: "Amara Chen" }),
    ];
    const results = searchOrganogramNodes(nodes, "Amara");
    expect(results[0]?.matchType).toBe("occupant");
  });

  it("a vacant position is still searchable by title and code", () => {
    const nodes = [
      node({
        positionId: "a",
        title: "VP Sales",
        positionCode: "SAL-001",
        occupancyStatus: "vacant",
        occupantDisplayName: null,
      }),
    ];
    expect(searchOrganogramNodes(nodes, "VP Sales")).toHaveLength(1);
    expect(searchOrganogramNodes(nodes, "SAL-001")).toHaveLength(1);
  });

  it("matches a department name and code", () => {
    const nodes = [node({ positionId: "a", departmentName: "Engineering", departmentCode: "ENG" })];
    expect(searchOrganogramNodes(nodes, "Engineering")).toHaveLength(1);
    expect(searchOrganogramNodes(nodes, "ENG")).toHaveLength(1);
  });

  it("is case-insensitive", () => {
    const nodes = [node({ positionId: "a", title: "Chief Executive Officer" })];
    expect(searchOrganogramNodes(nodes, "chief executive")).toHaveLength(1);
    expect(searchOrganogramNodes(nodes, "CHIEF EXECUTIVE")).toHaveLength(1);
  });

  it("normalizes whitespace before matching", () => {
    const nodes = [node({ positionId: "a", title: "Chief Executive Officer" })];
    expect(searchOrganogramNodes(nodes, "  Chief   Executive  ")).toHaveLength(1);
  });

  it("returns no results below the minimum query length", () => {
    const nodes = [node({ positionId: "a", title: "A" })];
    expect(searchOrganogramNodes(nodes, "a")).toEqual([]);
    expect(searchOrganogramNodes(nodes, "")).toEqual([]);
    expect(searchOrganogramNodes(nodes, "  ")).toEqual([]);
  });

  it("still searches correctly with an excessively long query (truncated, not rejected/crashed)", () => {
    const nodes = [node({ positionId: "a", title: "VP Engineering" })];
    const long = "VP Engineering" + "z".repeat(500);
    expect(searchOrganogramNodes(nodes, long)).toEqual([]); // truncated query no longer matches — safe, not a crash
  });

  it("returns an empty array, not an error, for no matches", () => {
    const nodes = [node({ positionId: "a", title: "VP Engineering" })];
    expect(searchOrganogramNodes(nodes, "nonexistent")).toEqual([]);
  });

  it("caps results at SEARCH_MAX_RESULTS", () => {
    const nodes = Array.from({ length: SEARCH_MAX_RESULTS + 10 }, (_, i) =>
      node({ positionId: `p${i}`, title: `Engineer ${i}` })
    );
    expect(searchOrganogramNodes(nodes, "Engineer")).toHaveLength(SEARCH_MAX_RESULTS);
  });

  it("ranks an exact position-code match above a partial title match", () => {
    const nodes = [
      node({ positionId: "partial", title: "Someone about ENG-1 mention" }),
      node({ positionId: "exact", positionCode: "ENG-1" }),
    ];
    const results = searchOrganogramNodes(nodes, "ENG-1");
    expect(results[0]?.positionId).toBe("exact");
  });

  it("ranks an exact title match above a partial position-code match", () => {
    const nodes = [
      node({ positionId: "partial-code", positionCode: "CEO-999" }),
      node({ positionId: "exact-title", title: "CEO" }),
    ];
    const results = searchOrganogramNodes(nodes, "CEO");
    expect(results[0]?.positionId).toBe("exact-title");
  });

  it("deterministic ordering for equally-ranked ties (level, title, code)", () => {
    const nodes = [
      node({ positionId: "b", title: "Beta Engineer", organizationalLevel: 2 }),
      node({ positionId: "a", title: "Alpha Engineer", organizationalLevel: 2 }),
    ];
    const first = searchOrganogramNodes(nodes, "Engineer");
    const second = searchOrganogramNodes(nodes, "Engineer");
    expect(first.map((r) => r.positionId)).toEqual(["a", "b"]);
    expect(first.map((r) => r.positionId)).toEqual(second.map((r) => r.positionId));
  });

  it("excludes planned positions when showPlanned is false", () => {
    const nodes = [
      node({ positionId: "a", title: "Future VP", isPlanned: true, positionStatus: "PLANNED" }),
    ];
    expect(searchOrganogramNodes(nodes, "Future VP", { showPlanned: false })).toEqual([]);
    expect(searchOrganogramNodes(nodes, "Future VP", { showPlanned: true })).toHaveLength(1);
  });

  it("includes planned positions by default (showPlanned defaults to true)", () => {
    const nodes = [
      node({ positionId: "a", title: "Future VP", isPlanned: true, positionStatus: "PLANNED" }),
    ];
    expect(searchOrganogramNodes(nodes, "Future VP")).toHaveLength(1);
  });

  it("inactive positions remain searchable (no toggle hides them, matching Phase 8's visibility rule)", () => {
    const nodes = [node({ positionId: "a", title: "Archived Role", positionStatus: "INACTIVE" })];
    expect(searchOrganogramNodes(nodes, "Archived Role")).toHaveLength(1);
  });

  it("never exposes a raw employee id/code — result shape only carries approved fields", () => {
    const nodes = [
      node({
        positionId: "a",
        occupancyStatus: "occupied",
        occupantDisplayName: "Amara Chen",
        occupantEmployeeId: "employee-secret-id",
      }),
    ];
    const [result] = searchOrganogramNodes(nodes, "Amara");
    const keys = Object.keys(result as OrganogramSearchResult);
    expect(keys).not.toContain("occupantEmployeeId");
  });

  it("is safe against special/regex-meaningful characters in the query (no crash, no unintended matches)", () => {
    const nodes = [node({ positionId: "a", title: "R&D Lead (Special)" })];
    expect(() => searchOrganogramNodes(nodes, "R&D Lead (Special)")).not.toThrow();
    expect(searchOrganogramNodes(nodes, "R&D Lead (Special)")).toHaveLength(1);
    // A regex-special sequence that is NOT a literal substring must not
    // match via unintended regex interpretation (e.g. ".*" as a wildcard).
    expect(searchOrganogramNodes(nodes, ".*")).toEqual([]);
  });

  it("treats SQL-injection-style input as an ordinary literal string — no special handling, no crash, no data leak", () => {
    const nodes = [node({ positionId: "a", title: "VP Engineering" })];
    const injection = "'; DROP TABLE positions; --";
    expect(() => searchOrganogramNodes(nodes, injection)).not.toThrow();
    expect(searchOrganogramNodes(nodes, injection)).toEqual([]);
  });
});
