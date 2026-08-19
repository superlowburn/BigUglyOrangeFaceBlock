import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __DEV__: "true" },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "jsdom",
    setupFiles: ["tests/unit/setup.ts"],
    restoreMocks: true,
  },
});
