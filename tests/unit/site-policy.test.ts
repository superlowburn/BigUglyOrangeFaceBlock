import { describe, expect, it, vi } from "vitest";
import { SitePolicyStore, policyKey } from "../../src/shared/site-policy";

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
});
