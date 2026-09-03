import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Employee, Position } from "@prisma/client";

const { endAssignmentActionMock } = vi.hoisted(() => ({
  endAssignmentActionMock: vi.fn(),
}));

vi.mock("@/app/(app)/employees/actions", () => ({
  endAssignmentAction: endAssignmentActionMock,
}));

import { EndAssignmentDialog } from "./end-assignment-dialog";

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

const POSITION: Position = {
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
  position: POSITION,
};

describe("EndAssignmentDialog", () => {
  afterEach(() => vi.clearAllMocks());

  it("explains the consequence without mentioning employment status", () => {
    render(
      <EndAssignmentDialog
        open
        onOpenChange={() => {}}
        employee={EMPLOYEE}
        currentAssignment={CURRENT_ASSIGNMENT}
        onEnded={() => {}}
      />
    );
    expect(screen.getByText(/will become unassigned/i)).toBeInTheDocument();
    expect(screen.getByText(/data analyst.*will become vacant/i)).toBeInTheDocument();
    expect(screen.getByText(/record and status are not affected/i)).toBeInTheDocument();
  });

  it("calls endAssignmentAction with the current assignment id and chosen date", async () => {
    endAssignmentActionMock.mockResolvedValue({ ok: true, data: {} });
    const onEnded = vi.fn();
    const user = userEvent.setup();

    render(
      <EndAssignmentDialog
        open
        onOpenChange={() => {}}
        employee={EMPLOYEE}
        currentAssignment={CURRENT_ASSIGNMENT}
        onEnded={onEnded}
      />
    );

    await user.click(screen.getByRole("button", { name: /end assignment/i }));

    await waitFor(() => expect(endAssignmentActionMock).toHaveBeenCalled());
    expect(endAssignmentActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ assignmentId: CURRENT_ASSIGNMENT.assignmentId })
    );
    await waitFor(() => expect(onEnded).toHaveBeenCalled());
  });

  it("shows the server error and keeps the dialog open on failure", async () => {
    endAssignmentActionMock.mockResolvedValue({ ok: false, error: "Assignment already ended." });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <EndAssignmentDialog
        open
        onOpenChange={onOpenChange}
        employee={EMPLOYEE}
        currentAssignment={CURRENT_ASSIGNMENT}
        onEnded={() => {}}
      />
    );

    await user.click(screen.getByRole("button", { name: /end assignment/i }));

    expect(await screen.findByText("Assignment already ended.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
