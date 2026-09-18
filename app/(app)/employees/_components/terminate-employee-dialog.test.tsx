import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Employee } from "@prisma/client";

const { terminateEmployeeActionMock } = vi.hoisted(() => ({
  terminateEmployeeActionMock: vi.fn(),
}));

vi.mock("@/app/(app)/employees/actions", () => ({
  terminateEmployeeAction: terminateEmployeeActionMock,
}));

import { TerminateEmployeeDialog } from "./terminate-employee-dialog";

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

describe("TerminateEmployeeDialog", () => {
  afterEach(() => vi.clearAllMocks());

  it("disables the confirm button until the employee code is typed exactly", async () => {
    const user = userEvent.setup();
    render(
      <TerminateEmployeeDialog
        open
        onOpenChange={() => {}}
        employee={EMPLOYEE}
        hasActiveAssignment={false}
        onTerminated={() => {}}
      />
    );

    const confirmButton = screen.getByRole("button", { name: /terminate employee/i });
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByLabelText(/type the employee code/i), "wrong-code");
    expect(confirmButton).toBeDisabled();
    expect(terminateEmployeeActionMock).not.toHaveBeenCalled();
  });

  it("enables the confirm button once the exact employee code is typed", async () => {
    const user = userEvent.setup();
    render(
      <TerminateEmployeeDialog
        open
        onOpenChange={() => {}}
        employee={EMPLOYEE}
        hasActiveAssignment={false}
        onTerminated={() => {}}
      />
    );

    await user.type(screen.getByLabelText(/type the employee code/i), "EMP-001");
    expect(screen.getByRole("button", { name: /terminate employee/i })).toBeEnabled();
  });

  it("shows the active-assignment consequence text when the employee currently holds a position", () => {
    render(
      <TerminateEmployeeDialog
        open
        onOpenChange={() => {}}
        employee={EMPLOYEE}
        hasActiveAssignment={true}
        onTerminated={() => {}}
      />
    );
    expect(screen.getByText(/active position assignment will end/i)).toBeInTheDocument();
  });

  it("shows the no-active-assignment text when the employee is unassigned", () => {
    render(
      <TerminateEmployeeDialog
        open
        onOpenChange={() => {}}
        employee={EMPLOYEE}
        hasActiveAssignment={false}
        onTerminated={() => {}}
      />
    );
    expect(screen.getByText(/has no active assignment/i)).toBeInTheDocument();
  });

  it("calls terminateEmployeeAction only after the code is confirmed", async () => {
    terminateEmployeeActionMock.mockResolvedValue({
      ok: true,
      data: { employee: EMPLOYEE, endedAssignmentId: null },
    });
    const onTerminated = vi.fn();
    const user = userEvent.setup();

    render(
      <TerminateEmployeeDialog
        open
        onOpenChange={() => {}}
        employee={EMPLOYEE}
        hasActiveAssignment={false}
        onTerminated={onTerminated}
      />
    );

    await user.type(screen.getByLabelText(/type the employee code/i), "EMP-001");
    await user.click(screen.getByRole("button", { name: /terminate employee/i }));

    await waitFor(() => expect(terminateEmployeeActionMock).toHaveBeenCalled());
    expect(terminateEmployeeActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: EMPLOYEE.id })
    );
    await waitFor(() => expect(onTerminated).toHaveBeenCalled());
  });

  it("shows the server error and keeps the dialog open on failure", async () => {
    terminateEmployeeActionMock.mockResolvedValue({
      ok: false,
      error: "Employee is already terminated.",
    });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <TerminateEmployeeDialog
        open
        onOpenChange={onOpenChange}
        employee={EMPLOYEE}
        hasActiveAssignment={false}
        onTerminated={() => {}}
      />
    );

    await user.type(screen.getByLabelText(/type the employee code/i), "EMP-001");
    await user.click(screen.getByRole("button", { name: /terminate employee/i }));

    expect(await screen.findByText("Employee is already terminated.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
