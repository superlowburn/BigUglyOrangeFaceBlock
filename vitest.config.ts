import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __DEV__: "true" },
  test: {
    environment: "jsdom",
    setupFiles: ["tests/unit/setup.ts"],
    restoreMocks: true,
  },
});
