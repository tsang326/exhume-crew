import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 120000,
    hookTimeout: 120000,
    include: ["src/**/*.test.ts", "backend/**/*.test.ts"],
    exclude: ["**/exhumed/**", "**/node_modules/**"],
  },
});
