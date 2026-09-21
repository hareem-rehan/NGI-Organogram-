import { describe, expect, it } from "vitest";

/**
 * Proves the server/client boundary is actually enforced, not just
 * documented. Vitest (like any plain Vite/Node context) does not set the
 * "react-server" export condition that Next.js's server bundler sets —
 * so the "server-only" package resolves to its throwing stub here, the
 * same way it would if a client component tried to import
 * lib/env.server.ts directly. If this test ever stops throwing, the
 * server/client boundary has silently broken.
 */
describe("lib/env.server.ts boundary", () => {
  it("throws when imported outside a server context", async () => {
    await expect(import("./env.server")).rejects.toThrow();
  });
});
