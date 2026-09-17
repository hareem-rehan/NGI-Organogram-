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
  departmentId: null,
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
    // The Code field was removed — it is auto-generated and hidden.
    expect(screen.queryByLabelText(/^code$/i)).not.toBeInTheDocument();
    // Location was removed too.
    expect(screen.queryByLabelText(/location/i)).not.toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: /create position/i }));

    await waitFor(() => expect(createPositionActionMock).toHaveBeenCalled());
    // No positionCode from the form — the action generates one.
    expect(createPositionActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Engineering Manager",
        departmentId: DEPARTMENT_ID,
      })
    );
    expect(createPositionActionMock.mock.calls[0]?.[0]).not.toHaveProperty("positionCode");
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("pre-fills the Level name with the department's existing name and submits it", async () => {
    createPositionActionMock.mockResolvedValue({ ok: true, data: makePosition() });
    const onSaved = vi.fn();
    const user = userEvent.setup();

    // A level this department already defines under a bespoke name.
    const deptGrade: JobGrade = {
      ...JOB_GRADE,
      id: "44444444-4444-4444-8444-444444444444",
      departmentId: DEPARTMENT_ID,
      code: "L7",
      name: "Principal Engineer",
    };

    render(
      <PositionFormDialog
        open
        onOpenChange={() => {}}
        position={null}
        departments={[DEPARTMENT]}
        jobGrades={[deptGrade]}
        allPositions={[]}
        onSaved={onSaved}
      />
    );

    await user.type(screen.getByLabelText(/title/i), "Staff Engineer");
    // The Level name field appears only once a level is chosen.
    expect(screen.queryByLabelText(/level name/i)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/^level$/i), "L7");

    const levelName = screen.getByLabelText(/level name/i);
    expect(levelName).toHaveValue("Principal Engineer");

    await user.clear(levelName);
    await user.type(levelName, "Staff Engineer");
    await user.click(screen.getByRole("button", { name: /create position/i }));

    await waitFor(() => expect(createPositionActionMock).toHaveBeenCalled());
    expect(createPositionActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Staff Engineer",
        departmentId: DEPARTMENT_ID,
        jobGradeCode: "L7",
        jobGradeName: "Staff Engineer",
      })
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("shows a server error and keeps the dialog open", async () => {
    createPositionActionMock.mockResolvedValue({
      ok: false,
      error: "Something went wrong. Please try again.",
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
    await user.click(screen.getByRole("button", { name: /create position/i }));

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
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
