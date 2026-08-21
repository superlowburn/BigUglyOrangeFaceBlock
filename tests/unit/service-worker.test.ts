import { describe, expect, it, vi } from "vitest";
import {
  handleExtensionMessage,
  installFirstRun,
  installProviderGateLifecycle,
} from "../../src/background/service-worker";
import { defaultTrumpKeywords } from "../../src/shared/blocked-subjects";

describe("handleExtensionMessage", () => {
  it("returns the sender tab policy for the current page", async () => {
    const deps = {
      storage: { get: vi.fn().mockResolvedValue({}), set: vi.fn() },
      tabs: { get: vi.fn() },
    };

    expect(
      await handleExtensionMessage(
        { type: "policy:get-current" },
        { tab: { id: 7, url: "https://news.example/story" } },
        deps,
      ),
    ).toEqual({
      origin: "https://news.example",
      mode: "protected",
      blockedSubjects: { enabled: false, keywords: defaultTrumpKeywords },
    });
  });

  it("returns the enabled blocked-subject configuration with a verified tab policy", async () => {
    const deps = {
      storage: {
        get: vi.fn().mockResolvedValue({
          "blocked-subjects": { enabled: true, keywords: ["Donald Trump"] },
        }),
        set: vi.fn(),
      },
      tabs: { get: vi.fn().mockResolvedValue({ id: 7, url: "https://news.example/story" }) },
    };

    await expect(handleExtensionMessage(
      { type: "policy:get-tab", tabId: 7 },
      {},
      deps,
    )).resolves.toEqual({
      origin: "https://news.example",
      mode: "protected",
      blockedSubjects: { enabled: true, keywords: ["Donald Trump"] },
    });
  });

  it("sets the verified tab origin policy", async () => {
    const deps = {
      storage: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
      tabs: { get: vi.fn().mockResolvedValue({ id: 7, url: "https://news.example/story" }) },
    };

    expect(
      await handleExtensionMessage(
        {
          type: "policy:set-tab",
          tabId: 7,
          mode: "strict",
          expectedOrigin: "https://news.example",
        },
        {},
        deps,
      ),
    ).toEqual({ origin: "https://news.example", mode: "protected" });
    expect(deps.tabs.get).toHaveBeenCalledWith(7);
    expect(deps.storage.set).toHaveBeenCalledWith({
      "site-policy:https://news.example": "protected",
    });
  });

  it("rejects a set-tab request when the tab redirected away from the displayed origin", async () => {
    const deps = {
      storage: { get: vi.fn().mockResolvedValue({}), set: vi.fn() },
      tabs: { get: vi.fn().mockResolvedValue({ id: 7, url: "https://redirected.example/login" }) },
    };

    await expect(handleExtensionMessage(
      {
        type: "policy:set-tab",
        tabId: 7,
        mode: "strict",
        expectedOrigin: "https://news.example",
      },
      {},
      deps,
    )).resolves.toEqual({ error: "origin-changed" });
    expect(deps.storage.set).not.toHaveBeenCalled();
  });

  it("rejects malformed tab URLs as unsupported pages", async () => {
    const deps = {
      storage: { get: vi.fn(), set: vi.fn() },
      tabs: { get: vi.fn() },
    };

    await expect(
      handleExtensionMessage(
        { type: "policy:get-current" },
        { tab: { url: "not a URL" } },
        deps,
      ),
    ).resolves.toEqual({ error: "unsupported-page" });
  });

  it("rejects malformed runtime messages without using extension APIs", async () => {
    const deps = {
      storage: { get: vi.fn(), set: vi.fn() },
      tabs: { get: vi.fn() },
    };

    await expect(handleExtensionMessage({}, {}, deps)).resolves.toEqual({
      error: "invalid-message",
    });
    expect(deps.tabs.get).not.toHaveBeenCalled();
    expect(deps.storage.set).not.toHaveBeenCalled();
  });

  it("rejects invalid set-tab modes without writing policy storage", async () => {
    const deps = {
      storage: { get: vi.fn(), set: vi.fn() },
      tabs: { get: vi.fn() },
    };

    await expect(
      handleExtensionMessage(
        { type: "policy:set-tab", tabId: 7, mode: "untrusted" },
        {},
        deps,
      ),
    ).resolves.toEqual({ error: "invalid-message" });
    expect(deps.tabs.get).not.toHaveBeenCalled();
    expect(deps.storage.set).not.toHaveBeenCalled();
  });

  it("opens the Goggles settings page from an extension message", async () => {
    const openOptionsPage = vi.fn().mockResolvedValue(undefined);
    const deps = {
      storage: { get: vi.fn(), set: vi.fn() },
      tabs: { get: vi.fn() },
      openOptionsPage,
    };

    await expect(handleExtensionMessage(
      { type: "options:open" },
      {},
      deps,
    )).resolves.toEqual({ opened: true });
    expect(openOptionsPage).toHaveBeenCalledTimes(1);
  });
});

describe("installProviderGateLifecycle", () => {
  it("sweeps startup grants and revokes them on tab close or top-level navigation", async () => {
    const gate = {
      sweep: vi.fn().mockResolvedValue(undefined),
      revokeTab: vi.fn().mockResolvedValue(undefined),
    };
    let removed!: (tabId: number) => void;
    let beforeNavigate!: (details: { tabId: number; frameId: number }) => void;
    const tabs = {
      onRemoved: { addListener: vi.fn((listener) => { removed = listener; }) },
    };
    const navigation = {
      onBeforeNavigate: { addListener: vi.fn((listener) => { beforeNavigate = listener; }) },
    };

    await installProviderGateLifecycle(gate, tabs, navigation);
    removed(7);
    beforeNavigate({ tabId: 8, frameId: 0 });
    beforeNavigate({ tabId: 9, frameId: 4 });

    expect(gate.sweep).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(gate.revokeTab).toHaveBeenCalledWith(7);
      expect(gate.revokeTab).toHaveBeenCalledWith(8);
    });
    expect(gate.revokeTab).not.toHaveBeenCalledWith(9);
  });
});

describe("installFirstRun", () => {
  it("opens onboarding once for a new install but not an update", async () => {
    let onInstalled!: (details: { reason: string }) => void;
    const openOptionsPage = vi.fn().mockResolvedValue(undefined);
    installFirstRun({
      onInstalled: { addListener: vi.fn((listener) => { onInstalled = listener; }) },
      openOptionsPage,
    });

    onInstalled({ reason: "update" });
    onInstalled({ reason: "install" });
    await Promise.resolve();

    expect(openOptionsPage).toHaveBeenCalledTimes(1);
  });
});
