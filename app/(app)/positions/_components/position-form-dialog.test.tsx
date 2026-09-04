import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Department, JobGrade, Position } from "@prisma/client";

const { createPositionActionMock, updatePositionActionMock } = vi.hoisted(() => ({
  createPositionActionMock: vi.fn(),
  updatePositionActionMock: vi.fn(),
}));

vi.mock("@/app/(app)/positions/actions", () => ({
  createPositionAction: createPositionActionMock,
  updatePositionAction: updatePositionActionMock,
}));

import { PositionFormDialog } from "./position-form-dialog";

const DEPARTMENT_ID = "11111111-1111-4111-8111-111111111111";
const JOB_GRADE_ID = "22222222-2222-4222-8222-222222222222";
const POSITION_ID = "33333333-3333-4333-8333-333333333333";

const DEPARTMENT: Department = {
  id: DEPARTMENT_ID,
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
};

const JOB_GRADE: JobGrade = {
  id: JOB_GRADE_ID,
  companyId: "company-1",
  name: "L5",
  code: "L5",
  description: null,
  displayOrder: null,
  status: "ACTIVE",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: POSITION_ID,
    companyId: "company-1",
    departmentId: DEPARTMENT_ID,
    jobGradeId: null,
    title: "Engineering Manager",
    positionCode: "POS-ENGMGR",
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

describe("PositionFormDialog", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders a create form with a Reports-To picker when position is null", () => {
    render(
      <PositionFormDialog
        open
        onOpenChange={() => {}}
        position={null}
        departments={[DEPARTMENT]}
        jobGrades={[JOB_GRADE]}
        allPositions={[]}
        onSaved={() => {}}
      />
    );
    expect(screen.getByRole("heading", { name: "Add Position" })).toBeInTheDocument();
    expect(screen.getByLabelText(/reports to/i)).toBeInTheDocument();
  });

  it("does not show a Reports-To picker when editing (that's a separate dedicated flow)", () => {
    const position = makePosition();
    render(
      <PositionFormDialog
        open
        onOpenChange={() => {}}
        position={position}
        departments={[DEPARTMENT]}
        jobGrades={[JOB_GRADE]}
        allPositions={[position]}
        onSaved={() => {}}
      />
    );
    expect(screen.getByText(/change reports-to.*instead/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^reports to$/i)).not.toBeInTheDocument();
  });

  it("prefills the edit form with the position's current values", () => {
    const position = makePosition({ title: "VP Engineering", positionCode: "POS-VPENG" });
    render(
      <PositionFormDialog
        open
        onOpenChange={() => {}}
        position={position}
        departments={[DEPARTMENT]}
        jobGrades={[JOB_GRADE]}
        allPositions={[position]}
        onSaved={() => {}}
      />
    );
    expect(screen.getByLabelText(/title/i)).toHaveValue("VP Engineering");
    expect(screen.getByLabelText(/code/i)).toHaveValue("POS-VPENG");
  });

  it("shows a validation error and never calls the server action for a missing title", async () => {
    const user = userEvent.setup();
    render(
      <PositionFormDialog
        open
        onOpenChange={() => {}}
        position={null}
        departments={[DEPARTMENT]}
        jobGrades={[]}
        allPositions={[]}
        onSaved={() => {}}
      />
    );

    await user.type(screen.getByLabelText(/code/i), "POS-X");
    await user.click(screen.getByRole("button", { name: /create position/i }));

    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
    expect(createPositionActionMock).not.toHaveBeenCalled();
  });

  it("submits create with entered values including the department default", async () => {
    createPositionActionMock.mockResolvedValue({ ok: true, data: makePosition() });
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(
      <PositionFormDialog
        open
        onOpenChange={() => {}}
        position={null}
        departments={[DEPARTMENT]}
        jobGrades={[]}
        allPositions={[]}
        onSaved={onSaved}
      />
    );

    await user.type(screen.getByLabelText(/title/i), "Engineering Manager");
    await user.type(screen.getByLabelText(/code/i), "POS-ENGMGR");
    await user.click(screen.getByRole("button", { name: /create position/i }));

    await waitFor(() => expect(createPositionActionMock).toHaveBeenCalled());
    expect(createPositionActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Engineering Manager",
        positionCode: "POS-ENGMGR",
        departmentId: DEPARTMENT_ID,
      })
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("shows the server's duplicate-code error and keeps the dialog open", async () => {
    createPositionActionMock.mockResolvedValue({
      ok: false,
      error: 'Position code "POS-ENGMGR" is already in use in this company.',
    });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <PositionFormDialog
        open
        onOpenChange={onOpenChange}
        position={null}
        departments={[DEPARTMENT]}
        jobGrades={[]}
        allPositions={[]}
        onSaved={() => {}}
      />
    );

    await user.type(screen.getByLabelText(/title/i), "Engineering Manager");
    await user.type(screen.getByLabelText(/code/i), "POS-ENGMGR");
    await user.click(screen.getByRole("button", { name: /create position/i }));

    expect(await screen.findByText(/already in use/i)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("edit submission never includes primaryReportsToPositionId in the update payload", async () => {
    const position = makePosition();
    updatePositionActionMock.mockResolvedValue({ ok: true, data: position });
    const user = userEvent.setup();

    render(
      <PositionFormDialog
        open
        onOpenChange={() => {}}
        position={position}
        departments={[DEPARTMENT]}
        jobGrades={[]}
        allPositions={[position]}
        onSaved={() => {}}
      />
    );

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updatePositionActionMock).toHaveBeenCalled());
    const payload = updatePositionActionMock.mock.calls[0]?.[0];
    expect(payload).not.toHaveProperty("primaryReportsToPositionId");
  });
});
