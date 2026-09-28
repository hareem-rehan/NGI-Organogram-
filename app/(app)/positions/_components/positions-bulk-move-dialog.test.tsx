import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Position } from "@prisma/client";

const { bulkMovePositionsActionMock } = vi.hoisted(() => ({
  bulkMovePositionsActionMock: vi.fn(),
}));

vi.mock("@/app/(app)/positions/actions", () => ({
  bulkMovePositionsAction: bulkMovePositionsActionMock,
}));

import { PositionsBulkMoveDialog } from "./positions-bulk-move-dialog";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: A,
    companyId: "company-1",
    departmentId: "dept-1",
    jobGradeId: null,
    jobFamilyId: null,
    careerTrackId: null,
    title: "Position",
    positionCode: "POS",
    ladderKind: null,
    description: null,
    location: null,
    status: "ACTIVE",
    primaryReportsToPositionId: null,
    coReportsToPositionId: null,
    organizationalLevel: 1,
    displayOrder: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// The Combobox open/select interaction is not exercised in jsdom (same
// documented limitation as position-move-dialog.test.tsx); the full pick-a-
// parent-and-move flow is covered end-to-end. Here we cover the dialog's own
// contract: the count in the title and that Move is disabled until a parent is
// chosen, so an empty submit can never reach the server.
describe("PositionsBulkMoveDialog", () => {
  afterEach(() => vi.clearAllMocks());

  const selected = [
    makePosition({ id: A, title: "Head of Admin", positionCode: "POS-ADMIN" }),
    makePosition({ id: B, title: "Manager Admin", positionCode: "POS-MGR" }),
  ];

  it("titles the dialog with the number of selected positions", () => {
    render(
      <PositionsBulkMoveDialog
        open
        onOpenChange={() => {}}
        selected={selected}
        allPositions={selected}
        onDone={() => {}}
      />
    );
    expect(screen.getByText("Change Reports-To for 2 positions")).toBeInTheDocument();
  });

  it("disables the move button until a new manager is chosen", () => {
    render(
      <PositionsBulkMoveDialog
        open
        onOpenChange={() => {}}
        selected={selected}
        allPositions={selected}
        onDone={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: /move 2/i })).toBeDisabled();
    expect(bulkMovePositionsActionMock).not.toHaveBeenCalled();
  });

  it("renders nothing when the selection is empty", () => {
    const { container } = render(
      <PositionsBulkMoveDialog
        open
        onOpenChange={() => {}}
        selected={[]}
        allPositions={selected}
        onDone={() => {}}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
