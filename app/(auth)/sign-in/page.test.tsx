import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { getCurrentUserMock, redirectMock, signInActionMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  signInActionMock: vi.fn(),
}));

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/auth/actions", () => ({ signInWithCompanySso: signInActionMock }));
vi.mock("@/lib/env.public", () => ({
  publicEnv: { NEXT_PUBLIC_APP_NAME: "Dynamic Organogram Manager" },
}));
vi.mock("@/lib/env.server", () => ({
  serverEnv: { AUTH_PROVIDER_NAME: "Company Account" },
}));

import SignInPage from "./page";

describe("SignInPage", () => {
  afterEach(() => vi.clearAllMocks());

  it("redirects to /dashboard when already signed in", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "u_1" });
    await expect(SignInPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard"
    );
    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
  });

  it("renders a sign-in button naming the configured provider when signed out", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const element = await SignInPage({ searchParams: Promise.resolve({}) });
    render(element);

    expect(
      screen.getByRole("button", { name: /sign in with company account/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a safe generic message for AccessDenied, never the raw error code", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const element = await SignInPage({ searchParams: Promise.resolve({ error: "AccessDenied" }) });
    render(element);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/isn't authorized|has been disabled/i);
    expect(alert.textContent).not.toMatch(/AccessDenied/);
  });

  it("renders the generic fallback message for an unrecognized error code", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const element = await SignInPage({
      searchParams: Promise.resolve({ error: "SomeUnknownProviderCode" }),
    });
    render(element);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/something went wrong/i);
    expect(alert.textContent).not.toMatch(/SomeUnknownProviderCode/);
  });
});
