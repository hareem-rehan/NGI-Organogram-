import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OrganogramOutlineView } from "./organogram-outline-view";
import type { OrganogramNode } from "@/lib/domain/organogram";

function makeNode(overrides: Partial<OrganogramNode> & { positionId: string }): OrganogramNode {
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

const TREE: OrganogramNode[] = [
  makeNode({
    positionId: "root",
    title: "CEO",
    organizationalLevel: 1,
    hasChildren: true,
    directReportCount: 1,
  }),
  makeNode({
    positionId: "child",
    title: "VP Eng",
    organizationalLevel: 2,
    primaryReportsToPositionId: "root",
    hasChildren: true,
    directReportCount: 1,
  }),
  makeNode({
    positionId: "grandchild",
    title: "Eng Manager",
    organizationalLevel: 3,
    primaryReportsToPositionId: "child",
  }),
];

function renderOutline(overrides: Partial<Parameters<typeof OrganogramOutlineView>[0]> = {}) {
  const onToggleCollapse = vi.fn();
  const onSelect = vi.fn();
  render(
    <OrganogramOutlineView
      nodes={TREE}
      collapsedIds={new Set()}
      showPlanned={true}
      selectedId={null}
      onToggleCollapse={onToggleCollapse}
      onSelect={onSelect}
      {...overrides}
    />
  );
  return { onToggleCollapse, onSelect };
}

describe("OrganogramOutlineView", () => {
  it("shows an empty message when there is no root", () => {
    render(
      <OrganogramOutlineView
        nodes={[]}
        collapsedIds={new Set()}
        showPlanned={true}
        selectedId={null}
        onToggleCollapse={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText("No positions to display.")).toBeInTheDocument();
  });

  it("renders every node when nothing is collapsed", () => {
    renderOutline();
    expect(screen.getByText("CEO")).toBeInTheDocument();
    expect(screen.getByText("VP Eng")).toBeInTheDocument();
    expect(screen.getByText("Eng Manager")).toBeInTheDocument();
  });

  it("hides descendants of a collapsed node", () => {
    renderOutline({ collapsedIds: new Set(["child"]) });
    expect(screen.getByText("VP Eng")).toBeInTheDocument();
    expect(screen.queryByText("Eng Manager")).not.toBeInTheDocument();
  });

  it("hides a planned node's whole subtree when showPlanned is false", () => {
    const plannedTree: OrganogramNode[] = [
      makeNode({ positionId: "root", title: "CEO", hasChildren: true, directReportCount: 1 }),
      makeNode({
        positionId: "planned-child",
        title: "Future VP",
        primaryReportsToPositionId: "root",
        isPlanned: true,
      }),
    ];
    render(
      <OrganogramOutlineView
        nodes={plannedTree}
        collapsedIds={new Set()}
        showPlanned={false}
        selectedId={null}
        onToggleCollapse={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    expect(screen.queryByText("Future VP")).not.toBeInTheDocument();
  });

  it("shows a status badge for non-Active positions only", () => {
    const nodes: OrganogramNode[] = [
      makeNode({ positionId: "root", title: "CEO", positionStatus: "ACTIVE" }),
      makeNode({
        positionId: "planned",
        title: "Planned Pos",
        primaryReportsToPositionId: "root",
        positionStatus: "PLANNED",
        isPlanned: true,
      }),
    ];
    render(
      <OrganogramOutlineView
        nodes={nodes}
        collapsedIds={new Set()}
        showPlanned={true}
        selectedId={null}
        onToggleCollapse={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText("Planned")).toBeInTheDocument();
  });

  it("clicking the toggle calls onToggleCollapse with the position id and does not call onSelect", async () => {
    const user = userEvent.setup();
    const { onToggleCollapse, onSelect } = renderOutline();
    await user.click(screen.getByRole("button", { name: /Collapse CEO/ }));
    expect(onToggleCollapse).toHaveBeenCalledWith("root");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("clicking a node's row calls onSelect with its position id", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderOutline();
    await user.click(screen.getByRole("button", { name: /^VP Eng/ }));
    expect(onSelect).toHaveBeenCalledWith("child");
  });

  it("highlights the selected node", () => {
    renderOutline({ selectedId: "child" });
    expect(screen.getByRole("button", { name: /^VP Eng/ }).parentElement).toHaveClass("bg-accent");
  });
});
