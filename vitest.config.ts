import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // PGlite boots a full Postgres in WASM per test file.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
