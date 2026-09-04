import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Position } from "@prisma/client";

const { getSubtreeSizeActionMock, movePositionActionMock } = vi.hoisted(() => ({
  getSubtreeSizeActionMock: vi.fn(),
  movePositionActionMock: vi.fn(),
}));

vi.mock("@/app/(app)/positions/actions", () => ({
  getSubtreeSizeAction: getSubtreeSizeActionMock,
  movePositionAction: movePositionActionMock,
}));

import { PositionMoveDialog } from "./position-move-dialog";

const ROOT_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_ID = "22222222-2222-4222-8222-222222222222";

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: ROOT_ID,
    companyId: "company-1",
    departmentId: "dept-1",
    jobGradeId: null,
    title: "CEO",
    positionCode: "POS-CEO",
    description: null,
    location: null,
    status: "ACTIVE",
    primaryReportsToPositionId: null,
    organizationalLevel: 1,
    displayOrder: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("PositionMoveDialog", () => {
  afterEach(() => vi.clearAllMocks());

  it("shows the descendant-recalculation count once the subtree size loads", async () => {
    getSubtreeSizeActionMock.mockResolvedValue({ ok: true, data: 3 });
    const root = makePosition();

    render(
      <PositionMoveDialog
        open
        onOpenChange={() => {}}
        position={root}
        allPositions={[root]}
        onMoved={() => {}}
      />
    );

    expect(
      await screen.findByText(
        /3 descendant positions will have their organizational level recalculated/i
      )
    ).toBeInTheDocument();
  });

  it("uses singular phrasing for exactly one descendant", async () => {
    getSubtreeSizeActionMock.mockResolvedValue({ ok: true, data: 1 });
    const root = makePosition();

    render(
      <PositionMoveDialog
        open
        onOpenChange={() => {}}
        position={root}
        allPositions={[root]}
        onMoved={() => {}}
      />
    );

    expect(
      await screen.findByText(
        /1 descendant position will have its organizational level recalculated/i
      )
    ).toBeInTheDocument();
  });

  it("shows no recalculation message for a leaf position (zero descendants)", async () => {
    getSubtreeSizeActionMock.mockResolvedValue({ ok: true, data: 0 });
    const root = makePosition();

    render(
      <PositionMoveDialog
        open
        onOpenChange={() => {}}
        position={root}
        allPositions={[root]}
        onMoved={() => {}}
      />
    );

    await waitFor(() => expect(getSubtreeSizeActionMock).toHaveBeenCalled());
    expect(screen.queryByText(/descendant position/i)).not.toBeInTheDocument();
  });

  // Two scenarios — opening the Combobox and selecting a new Reports-To
  // option — are deliberately NOT covered at this component-test level.
  // Opening the underlying Radix Popover (components/ui/combobox.tsx)
  // hangs indefinitely in this project's jsdom test environment: the
  // interaction itself completes (confirmed by instrumenting the
  // component directly — the option renders and is clickable within
  // milliseconds), but something in Popover's floating-ui positioning
  // or focus-scope teardown never lets Testing Library's `act()`
  // wrapper settle, so the *test process* times out even though the
  // *component* behaves correctly. Root-caused to Radix Popover +
  // jsdom specifically (a trivial button click and this same dialog's
  // non-Popover interactions all pass instantly); not fixed by
  // polyfilling ResizeObserver, PointerEvent, pointer-capture methods,
  // or a stable getBoundingClientRect (all attempted). This exact
  // interaction — excluding the moved position from its own Reports-To
  // options, and selecting a new parent — IS covered in a real browser
  // by e2e/positions.spec.ts, which is the more faithful venue for
  // real pointer/focus/positioning behavior regardless.

  it("disables Confirm move when the selection is unchanged from the current parent", async () => {
    getSubtreeSizeActionMock.mockResolvedValue({ ok: true, data: 0 });
    const root = makePosition({ id: ROOT_ID });
    const child = makePosition({ id: CHILD_ID, primaryReportsToPositionId: ROOT_ID });

    render(
      <PositionMoveDialog
        open
        onOpenChange={() => {}}
        position={child}
        allPositions={[root, child]}
        onMoved={() => {}}
      />
    );

    await waitFor(() => expect(getSubtreeSizeActionMock).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /confirm move/i })).toBeDisabled();
  });

  it("seeds the selected-parent display from the position's real current Reports-To, not always root", async () => {
    getSubtreeSizeActionMock.mockResolvedValue({ ok: true, data: 2 });
    const root = makePosition({ id: ROOT_ID, title: "CEO" });
    const child = makePosition({
      id: CHILD_ID,
      title: "VP Eng",
      primaryReportsToPositionId: root.id,
    });

    render(
      <PositionMoveDialog
        open
        onOpenChange={() => {}}
        position={child}
        allPositions={[root, child]}
        onMoved={() => {}}
      />
    );

    await waitFor(() => expect(getSubtreeSizeActionMock).toHaveBeenCalled());
    expect(screen.getByText(/selected/i)).toBeInTheDocument();
    expect(screen.getByText("CEO")).toBeInTheDocument();
  });
});
