import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Separate config from vitest.config.mts on purpose:
 *
 * - environment: "node" (no jsdom needed — these test server/DB code).
 * - resolve.conditions includes "react-server" so modules guarded by the
 *   `server-only` package (lib/db/prisma.ts, and everything built on top
 *   of it: repositories, services) actually load here, unlike in the
 *   unit/component suite, where `server-only` is deliberately left
 *   throwing so lib/env.server-boundary.test.ts can prove the guard
 *   works. Only THIS config adds the condition — the unit/component
 *   config is untouched.
 * - Runs only *.integration.test.ts files against a REAL PostgreSQL test
 *   database (see tests/integration/setup.ts's destructive-operation
 *   guard) — never as part of the default `npm run test`.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    conditions: ["react-server"],
  },
  test: {
    environment: "node",
    globals: false,
    include: ["**/*.integration.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    setupFiles: ["./tests/integration/setup.ts"],
    testTimeout: 20_000,
    // Integration tests share one Postgres instance and truncate between
    // each test (tests/integration/setup.ts) — running them in parallel
    // worker processes would race on that truncate.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage-integration",
      include: ["lib/repositories/**", "lib/services/**", "lib/db/**", "prisma/seed.ts"],
      exclude: ["**/*.test.ts", "**/*.integration.test.ts"],
    },
  },
});
