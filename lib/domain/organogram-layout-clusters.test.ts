import { describe, expect, it } from "vitest";

import { computeLayoutClusters, type ClusterInputNode } from "./organogram-layout-clusters";

const n = (positionId: string, parent: string | null): ClusterInputNode => ({
  positionId,
  primaryReportsToPositionId: parent,
});

describe("computeLayoutClusters", () => {
  // CEO → Engineering → CTO → Lead; CEO → CDS → CCO → Product → PM
  const nodes = [
    n("ceo", null),
    n("eng", "ceo"),
    n("cto", "eng"),
    n("lead", "cto"),
    n("cds", "ceo"),
    n("cco", "cds"),
    n("product", "cco"),
    n("pm", "product"),
  ];

  it("puts every card in the branch of the root's child it descends from", () => {
    const clusters = computeLayoutClusters(nodes);
    expect(clusters.get("eng")).toBe("eng");
    expect(clusters.get("cto")).toBe("eng");
    expect(clusters.get("lead")).toBe("eng");
    expect(clusters.get("cds")).toBe("cds");
    expect(clusters.get("product")).toBe("cds"); // a sub-department stays in its division
    expect(clusters.get("pm")).toBe("cds");
  });

  it("leaves the root out of every branch", () => {
    expect(computeLayoutClusters(nodes).has("ceo")).toBe(false);
  });

  it("is order-independent (children listed before parents)", () => {
    const clusters = computeLayoutClusters([...nodes].reverse());
    expect(clusters.get("pm")).toBe("cds");
    expect(clusters.get("lead")).toBe("eng");
  });

  it("treats a node whose parent is missing from the set as a root of its own", () => {
    // A focused/filtered view: the chain starts mid-tree.
    const clusters = computeLayoutClusters([n("cto", "eng"), n("lead", "cto"), n("x", "cto")]);
    expect(clusters.has("cto")).toBe(false);
    expect(clusters.get("lead")).toBe("lead");
    expect(clusters.get("x")).toBe("x");
  });

  it("returns nothing for an empty or root-only chart", () => {
    expect(computeLayoutClusters([]).size).toBe(0);
    expect(computeLayoutClusters([n("ceo", null)]).size).toBe(0);
  });

  it("terminates on a (corrupted) display-parent cycle without assigning it", () => {
    const clusters = computeLayoutClusters([n("ceo", null), n("a", "b"), n("b", "a")]);
    expect(clusters.has("a")).toBe(false);
    expect(clusters.has("b")).toBe(false);
  });
});
