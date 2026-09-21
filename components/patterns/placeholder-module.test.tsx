import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { PlaceholderModule } from "./placeholder-module";

describe("PlaceholderModule", () => {
  it("renders the module title as the page heading", () => {
    render(
      <PlaceholderModule title="Departments" description="Manage departments." plannedPhase={4} />
    );
    expect(screen.getByRole("heading", { level: 1, name: "Departments" })).toBeInTheDocument();
  });

  it("clearly states which future phase implements this module", () => {
    render(
      <PlaceholderModule title="Departments" description="Manage departments." plannedPhase={4} />
    );
    expect(screen.getByText(/Planned for Phase 4/i)).toBeInTheDocument();
    expect(screen.getByText(/Phase 4 of the delivery plan/i)).toBeInTheDocument();
  });

  it("renders no interactive controls — no fake working CRUD buttons", () => {
    render(
      <PlaceholderModule title="Departments" description="Manage departments." plannedPhase={4} />
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
