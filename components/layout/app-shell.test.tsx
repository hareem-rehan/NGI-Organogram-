import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

// Deliberately NOT using vi.importActual here: the real module transitively
// imports lib/auth/config.ts (Auth.js + Prisma adapter, "server-only"
// guarded) — pulling that in would defeat the mock. hasPermission is pure
// (lib/auth/permissions.ts has no server dependency), so it's safe to
// reimplement via the same underlying function directly.
const { getCurrentUserMock } = vi.hoisted(() => ({ getCurrentUserMock: vi.fn() }));
vi.mock("@/lib/auth/current-user", async () => {
  const { roleHasPermission } = await import("@/lib/auth/permissions");
  return {
    getCurrentUser: getCurrentUserMock,
    hasPermission: (user: { role: string }, permission: string) =>
      roleHasPermission(user.role, permission as never),
  };
});

vi.mock("@/lib/auth/actions", () => ({
  signOutAction: vi.fn(),
  signInWithCompanySso: vi.fn(),
}));

import { AppShell } from "./app-shell";

const ADMIN_USER = {
  id: "u_1",
  role: "ADMIN" as const,
  status: "ACTIVE" as const,
  companyId: "c_1",
  email: "admin@example.test",
  name: "Admin User",
};

async function renderAppShell(children: React.ReactNode) {
  const element = await AppShell({ children });
  render(element);
}

describe("AppShell", () => {
  it("redirects to /sign-in when there is no session", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    await expect(renderAppShell(<p>content</p>)).rejects.toThrow("NEXT_REDIRECT:/sign-in");
  });

  it("redirects to /sign-in when the user is disabled", async () => {
    getCurrentUserMock.mockResolvedValue({ ...ADMIN_USER, status: "DISABLED" });
    await expect(renderAppShell(<p>content</p>)).rejects.toThrow("NEXT_REDIRECT:/sign-in");
  });

  it("renders successfully with page content in the main landmark for an active user", async () => {
    getCurrentUserMock.mockResolvedValue(ADMIN_USER);
    await renderAppShell(<p>Page content</p>);
    expect(screen.getByRole("main")).toHaveTextContent("Page content");
  });

  it("has exactly one banner (header) and one main landmark", async () => {
    getCurrentUserMock.mockResolvedValue(ADMIN_USER);
    await renderAppShell(<p>content</p>);
    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("renders primary navigation with an accessible name, showing every item for an ADMIN", async () => {
    getCurrentUserMock.mockResolvedValue(ADMIN_USER);
    await renderAppShell(<p>content</p>);
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("hides permission-gated nav items for a VIEWER", async () => {
    getCurrentUserMock.mockResolvedValue({ ...ADMIN_USER, role: "VIEWER" });
    await renderAppShell(<p>content</p>);
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Imports" })).not.toBeInTheDocument();
  });

  it("includes a skip-to-content link as the first focusable element", async () => {
    getCurrentUserMock.mockResolvedValue(ADMIN_USER);
    await renderAppShell(<p>content</p>);
    expect(screen.getByRole("link", { name: /skip to main content/i })).toHaveAttribute(
      "href",
      "#main-content"
    );
  });
});
