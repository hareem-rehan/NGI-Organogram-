import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { getOrganogramActionMock, searchParamsMock } = vi.hoisted(() => ({
  getOrganogramActionMock: vi.fn(),
  searchParamsMock: vi.fn(() => new URLSearchParams()),
}));

vi.mock("@/app/(app)/organogram/actions", () => ({
  getOrganogramAction: getOrganogramActionMock,
}));

// Arrange-mode wiring imports the Positions server actions (directly, and via
// the shared PositionFormDialog). Stub the whole module so the client test
// never pulls the server-only service chain, and list actions resolve empty.
vi.mock("@/app/(app)/positions/actions", () => ({
  createPositionAction: vi.fn(),
  updatePositionAction: vi.fn(),
  movePositionAction: vi.fn(),
  deletePositionAction: vi.fn(),
  deletePositionSubtreeAction: vi.fn(),
  getSubtreeSizeAction: vi.fn(async () => ({ ok: true, data: 0 })),
  listAllPositionsAction: vi.fn(async () => ({ ok: true, data: [] })),
  listDepartmentOptionsAction: vi.fn(async () => ({ ok: true, data: [] })),
  listJobGradeOptionsAction: vi.fn(async () => ({ ok: true, data: [] })),
  listPositionCareerOptionsAction: vi.fn(async () => ({
    ok: true,
    data: { jobFamilies: [], careerTracks: [], levelMappingEntries: [] },
  })),
}));

vi.mock("@/app/(app)/organogram/export-actions", () => ({
  requestExportAction: vi.fn(),
  getExportJobAction: vi.fn(),
  listExportJobsAction: vi.fn(),
  cancelExportJobAction: vi.fn(),
  downloadExportFileAction: vi.fn(),
}));

// Bare RTL render has no Next.js App Router context — same workaround
// Phase 7 established for the Positions/Employees/Departments list views
// (lib/utils/search-params.ts consumers). This component updates the URL
// via the native History API directly (see organogram-view.tsx's
// updateUrl — deliberately not next/navigation's router, which would
// force a real server round-trip on every filter/search/focus change),
// so no router stub is needed here, only useSearchParams()/usePathname().
vi.mock("next/navigation", () => ({
  useSearchParams: searchParamsMock,
  usePathname: () => "/organogram",
}));

import { OrganogramView } from "./organogram-view";
import { listDepartmentOptionsAction } from "@/app/(app)/positions/actions";
import type { OrganogramChartData } from "@/lib/services/organogram.service";
import type { OrganogramNode } from "@/lib/domain/organogram";

/** A minimal single-root org so the toolbar (and thus the Arrange control) renders. */
function rootedOrg(): OrganogramChartData {
  const root: OrganogramNode = {
    positionId: "root",
    positionCode: "ROOT",
    title: "CEO",
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
  };
  return makeData({
    nodes: [root],
    safety: {
      hasRoot: true,
      extraRootCount: 0,
      cyclePositionCount: 0,
      disconnectedPositionCount: 0,
    },
  });
}

function makeData(overrides: Partial<OrganogramChartData> = {}): OrganogramChartData {
  return {
    company: { name: "Acme", code: "ACME", effectiveDate: "2026-09-01" },
    nodes: [],
    edges: [],
    safety: {
      hasRoot: false,
      extraRootCount: 0,
      cyclePositionCount: 0,
      disconnectedPositionCount: 0,
    },
    leadership: {
      applied: true,
      minGradeLevel: 7,
      departmentGroupCount: 0,
      shownPositionCount: 0,
      collapsedBelowThreshold: 0,
      hidden: { vacant: 0, ungraded: 0, belowGrade: 0, inactive: 0, total: 0 },
    },
    ...overrides,
  };
}

describe("OrganogramView", () => {
  beforeEach(() => searchParamsMock.mockReturnValue(new URLSearchParams()));
  afterEach(() => vi.clearAllMocks());

  it("shows a loading state, then the empty state for a company with no positions", async () => {
    getOrganogramActionMock.mockResolvedValue({ ok: true, data: makeData() });
    render(<OrganogramView canManage={true} canViewEmployeeDetails={true} canExport={true} />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("No positions yet")).toBeInTheDocument());
  });

  it("shows an Add Position link in the empty state for a manager", async () => {
    getOrganogramActionMock.mockResolvedValue({ ok: true, data: makeData() });
    render(<OrganogramView canManage={true} canViewEmployeeDetails={true} canExport={true} />);
    await waitFor(() => expect(screen.getByText("No positions yet")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /add position/i })).toBeInTheDocument();
  });

  it("hides the Add Position link in the empty state for a non-manager", async () => {
    getOrganogramActionMock.mockResolvedValue({ ok: true, data: makeData() });
    render(<OrganogramView canManage={false} canViewEmployeeDetails={true} canExport={true} />);
    await waitFor(() => expect(screen.getByText("No positions yet")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /add position/i })).not.toBeInTheDocument();
  });

  it("shows an error state with a retry button when the action fails", async () => {
    getOrganogramActionMock.mockResolvedValue({ ok: false, error: "Something went wrong." });
    render(<OrganogramView canManage={true} canViewEmployeeDetails={true} canExport={true} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("shows a data-quality warning banner when the safety analysis reports corrupted positions", async () => {
    getOrganogramActionMock.mockResolvedValue({
      ok: true,
      data: makeData({
        nodes: [
          {
            positionId: "root",
            positionCode: "ROOT",
            title: "CEO",
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
          },
        ],
        safety: {
          hasRoot: true,
          extraRootCount: 0,
          cyclePositionCount: 2,
          disconnectedPositionCount: 0,
        },
      }),
    });
    render(<OrganogramView canManage={true} canViewEmployeeDetails={true} canExport={true} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/2 positions have a data issue/)).toBeInTheDocument();
  });

  it("shows no warning banner when the hierarchy is clean", async () => {
    getOrganogramActionMock.mockResolvedValue({
      ok: true,
      data: makeData({
        nodes: [
          {
            positionId: "root",
            positionCode: "ROOT",
            title: "CEO",
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
          },
        ],
        safety: {
          hasRoot: true,
          extraRootCount: 0,
          cyclePositionCount: 0,
          disconnectedPositionCount: 0,
        },
      }),
    });
    render(<OrganogramView canManage={true} canViewEmployeeDetails={true} canExport={true} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Expand All" })).toBeInTheDocument()
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a safe empty state, never a false edge, when active filters match nothing", async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("occupancy=occupied"));
    getOrganogramActionMock.mockResolvedValue({
      ok: true,
      data: makeData({
        nodes: [
          {
            positionId: "root",
            positionCode: "ROOT",
            title: "CEO",
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
          },
        ],
        safety: {
          hasRoot: true,
          extraRootCount: 0,
          cyclePositionCount: 0,
          disconnectedPositionCount: 0,
        },
      }),
    });
    render(<OrganogramView canManage={true} canViewEmployeeDetails={true} canExport={true} />);
    await waitFor(() => expect(screen.getByText("No matching positions")).toBeInTheDocument());
    expect(screen.getByText(/no position matches the current filters/i)).toBeInTheDocument();
  });

  it('shows "Position not found" for a Position Focus deep link to a position that does not exist in this company', async () => {
    searchParamsMock.mockReturnValue(
      new URLSearchParams("view=position&position=11111111-1111-4111-8111-111111111111")
    );
    getOrganogramActionMock.mockResolvedValue({
      ok: true,
      data: makeData({
        nodes: [
          {
            positionId: "root",
            positionCode: "ROOT",
            title: "CEO",
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
          },
        ],
        safety: {
          hasRoot: true,
          extraRootCount: 0,
          cyclePositionCount: 0,
          disconnectedPositionCount: 0,
        },
      }),
    });
    render(<OrganogramView canManage={true} canViewEmployeeDetails={true} canExport={true} />);
    await waitFor(() => expect(screen.getByText("Position not found")).toBeInTheDocument());
    expect(
      screen.getByRole("button", { name: /return to full company view/i })
    ).toBeInTheDocument();
  });
  it("offers the Arrange control to managers only", async () => {
    getOrganogramActionMock.mockResolvedValue({ ok: true, data: rootedOrg() });
    const { unmount } = render(
      <OrganogramView canManage={true} canViewEmployeeDetails={true} canExport={true} />
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^arrange$/i })).toBeInTheDocument()
    );
    unmount();

    getOrganogramActionMock.mockResolvedValue({ ok: true, data: rootedOrg() });
    render(<OrganogramView canManage={false} canViewEmployeeDetails={true} canExport={false} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Expand All" })).toBeInTheDocument()
    );
    expect(screen.queryByRole("button", { name: /^arrange$/i })).not.toBeInTheDocument();
  });

  it("entering Arrange mode reveals the guidance and loads the Position-form options", async () => {
    const user = userEvent.setup();
    getOrganogramActionMock.mockResolvedValue({ ok: true, data: rootedOrg() });
    render(<OrganogramView canManage={true} canViewEmployeeDetails={true} canExport={true} />);

    const arrange = await screen.findByRole("button", { name: /^arrange$/i });
    await user.click(arrange);

    expect(screen.getByText(/drag a card onto another/i)).toBeInTheDocument();
    // The form options are loaded lazily on first entry, re-authorized server-side.
    await waitFor(() => expect(listDepartmentOptionsAction).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /arranging/i })).toBeInTheDocument();
  });
});
