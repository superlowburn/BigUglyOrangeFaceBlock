import { vi } from "vitest";

Object.assign(globalThis, {
  chrome: {
    runtime: { onMessage: { addListener: vi.fn() } },
    storage: {
      local: { get: vi.fn(), set: vi.fn() },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: { get: vi.fn() },
  },
});
