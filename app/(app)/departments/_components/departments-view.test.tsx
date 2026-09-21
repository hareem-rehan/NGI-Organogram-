import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Department } from "@prisma/client";

const {
  listDepartmentsActionMock,
  listAllDepartmentsActionMock,
  archiveDepartmentActionMock,
  reactivateDepartmentActionMock,
  deleteDepartmentActionMock,
} = vi.hoisted(() => ({
  listDepartmentsActionMock: vi.fn(),
  listAllDepartmentsActionMock: vi.fn(),
  archiveDepartmentActionMock: vi.fn(),
  reactivateDepartmentActionMock: vi.fn(),
  deleteDepartmentActionMock: vi.fn(),
}));

vi.mock("@/app/(app)/departments/actions", () => ({
  listDepartmentsAction: listDepartmentsActionMock,
  listAllDepartmentsAction: listAllDepartmentsActionMock,
  archiveDepartmentAction: archiveDepartmentActionMock,
  reactivateDepartmentAction: reactivateDepartmentActionMock,
  deleteDepartmentAction: deleteDepartmentActionMock,
}));

// See the identical mock/rationale in positions-view.test.tsx — RTL's
// render() has no App Router context, which useSearchParams() (added
// for Phase 7 dashboard deep-linking) needs.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

import { DepartmentsView } from "./departments-view";

function makeDepartment(overrides: Partial<Department> = {}): Department {
  return {
    id: "dept-1",
    companyId: "company-1",
    name: "Engineering",
    code: "ENG",
    description: null,
    color: "#16a34a",
    parentDepartmentId: null,
    status: "ACTIVE",
    displayOrder: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("DepartmentsView", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders the department list once loaded", async () => {
    listDepartmentsActionMock.mockResolvedValue({
      ok: true,
      data: { items: [makeDepartment()], totalCount: 1 },
    });
    listAllDepartmentsActionMock.mockResolvedValue({ ok: true, data: [makeDepartment()] });

    render(<DepartmentsView canManage={false} />);

    expect(await screen.findByText("Engineering")).toBeInTheDocument();
    expect(screen.getByText("ENG")).toBeInTheDocument();
  });

  it("shows the empty state when there are no departments", async () => {
    listDepartmentsActionMock.mockResolvedValue({ ok: true, data: { items: [], totalCount: 0 } });
    listAllDepartmentsActionMock.mockResolvedValue({ ok: true, data: [] });

    render(<DepartmentsView canManage={false} />);

    expect(await screen.findByText(/no departments yet/i)).toBeInTheDocument();
  });

  it("shows an error state with a retry action when the list fails to load", async () => {
    listDepartmentsActionMock.mockResolvedValue({ ok: false, error: "Something went wrong." });
    listAllDepartmentsActionMock.mockResolvedValue({ ok: true, data: [] });

    render(<DepartmentsView canManage={false} />);

    expect(await screen.findByText("Something went wrong.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("does not show Add Department or row actions for a VIEWER (canManage=false)", async () => {
    listDepartmentsActionMock.mockResolvedValue({
      ok: true,
      data: { items: [makeDepartment()], totalCount: 1 },
    });
    listAllDepartmentsActionMock.mockResolvedValue({ ok: true, data: [makeDepartment()] });

    render(<DepartmentsView canManage={false} />);

    await screen.findByText("Engineering");
    expect(screen.queryByRole("button", { name: /add department/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /deactivate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete$/i })).not.toBeInTheDocument();
  });

  it("shows Add Department and row actions for an HR_EDITOR/ADMIN (canManage=true)", async () => {
    listDepartmentsActionMock.mockResolvedValue({
      ok: true,
      data: { items: [makeDepartment()], totalCount: 1 },
    });
    listAllDepartmentsActionMock.mockResolvedValue({ ok: true, data: [makeDepartment()] });

    render(<DepartmentsView canManage={true} />);

    await screen.findByText("Engineering");
    expect(screen.getByRole("button", { name: /add department/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deactivate/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeInTheDocument();
  });

  it("re-queries the server when the search input changes", async () => {
    listDepartmentsActionMock.mockResolvedValue({
      ok: true,
      data: { items: [makeDepartment()], totalCount: 1 },
    });
    listAllDepartmentsActionMock.mockResolvedValue({ ok: true, data: [] });
    const user = userEvent.setup();

    render(<DepartmentsView canManage={false} />);
    await screen.findByText("Engineering");
    listDepartmentsActionMock.mockClear();

    await user.type(screen.getByLabelText(/search/i), "sal");

    await waitFor(() =>
      expect(listDepartmentsActionMock).toHaveBeenCalledWith(
        expect.objectContaining({ search: "sal", page: 1 })
      )
    );
  });

  it("re-queries the server when the status filter changes", async () => {
    listDepartmentsActionMock.mockResolvedValue({
      ok: true,
      data: { items: [makeDepartment()], totalCount: 1 },
    });
    listAllDepartmentsActionMock.mockResolvedValue({ ok: true, data: [] });
    const user = userEvent.setup();

    render(<DepartmentsView canManage={false} />);
    await screen.findByText("Engineering");
    listDepartmentsActionMock.mockClear();

    await user.selectOptions(screen.getByLabelText(/status/i), "INACTIVE");

    await waitFor(() =>
      expect(listDepartmentsActionMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: "INACTIVE", page: 1 })
      )
    );
  });

  it("opens a confirm dialog and calls archiveDepartmentAction on confirm", async () => {
    listDepartmentsActionMock.mockResolvedValue({
      ok: true,
      data: { items: [makeDepartment()], totalCount: 1 },
    });
    listAllDepartmentsActionMock.mockResolvedValue({ ok: true, data: [] });
    archiveDepartmentActionMock.mockResolvedValue({
      ok: true,
      data: makeDepartment({ status: "INACTIVE" }),
    });
    const user = userEvent.setup();

    render(<DepartmentsView canManage={true} />);
    await screen.findByText("Engineering");

    await user.click(screen.getByRole("button", { name: /deactivate/i }));
    expect(screen.getByRole("heading", { name: /deactivate department/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Deactivate" }));

    await waitFor(() =>
      expect(archiveDepartmentActionMock).toHaveBeenCalledWith({ departmentId: "dept-1" })
    );
  });

  it("confirms before deleting, then calls deleteDepartmentAction", async () => {
    listDepartmentsActionMock.mockResolvedValue({
      ok: true,
      data: { items: [makeDepartment()], totalCount: 1 },
    });
    listAllDepartmentsActionMock.mockResolvedValue({ ok: true, data: [] });
    deleteDepartmentActionMock.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();

    render(<DepartmentsView canManage={true} />);
    await screen.findByText("Engineering");

    // Never a one-click destructive action.
    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(deleteDepartmentActionMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: /delete department/i })).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(deleteDepartmentActionMock).toHaveBeenCalledWith({ departmentId: "dept-1" })
    );
  });

  it("shows the server's reason verbatim when a delete is refused, and keeps the row", async () => {
    listDepartmentsActionMock.mockResolvedValue({
      ok: true,
      data: { items: [makeDepartment()], totalCount: 1 },
    });
    listAllDepartmentsActionMock.mockResolvedValue({ ok: true, data: [] });
    deleteDepartmentActionMock.mockResolvedValue({
      ok: false,
      error: "Engineering still has 12 positions in it, so it cannot be deleted.",
    });
    const user = userEvent.setup();

    render(<DepartmentsView canManage={true} />);
    await screen.findByText("Engineering");

    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    // The blocker is named, not replaced by a generic failure message —
    // "12 positions" is what tells the user what to do next.
    await waitFor(() => expect(screen.getByText(/still has 12 positions/i)).toBeInTheDocument());
    // The dialog stays open and the department is still listed.
    expect(screen.getByRole("heading", { name: /delete department/i })).toBeInTheDocument();
    expect(screen.getByText("Engineering")).toBeInTheDocument();
  });

  it("shows pagination reflecting server-reported totalCount, not the current page's item count", async () => {
    listDepartmentsActionMock.mockResolvedValue({
      ok: true,
      data: { items: [makeDepartment()], totalCount: 45 },
    });
    listAllDepartmentsActionMock.mockResolvedValue({ ok: true, data: [] });

    render(<DepartmentsView canManage={false} />);

    expect(await screen.findByText(/showing 1–20 of 45/i)).toBeInTheDocument();
  });
});
