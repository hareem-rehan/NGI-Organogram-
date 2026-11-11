import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Employee, Position } from "@prisma/client";

const { changeAssignmentStartDateActionMock } = vi.hoisted(() => ({
  changeAssignmentStartDateActionMock: vi.fn(),
}));

vi.mock("@/app/(app)/employees/actions", () => ({
  changeAssignmentStartDateAction: changeAssignmentStartDateActionMock,
}));

import { EditAssignmentStartDialog } from "./edit-assignment-start-dialog";

const EMPLOYEE: Employee = {
  id: "33333333-3333-4333-8333-333333333333",
  companyId: "company-1",
  employeeCode: "EMP-017",
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

const POSITION = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Lead DevOps",
} as Position;

const CURRENT_ASSIGNMENT = {
  assignmentId: "44444444-4444-4444-8444-444444444444",
  jobGrade: null,
  jobFamilyName: null,
  startDate: new Date("2026-10-02"),
  position: POSITION,
};

function renderDialog(
  props: { onSaved?: () => void; onOpenChange?: (open: boolean) => void } = {}
) {
  return render(
    <EditAssignmentStartDialog
      open
      onOpenChange={props.onOpenChange ?? (() => {})}
      employee={EMPLOYEE}
      currentAssignment={CURRENT_ASSIGNMENT}
      onSaved={props.onSaved ?? (() => {})}
    />
  );
}

describe("EditAssignmentStartDialog (D69)", () => {
  afterEach(() => vi.clearAllMocks());

  it("starts from the current start date, and can't save it unchanged", () => {
    renderDialog();
    expect(screen.getByLabelText(/^assignment start date/i)).toHaveValue("2026-10-02");
    expect(screen.getByRole("button", { name: /save start date/i })).toBeDisabled();
    expect(screen.getByText(/position and reporting line stay the same/i)).toBeInTheDocument();
  });

  it("saves the new date for the current assignment", async () => {
    changeAssignmentStartDateActionMock.mockResolvedValue({ ok: true, data: {} });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onSaved });

    const input = screen.getByLabelText(/^assignment start date/i);
    await user.clear(input);
    await user.type(input, "2026-09-15");
    await user.click(screen.getByRole("button", { name: /save start date/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(changeAssignmentStartDateActionMock).toHaveBeenCalledWith({
      assignmentId: CURRENT_ASSIGNMENT.assignmentId,
      startDate: new Date("2026-09-15"),
    });
  });

  it("warns when the new date is in the future", async () => {
    const user = userEvent.setup();
    renderDialog();
    const input = screen.getByLabelText(/^assignment start date/i);
    await user.clear(input);
    await user.type(input, "2999-01-01");
    expect(screen.getByText(/show as unassigned/i)).toBeInTheDocument();
  });

  it("shows the server's reason and stays open when the date is refused", async () => {
    changeAssignmentStartDateActionMock.mockResolvedValue({
      ok: false,
      error: "That start date overlaps the employee's other assignment.",
    });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onOpenChange });

    const input = screen.getByLabelText(/^assignment start date/i);
    await user.clear(input);
    await user.type(input, "2026-01-01");
    await user.click(screen.getByRole("button", { name: /save start date/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/overlaps/);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
