import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    globals: false,
    env: {
      // Isolated, safe test-only configuration (step 5.8): no real
      // secrets, no dependency on a developer's local .env file.
      NEXT_PUBLIC_APP_NAME: "DotZero Organogram",
    },
    setupFiles: ["./tests/setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: [
      "node_modules/**",
      ".next/**",
      "e2e/**",
      "playwright-report/**",
      "test-results/**",
      "**/*.integration.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["app/**", "components/**", "lib/**", "config/**"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.integration.test.ts",
        "**/*.d.ts",
        "app/**/layout.tsx",
        "app/**/page.tsx",
        "prisma/**",
      ],
    },
  },
});
