import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettierConfig from "eslint-config-prettier";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  prettierConfig,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "coverage/**",
      "coverage-integration/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  {
    rules: {
      // Centralize logging through lib/logger.ts (see the override below)
      // rather than scattering console.* calls through the app.
      "no-console": "warn",
    },
  },
  {
    files: ["lib/logger.ts", "prisma/seed.ts", "prisma/seed-uat.ts", "scripts/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "e2e/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
];

export default eslintConfig;
