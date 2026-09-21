import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { LoadingState } from "./loading-state";

describe("LoadingState", () => {
  it("announces itself to assistive technology via role=status", () => {
    render(<LoadingState />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows a default label", () => {
    render(<LoadingState />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows a custom label when provided", () => {
    render(<LoadingState label="Loading departments…" />);
    expect(screen.getByText("Loading departments…")).toBeInTheDocument();
  });
});
