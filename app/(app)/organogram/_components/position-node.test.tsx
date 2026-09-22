import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";

import { PositionNode, type PositionNodeData } from "./position-node";
import type { OrganogramNode } from "@/lib/domain/organogram";

function makeNode(overrides: Partial<OrganogramNode> = {}): OrganogramNode {
  return {
    positionId: "pos-1",
    positionCode: "POS-1",
    title: "VP Engineering",
    departmentId: "dept-1",
    departmentName: "Engineering",
    departmentCode: "ENG",
    departmentColor: "#16a34a",
    jobGradeId: null,
    jobGradeName: null,
    jobGradeCode: null,
    jobGradeLevel: null,
    jobFamilyId: null,
    jobFamilyName: null,
    organizationalLevel: 2,
    positionStatus: "ACTIVE",
    occupancyStatus: "vacant",
    occupantDisplayName: null,
    occupantEmployeeId: null,
    directReportCount: 0,
    primaryReportsToPositionId: "root",
    hasChildren: false,
    isPlanned: false,
    isActive: true,
    ...overrides,
  };
}

function renderNode(data: Partial<PositionNodeData> = {}) {
  const fullData: PositionNodeData = {
    node: makeNode(),
    isCollapsed: false,
    hiddenDescendantCount: 0,
    isSelected: false,
    onToggleCollapse: vi.fn(),
    onSelect: vi.fn(),
    ...data,
  };
  const props = {
    id: fullData.node.positionId,
    data: fullData,
    type: "positionNode",
    selected: false,
    dragging: false,
    isConnectable: false,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    draggable: false,
    selectable: false,
    deletable: false,
  } as unknown as NodeProps & { data: PositionNodeData };

  render(
    <ReactFlowProvider>
      <PositionNode {...props} />
    </ReactFlowProvider>
  );
  return fullData;
}

describe("PositionNode", () => {
  // Rewritten for the Demo 1 compact card. The previous version asserted
  // the department name, organizational level and position code were all
  // ON the card — exactly what the stakeholder asked to remove — so it is
  // replaced by its opposite rather than deleted, and the removals are
  // asserted so they cannot creep back.
  it("shows the occupant, role title and grade level", () => {
    renderNode({
      node: makeNode({
        occupancyStatus: "occupied",
        occupantDisplayName: "John Doe",
        title: "Tech Lead",
        jobGradeCode: "L7",
        jobGradeLevel: 7,
        jobFamilyId: null,
        jobFamilyName: null,
      }),
    });
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Tech Lead")).toBeInTheDocument();
    expect(screen.getByText("L7")).toBeInTheDocument();
  });

  it("no longer shows the position code, department name, or organizational level", () => {
    renderNode({
      node: makeNode({
        occupancyStatus: "occupied",
        occupantDisplayName: "John Doe",
        jobGradeCode: "L7",
        jobGradeLevel: 7,
        jobFamilyId: null,
        jobFamilyName: null,
      }),
    });
    // Internal identifier — of no use to a chart reader.
    expect(screen.queryByText("POS-1")).not.toBeInTheDocument();
    // The card sits under its own department heading, so repeating the
    // name on every card was duplication.
    expect(screen.queryByText(/Engineering · Level/)).not.toBeInTheDocument();
  });

  it("omits the grade row entirely when the position has no grade", () => {
    renderNode({
      node: makeNode({
        occupancyStatus: "occupied",
        occupantDisplayName: "John Doe",
        jobGradeCode: null,
        jobGradeLevel: null,
        jobFamilyId: null,
        jobFamilyName: null,
      }),
    });
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.queryByText(/^L\d+$/)).not.toBeInTheDocument();
  });

  // Reversed on 2026-09-15. The card used to stamp "Vacant" on every
  // unfilled role. The chart now opens on a role ladder where most rungs
  // are unfilled by design, and the company's own chart simply leaves the
  // name off — ninety amber "Vacant" labels read as an alarm, not a fact.
  // The information is not lost: the accessible name still says it, which
  // is what a screen-reader user needs, since they cannot see that a line
  // is simply absent.
  it("leaves the name line off an unfilled role instead of labelling it Vacant", () => {
    renderNode({
      node: makeNode({
        title: "Head of Admin",
        occupancyStatus: "vacant",
        occupantDisplayName: null,
      }),
    });

    expect(screen.getByText("Head of Admin")).toBeInTheDocument();
    expect(screen.queryByText("Vacant")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Head of Admin\. Vacant\./ })).toBeInTheDocument();
  });

  it("puts the role first and the person underneath, matching the company's own chart", () => {
    renderNode({
      node: makeNode({
        title: "Manager Admin",
        occupancyStatus: "occupied",
        occupantDisplayName: "Hammad Hussain",
        jobGradeCode: "L10",
      }),
    });

    const card = screen.getByRole("button", { name: /^Manager Admin\. Hammad Hussain\./ });
    const lines = (card.textContent ?? "").trim();
    expect(lines.indexOf("Manager Admin")).toBeLessThan(lines.indexOf("Hammad Hussain"));
    expect(lines.indexOf("Hammad Hussain")).toBeLessThan(lines.indexOf("L10"));
  });

  it("shows the occupant's display name for an occupied position, never a raw employee id", () => {
    renderNode({
      node: makeNode({
        occupancyStatus: "occupied",
        occupantDisplayName: "Amara Chen",
        occupantEmployeeId: "employee-42",
      }),
    });
    expect(screen.getByText("Amara Chen")).toBeInTheDocument();
    expect(screen.queryByText("employee-42")).not.toBeInTheDocument();
  });

  it("shows a Planned badge for a planned position and an Inactive badge for an inactive one", () => {
    const { rerender } = render(
      <ReactFlowProvider>
        <PositionNode
          {...({
            id: "p",
            data: {
              node: makeNode({ positionStatus: "PLANNED" }),
              isCollapsed: false,
              hiddenDescendantCount: 0,
              isSelected: false,
              onToggleCollapse: vi.fn(),
              onSelect: vi.fn(),
            },
          } as unknown as NodeProps & { data: PositionNodeData })}
        />
      </ReactFlowProvider>
    );
    expect(screen.getByText("Planned")).toBeInTheDocument();

    rerender(
      <ReactFlowProvider>
        <PositionNode
          {...({
            id: "p",
            data: {
              node: makeNode({ positionStatus: "INACTIVE" }),
              isCollapsed: false,
              hiddenDescendantCount: 0,
              isSelected: false,
              onToggleCollapse: vi.fn(),
              onSelect: vi.fn(),
            },
          } as unknown as NodeProps & { data: PositionNodeData })}
        />
      </ReactFlowProvider>
    );
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("shows no status badge for an Active position", () => {
    renderNode({ node: makeNode({ positionStatus: "ACTIVE" }) });
    expect(screen.queryByText("Planned")).not.toBeInTheDocument();
    expect(screen.queryByText("Inactive")).not.toBeInTheDocument();
  });

  it('shows "No direct reports" and no toggle for a leaf position', () => {
    renderNode({ node: makeNode({ hasChildren: false, directReportCount: 0 }) });
    expect(screen.getByText("No direct reports")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Expand/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Collapse/ })).not.toBeInTheDocument();
  });

  it("shows an Expand toggle with the hidden count when collapsed and has children", () => {
    renderNode({
      node: makeNode({ hasChildren: true, directReportCount: 2, title: "Root" }),
      isCollapsed: true,
      hiddenDescendantCount: 3,
    });
    expect(
      screen.getByRole("button", { name: /^Expand Root, 3 hidden positions/ })
    ).toBeInTheDocument();
  });

  it("shows a Collapse toggle when expanded and has children", () => {
    renderNode({
      node: makeNode({ hasChildren: true, directReportCount: 2, title: "Root" }),
      isCollapsed: false,
    });
    expect(screen.getByRole("button", { name: /^Collapse Root/ })).toBeInTheDocument();
  });

  it("clicking the card calls onSelect with the position id", async () => {
    const user = userEvent.setup();
    const data = renderNode({ node: makeNode({ positionId: "pos-99" }) });
    await user.click(screen.getByRole("button", { name: /VP Engineering/ }));
    expect(data.onSelect).toHaveBeenCalledWith("pos-99");
  });

  it("clicking the toggle calls onToggleCollapse and does NOT also call onSelect (sibling buttons, not nested)", async () => {
    const user = userEvent.setup();
    const data = renderNode({
      node: makeNode({ positionId: "pos-99", hasChildren: true, title: "Root" }),
    });
    await user.click(screen.getByRole("button", { name: /^Collapse Root/ }));
    expect(data.onToggleCollapse).toHaveBeenCalledWith("pos-99");
    expect(data.onSelect).not.toHaveBeenCalled();
  });

  it("pressing Enter on the focused card calls onSelect (keyboard activation)", async () => {
    const user = userEvent.setup();
    const data = renderNode({ node: makeNode({ positionId: "pos-99" }) });
    const card = screen.getByRole("button", { name: /VP Engineering/ });
    card.focus();
    await user.keyboard("{Enter}");
    expect(data.onSelect).toHaveBeenCalledWith("pos-99");
  });
});

describe("PositionNode — department tier (Demo 1 feedback)", () => {
  function renderDepartment(nodeOverrides: Partial<OrganogramNode> = {}, data = {}) {
    return renderNode({
      node: makeNode({
        kind: "department",
        positionId: "dept:dept-1",
        title: "Engineering",
        departmentName: "Engineering",
        hasChildren: true,
        departmentMemberCount: 3,
        displayChildCount: 3,
        ...nodeOverrides,
      }),
      ...data,
    });
  }

  it("renders the department name and how many roles sit under it", () => {
    renderDepartment();
    expect(screen.getByText("Engineering")).toBeInTheDocument();
    expect(screen.getByText("3 roles")).toBeInTheDocument();
  });

  it("counts EVERY role in the department, not just the box's direct children", () => {
    // The real bug: a department heading showed its direct child count
    // ("1 role") even when the department held many roles that nest under
    // that child in the collapsed leadership layout. The heading answers
    // "how big is this department?", so it shows the full member total.
    renderDepartment({ departmentMemberCount: 23, displayChildCount: 1 });
    expect(screen.getByText("23 roles")).toBeInTheDocument();
    expect(screen.queryByText("1 role")).not.toBeInTheDocument();
  });

  it("falls back to the displayed child count when no member total is set", () => {
    renderDepartment({ departmentMemberCount: undefined, displayChildCount: 4 });
    expect(screen.getByText("4 roles")).toBeInTheDocument();
  });

  it("never shows occupancy or a position code — a department is a heading, not a seat", () => {
    renderDepartment();
    expect(screen.queryByText("Vacant")).not.toBeInTheDocument();
    expect(screen.queryByText("POS-1")).not.toBeInTheDocument();
  });

  it("toggles collapse and never selects — there is no Position behind it", async () => {
    const user = userEvent.setup();
    const onToggleCollapse = vi.fn();
    const onSelect = vi.fn();
    renderDepartment({}, { onToggleCollapse, onSelect });

    await user.click(screen.getByRole("button", { name: /Engineering department/ }));
    expect(onToggleCollapse).toHaveBeenCalledWith("dept:dept-1");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("singularizes a one-role department", () => {
    renderDepartment({ departmentMemberCount: 1, displayChildCount: 1 });
    expect(screen.getByText("1 role")).toBeInTheDocument();
  });
});

describe("PositionNode — displayed vs. real report counts", () => {
  it("promises only the reports expanding will actually reveal", () => {
    // The real position has four reports; the leadership filter leaves
    // one of them on the chart. Showing "4" would be a promise the
    // expand toggle cannot keep.
    renderNode({
      node: makeNode({ hasChildren: true, directReportCount: 4, displayChildCount: 1 }),
    });
    expect(screen.getByText(/1 direct report$/)).toBeInTheDocument();
  });

  it("falls back to the real count on an unprojected graph", () => {
    renderNode({ node: makeNode({ hasChildren: true, directReportCount: 2 }) });
    expect(screen.getByText(/2 direct reports/)).toBeInTheDocument();
  });
});
