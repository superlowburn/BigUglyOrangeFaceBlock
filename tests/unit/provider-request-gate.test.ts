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
});
