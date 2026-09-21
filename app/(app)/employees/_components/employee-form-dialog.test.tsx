import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Employee } from "@prisma/client";

const { createEmployeeActionMock, updateEmployeeActionMock } = vi.hoisted(() => ({
  createEmployeeActionMock: vi.fn(),
  updateEmployeeActionMock: vi.fn(),
}));

vi.mock("@/app/(app)/employees/actions", () => ({
  createEmployeeAction: createEmployeeActionMock,
  updateEmployeeAction: updateEmployeeActionMock,
}));

import { EmployeeFormDialog } from "./employee-form-dialog";

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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("EmployeeFormDialog", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders a create form with no manager/department/level/status fields", () => {
    render(<EmployeeFormDialog open onOpenChange={() => {}} employee={null} onSaved={() => {}} />);
    expect(screen.getByRole("heading", { name: "Add Employee" })).toBeInTheDocument();
    expect(screen.getByLabelText(/employee code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/manager/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/department/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/organizational level/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/employment status/i)).not.toBeInTheDocument();
  });

  it("prefills the edit form with the employee's current values", () => {
    const employee = makeEmployee({ firstName: "New", lastName: "Name" });
    render(
      <EmployeeFormDialog open onOpenChange={() => {}} employee={employee} onSaved={() => {}} />
    );
    expect(screen.getByRole("heading", { name: "Edit New Name" })).toBeInTheDocument();
    expect(screen.getByLabelText(/employee code/i)).toHaveValue("EMP-001");
    expect(screen.getByLabelText(/first name/i)).toHaveValue("New");
    expect(screen.getByLabelText(/last name/i)).toHaveValue("Name");
  });

  it("shows a validation error and never calls the server action for a missing last name", async () => {
    const user = userEvent.setup();
    render(<EmployeeFormDialog open onOpenChange={() => {}} employee={null} onSaved={() => {}} />);

    await user.type(screen.getByLabelText(/employee code/i), "EMP-999");
    await user.type(screen.getByLabelText(/first name/i), "Solo");
    await user.click(screen.getByRole("button", { name: /create employee/i }));

    expect(await screen.findByText(/required/i)).toBeInTheDocument();
    expect(createEmployeeActionMock).not.toHaveBeenCalled();
  });

  it("submits create with entered values", async () => {
    createEmployeeActionMock.mockResolvedValue({ ok: true, data: makeEmployee() });
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(<EmployeeFormDialog open onOpenChange={() => {}} employee={null} onSaved={onSaved} />);

    await user.type(screen.getByLabelText(/employee code/i), "EMP-001");
    await user.type(screen.getByLabelText(/first name/i), "Amara");
    await user.type(screen.getByLabelText(/last name/i), "Chen");
    await user.click(screen.getByRole("button", { name: /create employee/i }));

    await waitFor(() => expect(createEmployeeActionMock).toHaveBeenCalled());
    expect(createEmployeeActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ employeeCode: "EMP-001", firstName: "Amara", lastName: "Chen" })
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("shows the server's duplicate-code error and keeps the dialog open", async () => {
    createEmployeeActionMock.mockResolvedValue({
      ok: false,
      error: 'Employee code "EMP-001" is already in use in this company.',
    });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <EmployeeFormDialog open onOpenChange={onOpenChange} employee={null} onSaved={() => {}} />
    );

    await user.type(screen.getByLabelText(/employee code/i), "EMP-001");
    await user.type(screen.getByLabelText(/first name/i), "Amara");
    await user.type(screen.getByLabelText(/last name/i), "Chen");
    await user.click(screen.getByRole("button", { name: /create employee/i }));

    expect(await screen.findByText(/already in use/i)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("edit submission never includes employmentStatus in the update payload", async () => {
    const employee = makeEmployee();
    updateEmployeeActionMock.mockResolvedValue({ ok: true, data: employee });
    const user = userEvent.setup();

    render(
      <EmployeeFormDialog open onOpenChange={() => {}} employee={employee} onSaved={() => {}} />
    );

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateEmployeeActionMock).toHaveBeenCalled());
    const payload = updateEmployeeActionMock.mock.calls[0]?.[0];
    expect(payload).not.toHaveProperty("employmentStatus");
    expect(payload).toEqual(expect.objectContaining({ employeeId: EMPLOYEE_ID }));
  });

  it("treats an empty work email as absent rather than a validation error", async () => {
    createEmployeeActionMock.mockResolvedValue({ ok: true, data: makeEmployee() });
    const user = userEvent.setup();

    render(<EmployeeFormDialog open onOpenChange={() => {}} employee={null} onSaved={() => {}} />);

    await user.type(screen.getByLabelText(/employee code/i), "EMP-001");
    await user.type(screen.getByLabelText(/first name/i), "Amara");
    await user.type(screen.getByLabelText(/last name/i), "Chen");
    await user.click(screen.getByRole("button", { name: /create employee/i }));

    await waitFor(() => expect(createEmployeeActionMock).toHaveBeenCalled());
    expect(createEmployeeActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ workEmail: null })
    );
  });
});
