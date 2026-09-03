import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { getDashboardActionMock } = vi.hoisted(() => ({
  getDashboardActionMock: vi.fn(),
}));

vi.mock("@/app/(app)/dashboard/actions", () => ({
  getDashboardAction: getDashboardActionMock,
}));

import { DashboardView } from "./dashboard-view";
import type { DashboardSummary } from "@/lib/services/dashboard.service";

function makeSummary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    company: {
      name: "Northwind Example Co.",
      code: "NORTHWIND-EXAMPLE",
      timezone: "UTC",
      effectiveDate: "2026-09-01",
      lastRefreshed: "2026-09-01T12:00:00.000Z",
    },
    departments: { totalActive: 4, totalInactive: 0, topLevelActive: 3, nestedActive: 1 },
    positions: {
      totalActive: 10,
      occupied: 9,
      vacant: 1,
      planned: 1,
      inactive: 0,
      root: { id: "root-id", title: "Chief Executive Officer", status: "ACTIVE", isActive: true },
      maxLevel: 5,
      levelDistribution: [
        { level: 1, count: 1 },
        { level: 2, count: 2 },
      ],
      disconnectedActiveCount: 0,
    },
    employees: { active: 10, activeAssigned: 9, activeUnassigned: 1, inactiveOrTerminated: 0 },
    assignments: {
      currentPrimary: 9,
      future: 0,
      multiOccupantPositionCount: 0,
      multiPrimaryEmployeeCount: 0,
    },
    vacancyRate: { vacantCount: 1, eligibleCount: 10, percent: 10 },
    departmentSummaries: [
      {
        id: "dept-1",
        name: "Engineering",
        code: "ENG",
        color: "#16a34a",
        status: "ACTIVE",
        activePositionCount: 5,
        occupiedPositionCount: 4,
        vacantPositionCount: 1,
        plannedPositionCount: 0,
        activeAssignedEmployeeCount: 4,
        activeUnassignedAttributed: false,
        maxOrganizationalLevel: 4,
        childDepartmentCount: 1,
      },
    ],
    warnings: [],
    sectionErrors: { departmentSummaries: false, warnings: false },
    ...overrides,
  };
}

describe("DashboardView", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders the company header and summary cards once loaded", async () => {
    getDashboardActionMock.mockResolvedValue({ ok: true, data: makeSummary() });

    render(<DashboardView canManage={false} />);

    expect(await screen.findByText(/northwind example co\./i)).toBeInTheDocument();
    // The card's clickable link and its visible value are siblings (a
    // "stretched link" pattern — see dashboard-view.tsx's SummaryCard doc
    // comment for why the value isn't nested inside the <a> itself), so
    // check the shared card container rather than the link's own text.
    expect(screen.getByRole("link", { name: /active employees/i }).parentElement).toHaveTextContent(
      "10"
    );
    expect(screen.getByRole("link", { name: /active positions/i }).parentElement).toHaveTextContent(
      "10"
    );
    expect(screen.getByText("Occupied Positions")).toBeInTheDocument();
    expect(screen.getByText("Vacant Positions")).toBeInTheDocument();
    expect(screen.getByText("Planned Positions")).toBeInTheDocument();
  });

  it("shows a loading state before data arrives", () => {
    getDashboardActionMock.mockReturnValue(new Promise(() => {}));
    render(<DashboardView canManage={false} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows an error state with retry when the load fails", async () => {
    getDashboardActionMock.mockResolvedValue({ ok: false, error: "Something went wrong." });

    render(<DashboardView canManage={false} />);

    expect(await screen.findByText("Something went wrong.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("shows the no-root-position empty state for a company with zero positions", async () => {
    getDashboardActionMock.mockResolvedValue({
      ok: true,
      data: makeSummary({
        positions: {
          totalActive: 0,
          occupied: 0,
          vacant: 0,
          planned: 0,
          inactive: 0,
          root: null,
          maxLevel: null,
          levelDistribution: [],
          disconnectedActiveCount: 0,
        },
      }),
    });

    render(<DashboardView canManage={true} />);

    expect(await screen.findByText(/no root position yet/i)).toBeInTheDocument();
    expect(screen.getByText(/create the first position/i)).toBeInTheDocument();
  });

  it("shows a company-not-set-up message (no management action) for VIEWER when there is no root", async () => {
    getDashboardActionMock.mockResolvedValue({
      ok: true,
      data: makeSummary({
        positions: {
          totalActive: 0,
          occupied: 0,
          vacant: 0,
          planned: 0,
          inactive: 0,
          root: null,
          maxLevel: null,
          levelDistribution: [],
          disconnectedActiveCount: 0,
        },
      }),
    });

    render(<DashboardView canManage={false} />);

    expect(await screen.findByText(/not been set up yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /add position/i })).not.toBeInTheDocument();
  });

  it("zero is rendered as valid data, not an error, for a genuinely empty vacancy/occupied count", async () => {
    getDashboardActionMock.mockResolvedValue({
      ok: true,
      data: makeSummary({
        positions: {
          totalActive: 3,
          occupied: 3,
          vacant: 0,
          planned: 0,
          inactive: 0,
          root: { id: "r", title: "CEO", status: "ACTIVE", isActive: true },
          maxLevel: 1,
          levelDistribution: [{ level: 1, count: 3 }],
          disconnectedActiveCount: 0,
        },
        vacancyRate: { vacantCount: 0, eligibleCount: 3, percent: 0 },
      }),
    });

    render(<DashboardView canManage={false} />);

    await screen.findByText("Occupied Positions");
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("shows '—' (not 0% or an error) for the vacancy rate when there are zero eligible positions", async () => {
    getDashboardActionMock.mockResolvedValue({
      ok: true,
      data: makeSummary({ vacancyRate: { vacantCount: 0, eligibleCount: 0, percent: null } }),
    });

    render(<DashboardView canManage={false} />);

    await screen.findByText(/vacancy overview/i);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("hides the data-quality section entirely for a VIEWER (canManage=false)", async () => {
    getDashboardActionMock.mockResolvedValue({
      ok: true,
      data: makeSummary({
        warnings: [
          {
            id: "no-active-root",
            title: "No active root position",
            description: "test",
            count: 1,
          },
        ],
      }),
    });

    render(<DashboardView canManage={false} />);

    await screen.findByText(/northwind example co\./i);
    expect(screen.queryByText("Data quality")).not.toBeInTheDocument();
    expect(screen.queryByText("No active root position")).not.toBeInTheDocument();
  });

  it("shows warnings with counts and links for HR_EDITOR/ADMIN (canManage=true)", async () => {
    getDashboardActionMock.mockResolvedValue({
      ok: true,
      data: makeSummary({
        warnings: [
          {
            id: "disconnected-position",
            title: "Disconnected active position",
            description: "One or more active positions cannot be traced to the root.",
            count: 2,
            link: { href: "/positions", label: "View positions" },
          },
        ],
      }),
    });

    render(<DashboardView canManage={true} />);

    const warningItem = (await screen.findByText("Disconnected active position")).closest("li")!;
    expect(warningItem).toHaveTextContent("2");
    expect(screen.getByRole("link", { name: /view positions/i })).toHaveAttribute(
      "href",
      "/positions"
    );
  });

  it("shows the clean empty state when there are no warnings for an authorized caller", async () => {
    getDashboardActionMock.mockResolvedValue({ ok: true, data: makeSummary({ warnings: [] }) });

    render(<DashboardView canManage={true} />);

    expect(await screen.findByText(/no structural issues detected/i)).toBeInTheDocument();
  });

  it("shows a section-unavailable message, not a crash, when departmentSummaries failed", async () => {
    getDashboardActionMock.mockResolvedValue({
      ok: true,
      data: makeSummary({
        departmentSummaries: null,
        sectionErrors: { departmentSummaries: true, warnings: false },
      }),
    });

    render(<DashboardView canManage={false} />);

    expect(await screen.findByText(/temporarily unavailable/i)).toBeInTheDocument();
    // The rest of the page still renders — company header is present.
    expect(screen.getByText(/northwind example co\./i)).toBeInTheDocument();
  });

  it("shows Add Department/Position/Employee quick actions for HR_EDITOR/ADMIN", async () => {
    getDashboardActionMock.mockResolvedValue({ ok: true, data: makeSummary() });

    render(<DashboardView canManage={true} />);

    await screen.findByText(/northwind example co\./i);
    expect(screen.getByRole("link", { name: /add department/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add position/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add employee/i })).toBeInTheDocument();
  });

  it("shows only View-role quick actions for VIEWER, never management actions", async () => {
    getDashboardActionMock.mockResolvedValue({ ok: true, data: makeSummary() });

    render(<DashboardView canManage={false} />);

    await screen.findByText(/northwind example co\./i);
    expect(screen.getByRole("link", { name: /view departments/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /add department/i })).not.toBeInTheDocument();
  });

  it("links the vacant-positions card to the filtered Positions page", async () => {
    getDashboardActionMock.mockResolvedValue({ ok: true, data: makeSummary() });

    render(<DashboardView canManage={false} />);

    await screen.findByText(/northwind example co\./i);
    const link = screen.getByRole("link", { name: /^vacant positions/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("occupancy=vacant"));
  });

  it("links the unassigned-employees text to the filtered Employees page", async () => {
    getDashboardActionMock.mockResolvedValue({ ok: true, data: makeSummary() });

    render(<DashboardView canManage={false} />);

    const link = await screen.findByRole("link", { name: /1 unassigned/i });
    expect(link).toHaveAttribute("href", "/employees?assignment=unassigned");
  });

  it("refreshes when the Refresh button is clicked", async () => {
    getDashboardActionMock.mockResolvedValue({ ok: true, data: makeSummary() });
    const user = userEvent.setup();

    render(<DashboardView canManage={false} />);
    await screen.findByText(/northwind example co\./i);
    getDashboardActionMock.mockClear();

    await user.click(screen.getByRole("button", { name: /refresh/i }));

    expect(getDashboardActionMock).toHaveBeenCalledTimes(1);
  });

  it("renders long department and company names without crashing", async () => {
    getDashboardActionMock.mockResolvedValue({
      ok: true,
      data: makeSummary({
        company: {
          name: "A".repeat(150),
          code: "LONGCODE",
          timezone: "UTC",
          effectiveDate: "2026-09-01",
          lastRefreshed: "2026-09-01T12:00:00.000Z",
        },
      }),
    });

    render(<DashboardView canManage={false} />);
    expect(await screen.findByText("A".repeat(150), { exact: false })).toBeInTheDocument();
  });
});
