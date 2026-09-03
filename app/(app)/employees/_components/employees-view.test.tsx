import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Employee, Position } from "@prisma/client";

const { listEmployeesActionMock, listDepartmentOptionsActionMock } = vi.hoisted(() => ({
  listEmployeesActionMock: vi.fn(),
  listDepartmentOptionsActionMock: vi.fn(),
}));

vi.mock("@/app/(app)/employees/actions", () => ({
  listEmployeesAction: listEmployeesActionMock,
  listDepartmentOptionsAction: listDepartmentOptionsActionMock,
}));

// See the identical mock/rationale in positions-view.test.tsx — RTL's
// render() has no App Router context, which useSearchParams() (added
// for Phase 7 dashboard deep-linking) needs.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

import { EmployeesView } from "./employees-view";

const DEPARTMENT_ID = "22222222-2222-4222-8222-222222222222";

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    companyId: "company-1",
    employeeCode: "EMP-001",
    firstName: "Amara",
    lastName: "Chen",
    preferredName: null,
    workEmail: null,
    employmentStatus: "ACTIVE",
    joiningDate: null,
    leavingDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "company-1",
    departmentId: DEPARTMENT_ID,
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
}

describe("EmployeesView", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders an assigned employee with derived position/department/level", async () => {
    mockDefaults();
    const employee = makeEmployee();
    const position = makePosition();
    listEmployeesActionMock.mockResolvedValue({
      ok: true,
      data: {
        items: [employee],
        totalCount: 1,
        currentAssignments: {
          [employee.id]: { assignmentId: "a1", startDate: new Date(), position },
        },
      },
    });
    listDepartmentOptionsActionMock.mockResolvedValue({
      ok: true,
      data: [
        {
          id: DEPARTMENT_ID,
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

    render(<EmployeesView canManage={false} />);

    expect(await screen.findByText("Amara Chen")).toBeInTheDocument();
    expect(screen.getByText("EMP-001")).toBeInTheDocument();
    expect(screen.getByText("Chief Executive Officer")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Executive" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "1" })).toBeInTheDocument();
    expect(screen.getByText("Currently Assigned")).toBeInTheDocument();
  });

  it("shows Unassigned with blank derived fields for an employee with no current assignment", async () => {
    mockDefaults();
    const employee = makeEmployee();
    listEmployeesActionMock.mockResolvedValue({
      ok: true,
      data: { items: [employee], totalCount: 1, currentAssignments: {} },
    });

    render(<EmployeesView canManage={false} />);

    expect(await screen.findByText("Unassigned")).toBeInTheDocument();
  });

  it("uses the preferred name over first/last name when set", async () => {
    mockDefaults();
    const employee = makeEmployee({ preferredName: "Mimi" });
    listEmployeesActionMock.mockResolvedValue({
      ok: true,
      data: { items: [employee], totalCount: 1, currentAssignments: {} },
    });

    render(<EmployeesView canManage={false} />);

    expect(await screen.findByText("Mimi")).toBeInTheDocument();
    expect(screen.queryByText("Amara Chen")).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no employees", async () => {
    mockDefaults();
    listEmployeesActionMock.mockResolvedValue({
      ok: true,
      data: { items: [], totalCount: 0, currentAssignments: {} },
    });

    render(<EmployeesView canManage={false} />);

    expect(await screen.findByText(/no employees yet/i)).toBeInTheDocument();
  });

  it("shows an error state with retry when the list fails to load", async () => {
    mockDefaults();
    listEmployeesActionMock.mockResolvedValue({ ok: false, error: "Something went wrong." });

    render(<EmployeesView canManage={false} />);

    expect(await screen.findByText("Something went wrong.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("hides Add Employee for a VIEWER (canManage=false)", async () => {
    mockDefaults();
    listEmployeesActionMock.mockResolvedValue({
      ok: true,
      data: { items: [makeEmployee()], totalCount: 1, currentAssignments: {} },
    });

    render(<EmployeesView canManage={false} />);

    await screen.findByText("Amara Chen");
    expect(screen.queryByRole("button", { name: /add employee/i })).not.toBeInTheDocument();
  });

  it("shows Add Employee for HR_EDITOR/ADMIN (canManage=true)", async () => {
    mockDefaults();
    listEmployeesActionMock.mockResolvedValue({
      ok: true,
      data: { items: [makeEmployee()], totalCount: 1, currentAssignments: {} },
    });

    render(<EmployeesView canManage={true} />);

    await screen.findByText("Amara Chen");
    expect(screen.getByRole("button", { name: /add employee/i })).toBeInTheDocument();
  });

  it("re-queries the server when the assignment filter changes", async () => {
    mockDefaults();
    listEmployeesActionMock.mockResolvedValue({
      ok: true,
      data: { items: [makeEmployee()], totalCount: 1, currentAssignments: {} },
    });
    const user = userEvent.setup();

    render(<EmployeesView canManage={false} />);
    await screen.findByText("Amara Chen");
    listEmployeesActionMock.mockClear();

    await user.selectOptions(screen.getByLabelText(/^assignment$/i), "unassigned");

    await waitFor(() =>
      expect(listEmployeesActionMock).toHaveBeenCalledWith(
        expect.objectContaining({ assignment: "unassigned", page: 1 })
      )
    );
  });

  it("re-queries the server when the search text changes", async () => {
    mockDefaults();
    listEmployeesActionMock.mockResolvedValue({
      ok: true,
      data: { items: [makeEmployee()], totalCount: 1, currentAssignments: {} },
    });
    const user = userEvent.setup();

    render(<EmployeesView canManage={false} />);
    await screen.findByText("Amara Chen");
    listEmployeesActionMock.mockClear();

    await user.type(screen.getByLabelText(/^search$/i), "Amara");

    await waitFor(() =>
      expect(listEmployeesActionMock).toHaveBeenCalledWith(
        expect.objectContaining({ search: "Amara" })
      )
    );
  });

  it("links the employee name to their details page", async () => {
    mockDefaults();
    const employee = makeEmployee();
    listEmployeesActionMock.mockResolvedValue({
      ok: true,
      data: { items: [employee], totalCount: 1, currentAssignments: {} },
    });

    render(<EmployeesView canManage={false} />);

    const link = await screen.findByRole("link", { name: "Amara Chen" });
    expect(link).toHaveAttribute("href", `/employees/${employee.id}`);
  });
});
