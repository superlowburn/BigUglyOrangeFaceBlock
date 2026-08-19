import { describe, expect, it, vi } from "vitest";
import { ProviderRequestGate } from "../../src/background/provider-request-gate";

describe("ProviderRequestGate", () => {
  it("authorizes one tab-scoped nonce URL with autoplay disabled", async () => {
    const updateSessionRules = vi.fn().mockResolvedValue(undefined);
    const gate = new ProviderRequestGate({
      updateSessionRules,
      token: () => "fixed-token",
      ruleId: () => 9001,
    });

    await expect(gate.authorize(
      7,
      "https://www.youtube.com/embed/abc?autoplay=1&start=4#chapter",
    )).resolves.toEqual({
      grantId: 9001,
      source: "https://www.youtube.com/embed/abc?autoplay=0&start=4&eg_eclipse_goggles=fixed-token#chapter",
    });
    expect(updateSessionRules).toHaveBeenCalledWith({
      addRules: [{
        id: 9001,
        priority: 2,
        action: { type: "allow" },
        condition: {
          regexFilter: "^https://www\\.youtube\\.com/embed/abc\\?autoplay=0&start=4&eg_eclipse_goggles=fixed-token$",
          resourceTypes: ["sub_frame"],
          tabIds: [7],
        },
      }],
      removeRuleIds: [],
    });
  });

  it("rejects unsupported URLs without changing request rules", async () => {
    const updateSessionRules = vi.fn();
    const gate = new ProviderRequestGate({
      updateSessionRules,
      token: () => "fixed-token",
      ruleId: () => 9001,
    });

    await expect(gate.authorize(7, "https://www.youtube.com/watch?v=abc")).rejects.toThrow(
      "Unsupported provider URL",
    );
    expect(updateSessionRules).not.toHaveBeenCalled();
  });

  it("revokes only the matching tab grant", async () => {
    const updateSessionRules = vi.fn().mockResolvedValue(undefined);
    const gate = new ProviderRequestGate({
      updateSessionRules,
      token: () => "fixed-token",
      ruleId: () => 9001,
    });
    await gate.authorize(7, "https://player.vimeo.com/video/123?autoplay=1");
    updateSessionRules.mockClear();

    await gate.revoke(8, 9001);
    expect(updateSessionRules).not.toHaveBeenCalled();
    await gate.revoke(7, 9001);
    expect(updateSessionRules).toHaveBeenCalledWith({ addRules: [], removeRuleIds: [9001] });
  });

  it("revokes a matching session rule after the service worker loses its memory", async () => {
    const updateSessionRules = vi.fn().mockResolvedValue(undefined);
    const getSessionRules = vi.fn().mockResolvedValue([{
      id: 9001,
      priority: 2,
      action: { type: "allow" },
      condition: {
        regexFilter: "^https://www\\.youtube\\.com/embed/abc$",
        resourceTypes: ["sub_frame"],
        tabIds: [7],
      },
    }]);
    const restartedGate = new ProviderRequestGate({
      updateSessionRules,
      getSessionRules,
      token: () => "fixed-token",
      ruleId: () => 9001,
    });

    await restartedGate.revoke(7, 9001);

    expect(getSessionRules).toHaveBeenCalledWith({ ruleIds: [9001] });
    expect(updateSessionRules).toHaveBeenCalledWith({ addRules: [], removeRuleIds: [9001] });
  });

  it("expires a hung authorization after the hard ten-second bound", async () => {
    const updateSessionRules = vi.fn().mockResolvedValue(undefined);
    let expire!: () => void;
    const gate = new ProviderRequestGate({
      updateSessionRules,
      token: () => "fixed-token",
      ruleId: () => 9001,
      setTimeout: (callback, delay) => {
        expect(delay).toBe(10_000);
        expire = callback;
        return 44;
      },
      clearTimeout: vi.fn(),
    });
    await gate.authorize(7, "https://www.youtube.com/embed/abc");
    updateSessionRules.mockClear();

    expire();
    await vi.waitFor(() => {
      expect(updateSessionRules).toHaveBeenCalledWith({
        addRules: [],
        removeRuleIds: [9001],
      });
    });
  });

  it("revokes every outstanding grant owned by a closing or navigating tab", async () => {
    const updateSessionRules = vi.fn().mockResolvedValue(undefined);
    let nextId = 9000;
    const gate = new ProviderRequestGate({
      updateSessionRules,
      token: () => "fixed-token",
      ruleId: () => ++nextId,
      setTimeout: () => 1,
      clearTimeout: vi.fn(),
    });
    await gate.authorize(7, "https://www.youtube.com/embed/one");
    await gate.authorize(8, "https://www.youtube.com/embed/two");
    await gate.authorize(7, "https://player.vimeo.com/video/3");
    updateSessionRules.mockClear();

    await gate.revokeTab(7);

    expect(updateSessionRules).toHaveBeenCalledWith({
      addRules: [],
      removeRuleIds: [9001, 9003],
    });
  });

  it("sweeps all stale session grants on worker startup", async () => {
    const updateSessionRules = vi.fn().mockResolvedValue(undefined);
    const getSessionRules = vi.fn().mockResolvedValue([
      { id: 51, condition: {}, action: { type: "allow" }, priority: 2 },
      { id: 52, condition: {}, action: { type: "allow" }, priority: 2 },
    ]);
    const gate = new ProviderRequestGate({ updateSessionRules, getSessionRules });

    await gate.sweep();

    expect(getSessionRules).toHaveBeenCalledWith({});
    expect(updateSessionRules).toHaveBeenCalledWith({
      addRules: [],
      removeRuleIds: [51, 52],
    });
  });

  it("serializes concurrent rule mutations for multiple provider frames", async () => {
    let updating = false;
    const updateSessionRules = vi.fn(async () => {
      if (updating) throw new Error("another rule update is pending");
      updating = true;
      await Promise.resolve();
      updating = false;
    });
    let nextId = 70;
    const gate = new ProviderRequestGate({
      updateSessionRules,
      token: () => `token-${nextId}`,
      ruleId: () => ++nextId,
      setTimeout: () => 1,
      clearTimeout: vi.fn(),
    });

    await expect(Promise.all([
      gate.authorize(7, "https://www.youtube.com/embed/one"),
      gate.authorize(7, "https://www.youtube.com/embed/two"),
      gate.authorize(7, "https://player.vimeo.com/video/3"),
    ])).resolves.toHaveLength(3);
    expect(updateSessionRules).toHaveBeenCalledTimes(3);
  });

});
