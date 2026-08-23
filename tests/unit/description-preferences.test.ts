import { describe, expect, it, vi } from "vitest";
import { DescriptionPreferencesStore } from "../../src/shared/description-preferences";

describe("DescriptionPreferencesStore", () => {
  it("defaults to hidden and stores the per-site choice", async () => {
    const area = { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) };
    const store = new DescriptionPreferencesStore(area);

    await expect(store.get("https://news.example")).resolves.toBe(false);
    await store.set("https://news.example", true);

    expect(area.set).toHaveBeenCalledWith({
      "site-descriptions:https://news.example": true,
    });
  });
});
