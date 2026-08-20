import { describe, expect, it, vi } from "vitest";
import {
  defaultPolicyKey,
  SitePolicyStore,
  policyKey,
} from "../../src/shared/site-policy";

describe("SitePolicyStore", () => {
  it("defaults unknown origins to protected", async () => {
    const area = { get: vi.fn().mockResolvedValue({}), set: vi.fn() };
    const store = new SitePolicyStore(area);

    await expect(store.get("https://example.com")).resolves.toBe("protected");
  });

  it("stores one validated mode by origin", async () => {
    const area = { get: vi.fn(), set: vi.fn().mockResolvedValue(undefined) };
    const store = new SitePolicyStore(area);

    await store.set("https://example.com", "strict");

    expect(area.set).toHaveBeenCalledWith({
      [policyKey("https://example.com")]: "strict",
    });
  });

  it("uses the configured default for an origin without its own rule", async () => {
    const area = {
      get: vi.fn().mockResolvedValue({ [defaultPolicyKey]: "strict" }),
      set: vi.fn(),
    };
    const store = new SitePolicyStore(area);

    await expect(store.get("https://example.com")).resolves.toBe("strict");
  });

  it("keeps an origin rule ahead of the configured default", async () => {
    const area = {
      get: vi.fn().mockResolvedValue({
        [defaultPolicyKey]: "strict",
        [policyKey("https://example.com")]: "trusted",
      }),
      set: vi.fn(),
    };
    const store = new SitePolicyStore(area);

    await expect(store.get("https://example.com")).resolves.toBe("trusted");
  });

  it("stores a protected or strict default for new sites", async () => {
    const area = { get: vi.fn(), set: vi.fn().mockResolvedValue(undefined) };
    const store = new SitePolicyStore(area);

    await store.setDefault("strict");

    expect(area.set).toHaveBeenCalledWith({ [defaultPolicyKey]: "strict" });
  });

  it("defaults site descriptions to hidden and restores a saved preference", async () => {
    const area = {
      get: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ "site-descriptions:https://example.com": true }),
      set: vi.fn(),
    };
    const store = new SitePolicyStore(area) as SitePolicyStore & {
      getDescriptionsVisible?: (origin: string) => Promise<boolean>;
    };

    expect(typeof store.getDescriptionsVisible).toBe("function");
    await expect(store.getDescriptionsVisible?.("https://example.com")).resolves.toBe(false);
    await expect(store.getDescriptionsVisible?.("https://example.com")).resolves.toBe(true);
  });

  it("stores the permanent description choice by origin", async () => {
    const area = { get: vi.fn(), set: vi.fn().mockResolvedValue(undefined) };
    const store = new SitePolicyStore(area) as SitePolicyStore & {
      setDescriptionsVisible?: (origin: string, visible: boolean) => Promise<void>;
    };

    expect(typeof store.setDescriptionsVisible).toBe("function");
    await store.setDescriptionsVisible?.("https://example.com", true);

    expect(area.set).toHaveBeenCalledWith({
      "site-descriptions:https://example.com": true,
    });
  });
});
