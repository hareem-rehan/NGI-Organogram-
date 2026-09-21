import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Employee } from "@prisma/client";

const { assignEmployeeActionMock, listEligiblePositionsActionMock } = vi.hoisted(() => ({
  assignEmployeeActionMock: vi.fn(),
  listEligiblePositionsActionMock: vi.fn(),
}));

vi.mock("@/app/(app)/employees/actions", () => ({
  assignEmployeeAction: assignEmployeeActionMock,
  listEligiblePositionsAction: listEligiblePositionsActionMock,
}));

import { AssignPositionDialog } from "./assign-position-dialog";

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

// Note: the eligible-position Combobox itself (search + select) is
// deliberately NOT exercised at this component-test level — opening the
// underlying Radix Popover hangs indefinitely in this project's jsdom
// environment (see app/(app)/positions/_components/position-move-dialog.test.tsx
// for the full root-cause writeup). That interaction is covered in a real
// browser by e2e/employees.spec.ts instead.
describe("AssignPositionDialog", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders the dialog with today's date preselected and Assign disabled with no selection", async () => {
    listEligiblePositionsActionMock.mockResolvedValue({ ok: true, data: [] });

    render(
      <AssignPositionDialog
        open
        onOpenChange={() => {}}
        employee={EMPLOYEE}
        onAssigned={() => {}}
      />
    );

    expect(
      screen.getByRole("heading", { name: /assign amara chen to a position/i })
    ).toBeInTheDocument();
    const today = new Date().toISOString().slice(0, 10);
    expect(screen.getByLabelText(/effective start date/i)).toHaveValue(today);
    expect(screen.getByRole("button", { name: /^assign$/i })).toBeDisabled();
    await waitFor(() => expect(listEligiblePositionsActionMock).toHaveBeenCalled());
  });

  it("fetches eligible positions on mount using the default effective date", async () => {
    listEligiblePositionsActionMock.mockResolvedValue({ ok: true, data: [] });
    const today = new Date().toISOString().slice(0, 10);

    render(
      <AssignPositionDialog
        open
        onOpenChange={() => {}}
        employee={EMPLOYEE}
        onAssigned={() => {}}
      />
    );

    await waitFor(() =>
      expect(listEligiblePositionsActionMock).toHaveBeenCalledWith(
        expect.objectContaining({ effectiveDate: new Date(today) })
      )
    );
  });

  it("resets its own state each time it is reopened", async () => {
    listEligiblePositionsActionMock.mockResolvedValue({ ok: true, data: [] });
    const { rerender } = render(
      <AssignPositionDialog
        open={false}
        onOpenChange={() => {}}
        employee={EMPLOYEE}
        onAssigned={() => {}}
      />
    );

    rerender(
      <AssignPositionDialog
        open
        onOpenChange={() => {}}
        employee={EMPLOYEE}
        onAssigned={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: /^assign$/i })).toBeDisabled();
  });
});
