import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("renders the title and description", () => {
    render(<EmptyState title="No departments yet" description="Create your first department." />);
    expect(screen.getByText("No departments yet")).toBeInTheDocument();
    expect(screen.getByText("Create your first department.")).toBeInTheDocument();
  });

  it("hides the decorative icon from assistive tech", () => {
    const { container } = render(<EmptyState title="Nothing here" />);
    const icon = container.querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("renders an optional action", () => {
    render(<EmptyState title="Nothing here" action={<button>Create one</button>} />);
    expect(screen.getByRole("button", { name: "Create one" })).toBeInTheDocument();
  });
});
