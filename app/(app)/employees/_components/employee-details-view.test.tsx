import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Employee, Position } from "@prisma/client";

const { getEmployeeDetailActionMock, pushMock } = vi.hoisted(() => ({
  getEmployeeDetailActionMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("@/app/(app)/employees/actions", () => ({
  getEmployeeDetailAction: getEmployeeDetailActionMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { EmployeeDetailsView } from "./employee-details-view";

const EMPLOYEE_ID = "33333333-3333-4333-8333-333333333333";

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: EMPLOYEE_ID,
    companyId: "company-1",
    employeeCode: "EMP-001",
    firstName: "Amara",
    lastName: "Chen",
    preferredName: null,
    workEmail: null,
    employmentStatus: "ACTIVE",
    joiningDate: null,
    leavingDate: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "company-1",
    departmentId: "22222222-2222-4222-8222-222222222222",
    jobGradeId: null,
    title: "Data Analyst",
    positionCode: "POS-DATA-ANALYST",
    description: null,
    location: null,
    status: "ACTIVE",
    primaryReportsToPositionId: null,
    organizationalLevel: 4,
    displayOrder: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("EmployeeDetailsView", () => {
  afterEach(() => vi.clearAllMocks());

  it("shows the unassigned state with an Assign to Position button for a manager", async () => {
    getEmployeeDetailActionMock.mockResolvedValue({
      ok: true,
      data: {
        employee: makeEmployee(),
        currentAssignment: null,
        managerPositionTitle: null,
        history: [],
      },
    });

    render(<EmployeeDetailsView employeeId={EMPLOYEE_ID} canManage={true} />);

    expect(await screen.findByText(/not currently assigned to any position/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /assign to position/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^transfer$/i })).not.toBeInTheDocument();
  });

  it("shows current-position details with derived department, manager, and level for an assigned employee", async () => {
    const position = makePosition();
    getEmployeeDetailActionMock.mockResolvedValue({
      ok: true,
      data: {
        employee: makeEmployee(),
        currentAssignment: {
          assignmentId: "a1",
          startDate: new Date("2026-02-01"),
          position,
          department: {
            id: position.departmentId,
            companyId: "company-1",
            name: "Platform Engineering",
            code: "PLAT",
            description: null,
            color: null,
            parentDepartmentId: null,
            status: "ACTIVE",
            displayOrder: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        managerPositionTitle: "Engineering Manager, Platform",
        history: [],
      },
    });

    render(<EmployeeDetailsView employeeId={EMPLOYEE_ID} canManage={true} />);

    await screen.findByText("Data Analyst");
    expect(screen.getByText("Platform Engineering")).toBeInTheDocument();
    expect(screen.getByText("Engineering Manager, Platform")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^transfer$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /end assignment/i })).toBeInTheDocument();
  });

  it("hides all manage actions for a VIEWER (canManage=false)", async () => {
    getEmployeeDetailActionMock.mockResolvedValue({
      ok: true,
      data: {
        employee: makeEmployee(),
        currentAssignment: null,
        managerPositionTitle: null,
        history: [],
      },
    });

    render(<EmployeeDetailsView employeeId={EMPLOYEE_ID} canManage={false} />);

    await screen.findByText(/not currently assigned to any position/i);
    expect(screen.queryByRole("button", { name: /assign to position/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /terminate employee/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it("hides Transfer/End Assignment/Terminate for a terminated employee", async () => {
    getEmployeeDetailActionMock.mockResolvedValue({
      ok: true,
      data: {
        employee: makeEmployee({
          employmentStatus: "TERMINATED",
          leavingDate: new Date("2026-03-01"),
        }),
        currentAssignment: null,
        managerPositionTitle: null,
        history: [],
      },
    });

    render(<EmployeeDetailsView employeeId={EMPLOYEE_ID} canManage={true} />);

    expect(await screen.findByText(/no position — employment terminated/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /assign to position/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /terminate employee/i })).not.toBeInTheDocument();
    expect(screen.getByText("Terminated")).toBeInTheDocument();
  });

  it("shows the disclaimer that history rows reflect the position's current record, not a historical snapshot", async () => {
    const position = makePosition();
    getEmployeeDetailActionMock.mockResolvedValue({
      ok: true,
      data: {
        employee: makeEmployee(),
        currentAssignment: null,
        managerPositionTitle: null,
        history: [
          {
            id: "h1",
            companyId: "company-1",
            employeeId: EMPLOYEE_ID,
            positionId: position.id,
            isPrimary: true,
            startDate: new Date("2026-01-01"),
            endDate: new Date("2026-02-01"),
            createdAt: new Date(),
            updatedAt: new Date(),
            position,
          },
        ],
      },
    });

    render(<EmployeeDetailsView employeeId={EMPLOYEE_ID} canManage={false} />);

    expect(await screen.findByText(/does not preserve a historical snapshot/i)).toBeInTheDocument();
    expect(screen.getByText(/Data Analyst/)).toBeInTheDocument();
    expect(screen.getByText("Historical")).toBeInTheDocument();
  });

  it("navigates back to the list on Back to list", async () => {
    getEmployeeDetailActionMock.mockResolvedValue({
      ok: true,
      data: {
        employee: makeEmployee(),
        currentAssignment: null,
        managerPositionTitle: null,
        history: [],
      },
    });
    const user = userEvent.setup();

    render(<EmployeeDetailsView employeeId={EMPLOYEE_ID} canManage={false} />);

    await screen.findByText(/not currently assigned to any position/i);
    await user.click(screen.getByRole("button", { name: /back to list/i }));

    expect(pushMock).toHaveBeenCalledWith("/employees");
  });

  it("shows an error state with retry when the detail fetch fails", async () => {
    getEmployeeDetailActionMock.mockResolvedValue({ ok: false, error: "Employee not found." });

    render(<EmployeeDetailsView employeeId={EMPLOYEE_ID} canManage={false} />);

    expect(await screen.findByText("Employee not found.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
