import { vi } from "vitest";

Object.assign(globalThis, {
  chrome: {
    runtime: { onMessage: { addListener: vi.fn() } },
    declarativeNetRequest: {
      updateSessionRules: vi.fn().mockResolvedValue(undefined),
      getSessionRules: vi.fn().mockResolvedValue([]),
    },
    storage: {
      local: { get: vi.fn(), set: vi.fn() },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: {
      get: vi.fn(),
      onRemoved: { addListener: vi.fn() },
    },
    webNavigation: { onBeforeNavigate: { addListener: vi.fn() } },
  },
});
