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
    jobGradeCode: null,
    jobGradeLevel: null,
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

  // Rows lead with the role and add the person underneath, the same order
  // the canvas card uses — every fixture node here is unfilled, so the row
  // is just the title.
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

  it("shows the job grade instead of repeating the department on every row", () => {
    renderOutline({
      nodes: [
        makeNode({ positionId: "root", title: "CEO", jobGradeCode: "L18", hasChildren: false }),
      ],
    });

    expect(screen.getByText("L18")).toBeInTheDocument();
    // The department is the heading a row sits under in the leadership
    // view, so repeating it on the row itself was pure duplication.
    expect(screen.queryByText(/Engineering · Level/)).not.toBeInTheDocument();
  });

  it("renders a department heading as a heading, not as a selectable position", async () => {
    const user = userEvent.setup();
    const { onSelect, onToggleCollapse } = renderOutline({
      nodes: [
        makeNode({
          positionId: "dept:dept-1",
          kind: "department",
          title: "Engineering",
          hasChildren: true,
          directReportCount: 1,
        }),
        makeNode({
          positionId: "child",
          title: "VP Eng",
          primaryReportsToPositionId: "dept:dept-1",
        }),
      ],
    });

    expect(screen.getByText("Engineering")).toBeInTheDocument();
    expect(screen.getByText("1 role")).toBeInTheDocument();

    // A department heading has no Position behind it, so its only
    // interactive control is expand/collapse — clicking it must never
    // open an empty details panel.
    await user.click(screen.getByRole("button", { name: /Collapse Engineering/ }));
    expect(onToggleCollapse).toHaveBeenCalledWith("dept:dept-1");
    expect(onSelect).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^VP Eng/ }));
    expect(onSelect).toHaveBeenCalledWith("child");
  });

  it("shows a department's full member total, not just its direct children", () => {
    // Same fix as the visual chart: the heading counts every role in the
    // department, not the one role that hangs directly off the box.
    renderOutline({
      nodes: [
        makeNode({
          positionId: "dept:dept-1",
          kind: "department",
          title: "Human Resources",
          hasChildren: true,
          directReportCount: 1,
          departmentMemberCount: 23,
        }),
        makeNode({
          positionId: "child",
          title: "CHO",
          primaryReportsToPositionId: "dept:dept-1",
        }),
      ],
    });

    expect(screen.getByText("23 roles")).toBeInTheDocument();
    expect(screen.queryByText("1 role")).not.toBeInTheDocument();
  });
});
