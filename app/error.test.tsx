import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import GlobalError from "./error";

const SENSITIVE_MESSAGE =
  "PrismaClientKnownRequestError: connection to postgres://user:hunter2@db failed";

describe("GlobalError", () => {
  it("shows a generic, safe message to the user", () => {
    render(<GlobalError error={new Error(SENSITIVE_MESSAGE)} reset={() => {}} />);
    expect(screen.getByRole("heading", { name: /something went wrong/i })).toBeInTheDocument();
  });

  it("never renders the raw error message", () => {
    render(<GlobalError error={new Error(SENSITIVE_MESSAGE)} reset={() => {}} />);
    expect(screen.queryByText(/hunter2/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/postgres:\/\//i)).not.toBeInTheDocument();
    expect(screen.queryByText(/PrismaClientKnownRequestError/i)).not.toBeInTheDocument();
  });

  it("offers a recovery action that calls reset()", async () => {
    const reset = vi.fn();
    const user = userEvent.setup();
    render(<GlobalError error={new Error(SENSITIVE_MESSAGE)} reset={reset} />);

    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("offers a safe navigation action back to the dashboard", () => {
    render(<GlobalError error={new Error(SENSITIVE_MESSAGE)} reset={() => {}} />);
    expect(screen.getByRole("link", { name: /go to dashboard/i })).toHaveAttribute(
      "href",
      "/dashboard"
    );
  });
});
