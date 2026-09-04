import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("renders the title as a heading", () => {
    render(<PageHeader title="Departments" />);
    expect(screen.getByRole("heading", { level: 1, name: "Departments" })).toBeInTheDocument();
  });

  it("renders an optional description", () => {
    render(<PageHeader title="Departments" description="Manage departments." />);
    expect(screen.getByText("Manage departments.")).toBeInTheDocument();
  });

  it("renders optional actions", () => {
    render(<PageHeader title="Departments" actions={<button>New</button>} />);
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
  });
});
