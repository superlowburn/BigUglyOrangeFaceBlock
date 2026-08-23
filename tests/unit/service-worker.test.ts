import { describe, expect, it, vi } from "vitest";
import {
  handleExtensionMessage,
  installFirstRun,
  installProviderGateLifecycle,
} from "../../src/background/service-worker";

describe("handleExtensionMessage", () => {
  it("opens Settings", async () => {
    const openOptionsPage = vi.fn().mockResolvedValue(undefined);

    await expect(handleExtensionMessage(
      { type: "options:open" },
      {},
      { openOptionsPage },
    )).resolves.toEqual({ opened: true });
    expect(openOptionsPage).toHaveBeenCalledTimes(1);
  });

  it("authorizes and revokes a provider grant only for an HTTP tab", async () => {
    const providerGate = {
      authorize: vi.fn().mockResolvedValue({ grantId: 42, source: "https://www.youtube.com/embed/a" }),
      revoke: vi.fn().mockResolvedValue(undefined),
    };
    const sender = { tab: { id: 7, url: "https://news.example/story" } };

    await expect(handleExtensionMessage(
      { type: "provider:authorize", source: "https://www.youtube.com/embed/a", disableAutoplay: true },
      sender,
      { providerGate },
    )).resolves.toEqual({ grantId: 42, source: "https://www.youtube.com/embed/a" });
    await expect(handleExtensionMessage(
      { type: "provider:revoke", grantId: 42 },
      sender,
      { providerGate },
    )).resolves.toEqual({ revoked: true });
    expect(providerGate.revoke).toHaveBeenCalledWith(7, 42);
  });

  it("rejects unknown messages", async () => {
    await expect(handleExtensionMessage(
      { type: "unknown" },
      {},
      {},
    )).resolves.toEqual({ error: "invalid-message" });
  });
});

describe("installProviderGateLifecycle", () => {
  it("sweeps startup grants and revokes them on tab close or top-level navigation", async () => {
    const gate = {
      sweep: vi.fn().mockResolvedValue(undefined),
      revokeTab: vi.fn().mockResolvedValue(undefined),
    };
    let removed!: (tabId: number) => void;
    let navigated!: (details: { tabId: number; frameId: number }) => void;
    await installProviderGateLifecycle(gate, {
      onRemoved: { addListener: (listener) => { removed = listener; } },
    }, {
      onBeforeNavigate: { addListener: (listener) => { navigated = listener; } },
    });

    removed(7);
    navigated({ tabId: 8, frameId: 0 });
    navigated({ tabId: 9, frameId: 2 });

    await vi.waitFor(() => expect(gate.revokeTab).toHaveBeenCalledWith(8));
    expect(gate.revokeTab).toHaveBeenCalledWith(7);
    expect(gate.revokeTab).not.toHaveBeenCalledWith(9);
  });
});

describe("installFirstRun", () => {
  it("opens Settings once on install but not update", async () => {
    let listener!: (details: { reason: string }) => void;
    const openOptionsPage = vi.fn().mockResolvedValue(undefined);
    installFirstRun({
      onInstalled: { addListener: (next) => { listener = next; } },
      openOptionsPage,
    });

    listener({ reason: "update" });
    listener({ reason: "install" });
    await Promise.resolve();

    expect(openOptionsPage).toHaveBeenCalledTimes(1);
  });
});
