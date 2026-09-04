import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { EnvironmentBadge } from "./environment-badge";

describe("EnvironmentBadge", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows "Test" in the Vitest environment (NODE_ENV=test)', () => {
    render(<EnvironmentBadge />);
    expect(screen.getByText("Test")).toBeInTheDocument();
  });

  it('falls back to "Development" for any non-production, non-test value', () => {
    vi.stubEnv("NODE_ENV", "development");
    render(<EnvironmentBadge />);
    expect(screen.getByText("Development")).toBeInTheDocument();
  });

  it("renders nothing in production — no badge, so nobody mistakes it for a lower environment", () => {
    vi.stubEnv("NODE_ENV", "production");
    const { container } = render(<EnvironmentBadge />);
    expect(container).toBeEmptyDOMElement();
  });
});
