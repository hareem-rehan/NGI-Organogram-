import { describe, expect, it } from "vitest";

/**
 * Same pattern as lib/env.server-boundary.test.ts: this runs under the
 * unit/component Vitest config, which does NOT set the "react-server"
 * resolve condition, so importing a `server-only`-guarded module here
 * must throw — proving the database client (and by extension its
 * connection string) cannot be pulled into a client bundle.
 */
describe("lib/db/prisma.ts boundary", () => {
  it("throws when imported outside a server context", async () => {
    await expect(import("./prisma")).rejects.toThrow();
  });
});
