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

  it("warns on every page when a production build has sign-in bypassed", () => {
    // This instance looks like production and is not secured like it —
    // anyone reaching the URL can sign in as ADMIN. Distinguishable only
    // by an extra page existing would not be good enough.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_ALLOW_DEV_SIGN_IN", "true");
    render(<EnvironmentBadge />);
    expect(screen.getByText("Sign-in bypassed")).toBeInTheDocument();
  });

  it("stays silent on a production build where the flag is anything but 'true'", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_ALLOW_DEV_SIGN_IN", "false");
    const { container } = render(<EnvironmentBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not warn in local development, where nothing is being bypassed", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_ALLOW_DEV_SIGN_IN", "true");
    render(<EnvironmentBadge />);
    expect(screen.getByText("Development")).toBeInTheDocument();
    expect(screen.queryByText("Sign-in bypassed")).not.toBeInTheDocument();
  });
});
