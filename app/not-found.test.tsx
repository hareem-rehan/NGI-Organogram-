import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import NotFound from "./not-found";

describe("NotFound", () => {
  it("renders a clear heading", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { level: 1, name: /page not found/i })).toBeInTheDocument();
  });

  it("offers a safe way back into the application", () => {
    render(<NotFound />);
    expect(screen.getByRole("link", { name: /go to dashboard/i })).toHaveAttribute(
      "href",
      "/dashboard"
    );
  });
});
