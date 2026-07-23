import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globals: true,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Integration tests share one Postgres schema and must not run
    // concurrently against it.
    fileParallelism: false,
  },
});
