import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const {
  listUsersActionMock,
  provisionUserActionMock,
  changeUserRoleActionMock,
  disableUserActionMock,
  reactivateUserActionMock,
  linkEmployeeActionMock,
  unlinkEmployeeActionMock,
  searchEmployeesForLinkingActionMock,
} = vi.hoisted(() => ({
  listUsersActionMock: vi.fn(),
  provisionUserActionMock: vi.fn(),
  changeUserRoleActionMock: vi.fn(),
  disableUserActionMock: vi.fn(),
  reactivateUserActionMock: vi.fn(),
  linkEmployeeActionMock: vi.fn(),
  unlinkEmployeeActionMock: vi.fn(),
  searchEmployeesForLinkingActionMock: vi.fn(),
}));

vi.mock("@/app/(app)/users/actions", () => ({
  listUsersAction: listUsersActionMock,
  provisionUserAction: provisionUserActionMock,
  changeUserRoleAction: changeUserRoleActionMock,
  disableUserAction: disableUserActionMock,
  reactivateUserAction: reactivateUserActionMock,
  linkEmployeeAction: linkEmployeeActionMock,
  unlinkEmployeeAction: unlinkEmployeeActionMock,
  searchEmployeesForLinkingAction: searchEmployeesForLinkingActionMock,
}));

import { UsersView } from "./users-view";

const SAMPLE_USER = {
  id: "user-1",
  companyId: "c1",
  linkedEmployeeId: null,
  name: "Ada Lovelace",
  email: "ada@northwind-example.test",
  emailVerified: null,
  image: null,
  role: "VIEWER" as const,
  status: "ACTIVE" as const,
  lastLoginAt: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

describe("UsersView", () => {
  it("renders the user list", async () => {
    listUsersActionMock.mockResolvedValue({
      ok: true,
      data: { users: [SAMPLE_USER], total: 1, page: 1, pageSize: 25 },
    });
    render(<UsersView />);
    await waitFor(() => expect(screen.getByText("ada@northwind-example.test")).toBeInTheDocument());
    expect(within(screen.getByRole("table")).getByText("VIEWER")).toBeInTheDocument();
  });

  it("shows an empty state with no matching users", async () => {
    listUsersActionMock.mockResolvedValue({
      ok: true,
      data: { users: [], total: 0, page: 1, pageSize: 25 },
    });
    render(<UsersView />);
    await waitFor(() => expect(screen.getByText(/no matching users/i)).toBeInTheDocument());
  });

  it("provisioning an elevated role requires the explicit confirmation checkbox before Provision is enabled", async () => {
    listUsersActionMock.mockResolvedValue({
      ok: true,
      data: { users: [], total: 0, page: 1, pageSize: 25 },
    });
    const user = userEvent.setup();
    render(<UsersView />);
    await waitFor(() => expect(listUsersActionMock).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /provision user/i }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/company email/i), "new@northwind-example.test");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /^role$/i }), "ADMIN");

    const provisionButton = within(dialog).getByRole("button", { name: /^provision user$/i });
    expect(provisionButton).toBeDisabled();

    await user.click(screen.getByRole("checkbox"));
    expect(provisionButton).not.toBeDisabled();

    provisionUserActionMock.mockResolvedValue({ ok: true, data: SAMPLE_USER });
    await user.click(provisionButton);
    await waitFor(() => expect(provisionUserActionMock).toHaveBeenCalled());
  });

  it("disabling a user shows a confirmation dialog and surfaces a last-admin rejection safely", async () => {
    listUsersActionMock.mockResolvedValue({
      ok: true,
      data: {
        users: [{ ...SAMPLE_USER, role: "ADMIN" as const }],
        total: 1,
        page: 1,
        pageSize: 25,
      },
    });
    disableUserActionMock.mockResolvedValue({
      ok: false,
      error:
        "This company must always have at least one active ADMIN — this action would leave zero.",
    });

    const user = userEvent.setup();
    render(<UsersView />);
    await waitFor(() => expect(screen.getByText("ada@northwind-example.test")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /^disable$/i }));
    expect(screen.getByText(/immediately lose access/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /disable user/i }));
    await waitFor(() => expect(screen.getByText(/at least one active admin/i)).toBeInTheDocument());
  });
});
