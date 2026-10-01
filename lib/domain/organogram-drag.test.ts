import { describe, expect, it } from "vitest";

import {
  collectDisplayedDescendants,
  judgeDrop,
  pickDropTargetAtPoint,
  pointerClientPoint,
  type DropTargetNode,
} from "./organogram-drag";

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

describe("pointerClientPoint", () => {
  it("reads a mouse event's client position", () => {
    expect(pointerClientPoint({ clientX: 10, clientY: 20 })).toEqual({ x: 10, y: 20 });
  });

  it("reads the lifted finger of a touch-end event, then any current touch", () => {
    expect(
      pointerClientPoint({ changedTouches: [{ clientX: 3, clientY: 4 }], touches: [] })
    ).toEqual({ x: 3, y: 4 });
    expect(pointerClientPoint({ touches: [{ clientX: 5, clientY: 6 }] })).toEqual({ x: 5, y: 6 });
  });

  it("returns null when the event has no position", () => {
    expect(pointerClientPoint(undefined)).toBeNull();
    expect(pointerClientPoint({})).toBeNull();
    expect(pointerClientPoint({ changedTouches: [] })).toBeNull();
  });
});

describe("pickDropTargetAtPoint (drop follows the pointer)", () => {
  const rects = [
    { id: "dragged", x: 0, y: 0, width: 188, height: 88 },
    { id: "a", x: 150, y: 0, width: 188, height: 88 },
    { id: "b", x: 400, y: 0, width: 188, height: 88 },
    { id: "dept", x: 380, y: -20, width: 400, height: 140 },
  ];

  it("picks the card under the pointer even when the dragged card overlaps another more", () => {
    // The dragged card overlaps "a" heavily, but the pointer is over "b".
    expect(pickDropTargetAtPoint({ x: 450, y: 40 }, rects, "dragged")).toBe("b");
  });

  it("never returns the dragged card itself", () => {
    expect(pickDropTargetAtPoint({ x: 20, y: 20 }, rects, "dragged")).toBeNull();
  });

  it("prefers the smallest box when boxes overlap under the pointer", () => {
    expect(pickDropTargetAtPoint({ x: 450, y: 40 }, rects, "dragged")).toBe("b");
    expect(pickDropTargetAtPoint({ x: 700, y: 40 }, rects, "dragged")).toBe("dept");
  });

  it("counts the exact edge as inside, and anything past it as empty canvas", () => {
    expect(pickDropTargetAtPoint({ x: 338, y: 88 }, rects, "dragged")).toBe("a");
    expect(pickDropTargetAtPoint({ x: 339, y: 40 }, rects, "dragged")).toBeNull();
  });
});
