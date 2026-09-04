import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Department } from "@prisma/client";

import { updateDepartmentSchema } from "@/lib/validation/department";

const { createDepartmentActionMock, updateDepartmentActionMock, moveDepartmentActionMock } =
  vi.hoisted(() => ({
    createDepartmentActionMock: vi.fn(),
    updateDepartmentActionMock: vi.fn(),
    moveDepartmentActionMock: vi.fn(),
  }));

vi.mock("@/app/(app)/departments/actions", () => ({
  createDepartmentAction: createDepartmentActionMock,
  updateDepartmentAction: updateDepartmentActionMock,
  moveDepartmentAction: moveDepartmentActionMock,
}));

import { DepartmentFormDialog } from "./department-form-dialog";

function makeDepartment(overrides: Partial<Department> = {}): Department {
  return {
    id: "dept-1",
    companyId: "company-1",
    name: "Engineering",
    code: "ENG",
    description: null,
    color: null,
    parentDepartmentId: null,
    status: "ACTIVE",
    displayOrder: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("DepartmentFormDialog", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders a create form with empty fields when department is null", () => {
    render(
      <DepartmentFormDialog
        open
        onOpenChange={() => {}}
        department={null}
        allDepartments={[]}
        onSaved={() => {}}
      />
    );
    expect(screen.getByRole("heading", { name: "Add Department" })).toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toHaveValue("");
    expect(screen.getByRole("button", { name: /create department/i })).toBeInTheDocument();
  });

  it("prefills the edit form with the department's current values", () => {
    const department = makeDepartment({ name: "Sales", code: "SALES" });
    render(
      <DepartmentFormDialog
        open
        onOpenChange={() => {}}
        department={department}
        allDepartments={[department]}
        onSaved={() => {}}
      />
    );
    expect(screen.getByLabelText(/name/i)).toHaveValue("Sales");
    expect(screen.getByLabelText(/code/i)).toHaveValue("SALES");
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
  });

  it("shows a validation error and never calls the server action for an empty name", async () => {
    const user = userEvent.setup();
    render(
      <DepartmentFormDialog
        open
        onOpenChange={() => {}}
        department={null}
        allDepartments={[]}
        onSaved={() => {}}
      />
    );

    await user.type(screen.getByLabelText(/code/i), "ENG");
    await user.click(screen.getByRole("button", { name: /create department/i }));

    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(createDepartmentActionMock).not.toHaveBeenCalled();
  });

  it("submits create with the entered values and calls onSaved on success", async () => {
    createDepartmentActionMock.mockResolvedValue({ ok: true, data: makeDepartment() });
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <DepartmentFormDialog
        open
        onOpenChange={onOpenChange}
        department={null}
        allDepartments={[]}
        onSaved={onSaved}
      />
    );

    await user.type(screen.getByLabelText(/name/i), "Engineering");
    await user.type(screen.getByLabelText(/code/i), "ENG");
    await user.click(screen.getByRole("button", { name: /create department/i }));

    await waitFor(() => expect(createDepartmentActionMock).toHaveBeenCalled());
    expect(createDepartmentActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Engineering", code: "ENG" })
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("shows the server's duplicate-code error and does not close the dialog", async () => {
    createDepartmentActionMock.mockResolvedValue({
      ok: false,
      error: 'Department code "ENG" is already in use in this company.',
    });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <DepartmentFormDialog
        open
        onOpenChange={onOpenChange}
        department={null}
        allDepartments={[]}
        onSaved={() => {}}
      />
    );

    await user.type(screen.getByLabelText(/name/i), "Engineering");
    await user.type(screen.getByLabelText(/code/i), "ENG");
    await user.click(screen.getByRole("button", { name: /create department/i }));

    expect(await screen.findByText(/already in use/i)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("calls moveDepartmentAction only when the parent actually changed on an edit", async () => {
    const department = makeDepartment({ parentDepartmentId: null });
    updateDepartmentActionMock.mockResolvedValue({ ok: true, data: department });
    const user = userEvent.setup();

    render(
      <DepartmentFormDialog
        open
        onOpenChange={() => {}}
        department={department}
        allDepartments={[department]}
        onSaved={() => {}}
      />
    );

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateDepartmentActionMock).toHaveBeenCalled());
    expect(moveDepartmentActionMock).not.toHaveBeenCalled();
  });

  it("sends updateDepartmentAction a payload that satisfies the real update schema (no parentDepartmentId)", async () => {
    const department = makeDepartment({
      id: "11111111-1111-4111-8111-111111111111",
      parentDepartmentId: null,
    });
    updateDepartmentActionMock.mockResolvedValue({ ok: true, data: department });
    const user = userEvent.setup();

    render(
      <DepartmentFormDialog
        open
        onOpenChange={() => {}}
        department={department}
        allDepartments={[department]}
        onSaved={() => {}}
      />
    );

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateDepartmentActionMock).toHaveBeenCalled());
    const payload = updateDepartmentActionMock.mock.calls[0]?.[0];
    expect(() => updateDepartmentSchema.parse(payload)).not.toThrow();
    expect(payload).not.toHaveProperty("parentDepartmentId");
  });

  it("does not offer the department being edited as its own parent option", () => {
    const department = makeDepartment({ id: "dept-1", name: "Engineering" });
    const other = makeDepartment({ id: "dept-2", name: "Sales", code: "SALES" });
    render(
      <DepartmentFormDialog
        open
        onOpenChange={() => {}}
        department={department}
        allDepartments={[department, other]}
        onSaved={() => {}}
      />
    );

    const parentSelect = screen.getByLabelText(/parent department/i);
    expect(within(parentSelect).queryByText("Engineering")).not.toBeInTheDocument();
    expect(within(parentSelect).getByText("Sales")).toBeInTheDocument();
  });
});
