import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { getCurrentUserMock, redirectMock, notFoundMock, isDevSignInEnabledMock } = vi.hoisted(
  () => ({
    getCurrentUserMock: vi.fn(),
    redirectMock: vi.fn((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    }),
    notFoundMock: vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    }),
    isDevSignInEnabledMock: vi.fn(() => true),
  })
);

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock, notFound: notFoundMock }));
vi.mock("@/lib/auth/dev-sign-in", () => ({ isDevSignInEnabled: isDevSignInEnabledMock }));
vi.mock("./actions", () => ({ devSignInAsRoleAction: vi.fn() }));

import DevSignInPage from "./page";

describe("DevSignInPage", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders 404 (notFound) when dev sign-in is disabled, before ever checking who's signed in", async () => {
    isDevSignInEnabledMock.mockReturnValue(false);
    await expect(DevSignInPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getCurrentUserMock).not.toHaveBeenCalled();
  });

  it("redirects to /dashboard when already signed in", async () => {
    isDevSignInEnabledMock.mockReturnValue(true);
    getCurrentUserMock.mockResolvedValue({ id: "u_1" });
    await expect(DevSignInPage()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
  });

  it("renders one sign-in button per role when enabled and signed out", async () => {
    isDevSignInEnabledMock.mockReturnValue(true);
    getCurrentUserMock.mockResolvedValue(null);
    const element = await DevSignInPage();
    render(element);

    expect(screen.getByRole("button", { name: "Sign in as ADMIN" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in as HR_EDITOR" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in as VIEWER" })).toBeInTheDocument();
  });
});
