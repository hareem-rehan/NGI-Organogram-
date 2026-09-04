import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Position } from "@prisma/client";

const {
  listPositionsActionMock,
  listDepartmentOptionsActionMock,
  listJobGradeOptionsActionMock,
  listAllPositionsActionMock,
  archivePositionActionMock,
} = vi.hoisted(() => ({
  listPositionsActionMock: vi.fn(),
  listDepartmentOptionsActionMock: vi.fn(),
  listJobGradeOptionsActionMock: vi.fn(),
  listAllPositionsActionMock: vi.fn(),
  archivePositionActionMock: vi.fn(),
}));

vi.mock("@/app/(app)/positions/actions", () => ({
  listPositionsAction: listPositionsActionMock,
  listDepartmentOptionsAction: listDepartmentOptionsActionMock,
  listJobGradeOptionsAction: listJobGradeOptionsActionMock,
  listAllPositionsAction: listAllPositionsActionMock,
  activatePositionAction: vi.fn(),
  archivePositionAction: archivePositionActionMock,
}));

// RTL's render() has no Next.js App Router context provider, which
// useSearchParams() (added for Phase 7 dashboard deep-linking) needs —
// without this mock it throws "Cannot read properties of null". An
// empty URLSearchParams matches a plain `/positions` visit with no query
// string, same as every existing test's expected default filter state.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

import { PositionsView } from "./positions-view";

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "company-1",
    departmentId: "22222222-2222-4222-8222-222222222222",
    jobGradeId: null,
    title: "Chief Executive Officer",
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

function mockDefaults() {
  listDepartmentOptionsActionMock.mockResolvedValue({ ok: true, data: [] });
  listJobGradeOptionsActionMock.mockResolvedValue({ ok: true, data: [] });
  listAllPositionsActionMock.mockResolvedValue({ ok: true, data: [] });
}

describe("PositionsView", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders the position list with derived occupancy once loaded", async () => {
    mockDefaults();
    listPositionsActionMock.mockResolvedValue({
      ok: true,
      data: {
        items: [makePosition()],
        totalCount: 1,
        occupiedPositionIds: ["11111111-1111-4111-8111-111111111111"],
      },
    });

    render(<PositionsView canManage={false} />);

    expect(await screen.findByText("Chief Executive Officer")).toBeInTheDocument();
    expect(screen.getByText("POS-CEO")).toBeInTheDocument();
    expect(screen.getByText("Filled")).toBeInTheDocument();
  });

  it("shows Vacant for a position with no current occupant", async () => {
    mockDefaults();
    listPositionsActionMock.mockResolvedValue({
      ok: true,
      data: { items: [makePosition()], totalCount: 1, occupiedPositionIds: [] },
    });

    render(<PositionsView canManage={false} />);

    expect(await screen.findByText("Vacant")).toBeInTheDocument();
  });

  it("shows the empty state when there are no positions", async () => {
    mockDefaults();
    listPositionsActionMock.mockResolvedValue({
      ok: true,
      data: { items: [], totalCount: 0, occupiedPositionIds: [] },
    });

    render(<PositionsView canManage={false} />);

    expect(await screen.findByText(/no positions yet/i)).toBeInTheDocument();
  });

  it("shows an error state with retry when the list fails to load", async () => {
    mockDefaults();
    listPositionsActionMock.mockResolvedValue({ ok: false, error: "Something went wrong." });

    render(<PositionsView canManage={false} />);

    expect(await screen.findByText("Something went wrong.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("hides Add Position and row actions for a VIEWER (canManage=false)", async () => {
    mockDefaults();
    listPositionsActionMock.mockResolvedValue({
      ok: true,
      data: { items: [makePosition()], totalCount: 1, occupiedPositionIds: [] },
    });

    render(<PositionsView canManage={false} />);

    await screen.findByText("Chief Executive Officer");
    expect(screen.queryByRole("button", { name: /add position/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /change reports-to/i })).not.toBeInTheDocument();
  });

  it("shows Add Position and row actions for HR_EDITOR/ADMIN (canManage=true)", async () => {
    mockDefaults();
    listPositionsActionMock.mockResolvedValue({
      ok: true,
      data: { items: [makePosition()], totalCount: 1, occupiedPositionIds: [] },
    });

    render(<PositionsView canManage={true} />);

    await screen.findByText("Chief Executive Officer");
    expect(screen.getByRole("button", { name: /add position/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /change reports-to/i })).toBeInTheDocument();
  });

  it("re-queries the server when the department filter changes", async () => {
    mockDefaults();
    listPositionsActionMock.mockResolvedValue({
      ok: true,
      data: { items: [makePosition()], totalCount: 1, occupiedPositionIds: [] },
    });
    listDepartmentOptionsActionMock.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          companyId: "company-1",
          name: "Executive",
          code: "EXEC",
          description: null,
          color: null,
          parentDepartmentId: null,
          status: "ACTIVE",
          displayOrder: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    const user = userEvent.setup();

    render(<PositionsView canManage={false} />);
    await screen.findByText("Chief Executive Officer");
    listPositionsActionMock.mockClear();

    await user.selectOptions(
      screen.getByLabelText(/department/i),
      "22222222-2222-4222-8222-222222222222"
    );

    await waitFor(() =>
      expect(listPositionsActionMock).toHaveBeenCalledWith(
        expect.objectContaining({ departmentId: "22222222-2222-4222-8222-222222222222", page: 1 })
      )
    );
  });

  it("re-queries the server when the occupancy filter changes (Phase 7 dashboard deep-link)", async () => {
    mockDefaults();
    listPositionsActionMock.mockResolvedValue({
      ok: true,
      data: { items: [makePosition()], totalCount: 1, occupiedPositionIds: [] },
    });
    const user = userEvent.setup();

    render(<PositionsView canManage={false} />);
    await screen.findByText("Chief Executive Officer");
    listPositionsActionMock.mockClear();

    await user.selectOptions(screen.getByLabelText(/occupancy/i), "vacant");

    await waitFor(() =>
      expect(listPositionsActionMock).toHaveBeenCalledWith(
        expect.objectContaining({ occupancy: "vacant", page: 1 })
      )
    );
  });

  it("opens a confirm dialog and calls archivePositionAction on confirm", async () => {
    mockDefaults();
    listPositionsActionMock.mockResolvedValue({
      ok: true,
      data: { items: [makePosition()], totalCount: 1, occupiedPositionIds: [] },
    });
    archivePositionActionMock.mockResolvedValue({
      ok: true,
      data: makePosition({ status: "INACTIVE" }),
    });
    const user = userEvent.setup();

    render(<PositionsView canManage={true} />);
    await screen.findByText("Chief Executive Officer");

    await user.click(screen.getByRole("button", { name: /deactivate/i }));
    expect(screen.getByRole("heading", { name: /deactivate position/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Deactivate" }));

    await waitFor(() =>
      expect(archivePositionActionMock).toHaveBeenCalledWith({
        positionId: "11111111-1111-4111-8111-111111111111",
      })
    );
  });
});
