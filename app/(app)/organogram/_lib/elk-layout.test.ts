import { describe, expect, it } from "vitest";

import { computeElkLayout, NODE_HEIGHT, NODE_WIDTH } from "./elk-layout";

describe("computeElkLayout", () => {
  it("returns an empty map for zero nodes", async () => {
    const result = await computeElkLayout([], []);
    expect(result.size).toBe(0);
  });

  it("places a child strictly below its parent (direction DOWN)", async () => {
    const positions = await computeElkLayout(
      ["root", "child"],
      [{ sourcePositionId: "root", targetPositionId: "child" }]
    );
    const root = positions.get("root")!;
    const child = positions.get("child")!;
    expect(child.y).toBeGreaterThan(root.y);
  });

  it("never overlaps two sibling nodes horizontally", async () => {
    const positions = await computeElkLayout(
      ["root", "a", "b"],
      [
        { sourcePositionId: "root", targetPositionId: "a" },
        { sourcePositionId: "root", targetPositionId: "b" },
      ]
    );
    const a = positions.get("a")!;
    const b = positions.get("b")!;
    const overlapsHorizontally = Math.abs(a.x - b.x) < NODE_WIDTH;
    const overlapsVertically = Math.abs(a.y - b.y) < NODE_HEIGHT;
    expect(overlapsHorizontally && overlapsVertically).toBe(false);
  });

  it("positions every requested node id exactly once, even with no edges (disconnected)", async () => {
    const positions = await computeElkLayout(["solo-a", "solo-b"], []);
    expect(positions.size).toBe(2);
    expect(positions.has("solo-a")).toBe(true);
    expect(positions.has("solo-b")).toBe(true);
  });

  it("is deterministic for the same input", async () => {
    const first = await computeElkLayout(
      ["root", "child"],
      [{ sourcePositionId: "root", targetPositionId: "child" }]
    );
    const second = await computeElkLayout(
      ["root", "child"],
      [{ sourcePositionId: "root", targetPositionId: "child" }]
    );
    expect(first.get("root")).toEqual(second.get("root"));
    expect(first.get("child")).toEqual(second.get("child"));
  });
});
