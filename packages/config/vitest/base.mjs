import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    include: ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    passWithNoTests: true,
  },
});
