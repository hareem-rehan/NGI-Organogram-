import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Employee, Position } from "@prisma/client";

const { transferEmployeeActionMock, listEligiblePositionsActionMock } = vi.hoisted(() => ({
  transferEmployeeActionMock: vi.fn(),
  listEligiblePositionsActionMock: vi.fn(),
}));

vi.mock("@/app/(app)/employees/actions", () => ({
  transferEmployeeAction: transferEmployeeActionMock,
  listEligiblePositionsAction: listEligiblePositionsActionMock,
}));

import { TransferEmployeeDialog } from "./transfer-employee-dialog";

const EMPLOYEE: Employee = {
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
};

const CURRENT_POSITION: Position = {
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
};

const CURRENT_ASSIGNMENT = {
  assignmentId: "44444444-4444-4444-8444-444444444444",
  startDate: new Date("2026-01-01"),
  position: CURRENT_POSITION,
};

// Note: as with AssignPositionDialog, opening the destination Combobox
// itself is not exercised here (jsdom/Radix Popover hang) — covered by
// e2e/employees.spec.ts in a real browser instead.
describe("TransferEmployeeDialog", () => {
  afterEach(() => vi.clearAllMocks());

  it("shows the current position in the summary and 'Select a position below' for the destination", async () => {
    listEligiblePositionsActionMock.mockResolvedValue({ ok: true, data: [] });

    render(
      <TransferEmployeeDialog
        open
        onOpenChange={() => {}}
        employee={EMPLOYEE}
        currentAssignment={CURRENT_ASSIGNMENT}
        currentDepartmentName="Platform Engineering"
        onTransferred={() => {}}
      />
    );

    expect(screen.getByText("Data Analyst")).toBeInTheDocument();
    expect(screen.getByText("Platform Engineering")).toBeInTheDocument();
    expect(screen.getByText(/select a position below/i)).toBeInTheDocument();
  });

  it("disables Confirm transfer until a destination is selected", async () => {
    listEligiblePositionsActionMock.mockResolvedValue({ ok: true, data: [] });

    render(
      <TransferEmployeeDialog
        open
        onOpenChange={() => {}}
        employee={EMPLOYEE}
        currentAssignment={CURRENT_ASSIGNMENT}
        currentDepartmentName="Platform Engineering"
        onTransferred={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: /confirm transfer/i })).toBeDisabled();
    await waitFor(() => expect(listEligiblePositionsActionMock).toHaveBeenCalled());
  });

  it("excludes the employee's current position from the eligible-destination results", async () => {
    listEligiblePositionsActionMock.mockResolvedValue({
      ok: true,
      data: [
        {
          position: CURRENT_POSITION,
          departmentName: "Platform Engineering",
        },
        {
          position: {
            ...CURRENT_POSITION,
            id: "55555555-5555-4555-8555-555555555555",
            title: "Head of People & Culture",
          },
          departmentName: "People & Culture",
        },
      ],
    });

    render(
      <TransferEmployeeDialog
        open
        onOpenChange={() => {}}
        employee={EMPLOYEE}
        currentAssignment={CURRENT_ASSIGNMENT}
        currentDepartmentName="Platform Engineering"
        onTransferred={() => {}}
      />
    );

    await waitFor(() => expect(listEligiblePositionsActionMock).toHaveBeenCalled());
    // The current position (same id as CURRENT_ASSIGNMENT.position.id) must never
    // appear as a selectable destination — only its summary-panel occurrence
    // ("Data Analyst" in the CURRENT column) should be present.
    expect(screen.getAllByText("Data Analyst")).toHaveLength(1);
  });
});
