import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import AccessDeniedPage from "./page";

describe("AccessDeniedPage", () => {
  it("renders the access-denied message and a link back to the dashboard", () => {
    render(<AccessDeniedPage />);

    expect(screen.getByText(/access denied/i)).toBeInTheDocument();
    expect(screen.getByText(/don't have permission/i)).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /go to dashboard/i });
    expect(link).toHaveAttribute("href", "/dashboard");
  });
});
