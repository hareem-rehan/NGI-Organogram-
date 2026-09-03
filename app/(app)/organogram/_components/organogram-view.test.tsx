import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { getOrganogramActionMock, searchParamsMock } = vi.hoisted(() => ({
  getOrganogramActionMock: vi.fn(),
  searchParamsMock: vi.fn(() => new URLSearchParams()),
}));

vi.mock("@/app/(app)/organogram/actions", () => ({
  getOrganogramAction: getOrganogramActionMock,
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
import type { OrganogramData } from "@/lib/services/organogram.service";

function makeData(overrides: Partial<OrganogramData> = {}): OrganogramData {
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
});
