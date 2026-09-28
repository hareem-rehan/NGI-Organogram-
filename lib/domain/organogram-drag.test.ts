import { describe, expect, it } from "vitest";

import { collectDisplayedDescendants, judgeDrop, type DropTargetNode } from "./organogram-drag";

const edges = [
  { sourcePositionId: "ceo", targetPositionId: "eng" },
  { sourcePositionId: "eng", targetPositionId: "cto" },
  { sourcePositionId: "cto", targetPositionId: "lead" },
  { sourcePositionId: "lead", targetPositionId: "dev" },
  { sourcePositionId: "ceo", targetPositionId: "cds" },
  { sourcePositionId: "cds", targetPositionId: "cco" },
  // A second head line: dev also reports to cco.
  { sourcePositionId: "cco", targetPositionId: "dev" },
];

const target = (overrides: Partial<DropTargetNode> & { positionId: string }): DropTargetNode => ({
  kind: "position",
  departmentId: "d-eng",
  title: `Title ${overrides.positionId}`,
  departmentName: "Engineering",
  ...overrides,
});

describe("collectDisplayedDescendants", () => {
  it("collects everything drawn below a position, through either head line", () => {
    expect([...collectDisplayedDescendants("cto", edges)].sort()).toEqual(["dev", "lead"]);
    expect([...collectDisplayedDescendants("cco", edges)]).toEqual(["dev"]);
    expect(collectDisplayedDescendants("dev", edges).size).toBe(0);
  });
});

describe("judgeDrop", () => {
  const ctoDescendants = collectDisplayedDescendants("cto", edges);

  it("accepts another position as the new head", () => {
    expect(judgeDrop("lead", target({ positionId: "cco" }), new Set())).toEqual({
      valid: true,
      kind: "position",
      targetPositionId: "cco",
      label: "Title cco",
    });
  });

  it("accepts a department heading, reporting its department id", () => {
    expect(
      judgeDrop(
        "cto",
        target({
          positionId: "cds",
          kind: "department",
          departmentId: "d-cds",
          departmentName: "CDS",
        }),
        ctoDescendants
      )
    ).toEqual({ valid: true, kind: "department", departmentId: "d-cds", label: "CDS" });
  });

  it("refuses a drop onto itself", () => {
    expect(judgeDrop("cto", target({ positionId: "cto" }), ctoDescendants).valid).toBe(false);
  });

  it("refuses a drop onto any of its own subordinates, direct or indirect", () => {
    expect(judgeDrop("cto", target({ positionId: "lead" }), ctoDescendants).valid).toBe(false);
    const verdict = judgeDrop("cto", target({ positionId: "dev" }), ctoDescendants);
    expect(verdict.valid).toBe(false);
    if (!verdict.valid) expect(verdict.reason).toMatch(/reports .* to this position/);
  });

  it("refuses a sub-division box", () => {
    expect(
      judgeDrop("lead", target({ positionId: "sub:x", kind: "subdivision" }), new Set()).valid
    ).toBe(false);
  });
});
