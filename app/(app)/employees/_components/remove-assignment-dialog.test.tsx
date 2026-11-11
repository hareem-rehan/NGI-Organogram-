import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Employee, Position } from "@prisma/client";

const { removeAssignmentActionMock } = vi.hoisted(() => ({
  removeAssignmentActionMock: vi.fn(),
}));

vi.mock("@/app/(app)/employees/actions", () => ({
  removeAssignmentAction: removeAssignmentActionMock,
}));

import { RemoveAssignmentDialog } from "./remove-assignment-dialog";

const EMPLOYEE = { firstName: "Riley", lastName: "Gonta" } as Employee;
const ROW = {
  id: "44444444-4444-4444-8444-444444444444",
  companyId: "company-1",
  employeeId: "33333333-3333-4333-8333-333333333333",
  positionId: "11111111-1111-4111-8111-111111111111",
  isPrimary: true,
  startDate: new Date("2025-06-22"),
  endDate: new Date("2026-11-05"),
  createdAt: new Date(),
  updatedAt: new Date(),
  position: { title: "Head of Sales and Startup Ventures" } as Position,
};

function renderDialog(props: { onRemoved?: () => void; onOpenChange?: (o: boolean) => void } = {}) {
  render(
    <RemoveAssignmentDialog
      open
      onOpenChange={props.onOpenChange ?? (() => {})}
      employee={EMPLOYEE}
      assignment={ROW}
      onRemoved={props.onRemoved ?? (() => {})}
    />
  );
}

describe("RemoveAssignmentDialog (D70)", () => {
  afterEach(() => vi.clearAllMocks());

  it("says exactly which row goes and that nothing else changes", () => {
    renderDialog();
    expect(
      screen.getByText(
        /Riley Gonta's assignment to Head of Sales and Startup Ventures \(2025-06-22 to 2026-11-05\) will be removed/
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/position and the employee record are not changed/i)
    ).toBeInTheDocument();
  });

  it("removes that row and refreshes", async () => {
    removeAssignmentActionMock.mockResolvedValue({ ok: true, data: {} });
    const onRemoved = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onRemoved });

    await user.click(screen.getByRole("button", { name: /remove from history/i }));

    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(removeAssignmentActionMock).toHaveBeenCalledWith({ assignmentId: ROW.id });
  });

  it("shows the server's reason and stays open when refused", async () => {
    removeAssignmentActionMock.mockResolvedValue({
      ok: false,
      error: "This is the employee's current assignment and can't be removed.",
    });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onOpenChange });

    await user.click(screen.getByRole("button", { name: /remove from history/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/can't be removed/);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
