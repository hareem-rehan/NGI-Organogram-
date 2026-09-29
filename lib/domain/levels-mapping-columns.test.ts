import { describe, expect, it } from "vitest";

import {
  buildLevelsMappingColumns,
  laddersForDepartment,
  type ColumnDepartment,
  type ColumnSubDivision,
} from "./levels-mapping-columns";

function dept(id: string, overrides: Partial<ColumnDepartment> = {}): ColumnDepartment {
  return {
    id,
    name: id.toUpperCase(),
    hasIcLadder: true,
    hasManagerLadder: true,
    showInLevelsMapping: true,
    ...overrides,
  };
}

function fam(id: string, departmentId: string, show = true): ColumnSubDivision {
  return { id, name: id.toUpperCase(), departmentId, showInLevelsMapping: show };
}

describe("laddersForDepartment", () => {
  it("returns the ladders the department runs", () => {
    expect(laddersForDepartment(dept("a"))).toEqual(["IC", "MANAGER"]);
    expect(laddersForDepartment(dept("a", { hasIcLadder: false }))).toEqual(["MANAGER"]);
    expect(laddersForDepartment(dept("a", { hasManagerLadder: false }))).toEqual(["IC"]);
  });

  it("offers both ladders for a department that runs neither", () => {
    expect(
      laddersForDepartment(dept("a", { hasIcLadder: false, hasManagerLadder: false }))
    ).toEqual(["IC", "MANAGER"]);
  });
});

describe("buildLevelsMappingColumns", () => {
  it("returns nothing when nothing is shown", () => {
    expect(buildLevelsMappingColumns([dept("a", { showInLevelsMapping: false })], [])).toEqual([]);
  });

  it("keeps department order and puts each department's sub-divisions right after it", () => {
    const groups = buildLevelsMappingColumns(
      [dept("hr"), dept("eng")],
      [fam("qa", "eng"), fam("recruit", "hr"), fam("hidden", "eng", false)]
    );
    expect(groups.map((g) => `${g.type}:${g.id}`)).toEqual([
      "DEPARTMENT:hr",
      "SUB_DIVISION:recruit",
      "DEPARTMENT:eng",
      "SUB_DIVISION:qa",
    ]);
  });

  it("shows a sub-division even when its department's own columns are hidden", () => {
    const groups = buildLevelsMappingColumns(
      [dept("eng", { showInLevelsMapping: false, hasIcLadder: false })],
      [fam("qa", "eng")]
    );
    expect(groups).toEqual([
      {
        type: "SUB_DIVISION",
        id: "qa",
        name: "QA",
        departmentId: "eng",
        departmentName: "ENG",
        ladders: ["MANAGER"],
      },
    ]);
  });

  it("drops a sub-division whose department is not in the list", () => {
    expect(buildLevelsMappingColumns([dept("hr")], [fam("orphan", "gone")])).toHaveLength(1);
  });
});
