import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountOptions, type OptionsChromeApi } from "../../src/options/options";
import { defaultPolicyKey, policyKey } from "../../src/shared/site-policy";

function chromeApi(initial: Record<string, unknown>): OptionsChromeApi & {
  state: Record<string, unknown>;
} {
  const state = { ...initial };
  return {
    state,
    storage: {
      local: {
        get: async () => ({ ...state }),
        set: async (items) => { Object.assign(state, items); },
        remove: async (key) => { delete state[key]; },
      },
    },
  };
}

describe("mountOptions", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main id="app">
        <button type="button" data-default-mode="protected"></button>
        <button type="button" data-default-mode="strict"></button>
        <button type="button" id="demo-reveal"></button>
        <div id="demo-media"></div>
        <p id="save-status"></p>
        <input id="blocked-subjects-enabled" type="checkbox">
        <textarea id="blocked-subject-keywords"></textarea>
        <p id="blocked-subjects-status"></p>
        <div id="site-rules"></div>
      </main>`;
  });

  it("selects the child-friendly default and lists an existing trusted site", async () => {
    const api = chromeApi({
      [defaultPolicyKey]: "strict",
      [policyKey("https://example.com")]: "trusted",
    });

    await mountOptions(document.querySelector("#app")!, api);

    expect(document.querySelector('[data-default-mode="strict"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("#site-rules")?.textContent).toContain("example.com");
    expect(document.querySelector("#site-rules")?.textContent).toContain("Always show");
  });

  it("switches new sites back to personal protection", async () => {
    const api = chromeApi({ [defaultPolicyKey]: "strict" });
    await mountOptions(document.querySelector("#app")!, api);

    (document.querySelector('[data-default-mode="protected"]') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(api.state[defaultPolicyKey]).toBe("protected");
    expect(document.querySelector('[data-default-mode="protected"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("removes a trusted-site exception from the settings list", async () => {
    const key = policyKey("https://example.com");
    const api = chromeApi({ [key]: "trusted" });
    await mountOptions(document.querySelector("#app")!, api);

    (document.querySelector("[data-remove-policy]") as HTMLButtonElement).click();
    await Promise.resolve();

    expect(key in api.state).toBe(false);
    expect(document.querySelector("#site-rules")?.textContent).toContain("No site exceptions yet");
  });

  it("turns the onboarding demo into the revealed state", async () => {
    const api = chromeApi({});
    await mountOptions(document.querySelector("#app")!, api);

    (document.querySelector("#demo-reveal") as HTMLButtonElement).click();

    expect(document.querySelector("#demo-media")?.classList).toContain("is-revealed");
    expect(document.querySelector("#demo-reveal")?.textContent).toBe("Frost again");
  });

  it("loads and saves the editable blocked-subject preset", async () => {
    const api = chromeApi({
      "blocked-subjects": { enabled: true, keywords: ["Trump", "Donald Trump"] },
    });
    await mountOptions(document.querySelector("#app")!, api);

    const enabled = document.querySelector<HTMLInputElement>("#blocked-subjects-enabled")!;
    const keywords = document.querySelector<HTMLTextAreaElement>("#blocked-subject-keywords")!;
    expect(enabled.checked).toBe(true);
    expect(keywords.value).toBe("Trump\nDonald Trump");

    keywords.value = "Trump\nPresident Trump\nTrump";
    keywords.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();

    expect(api.state["blocked-subjects"]).toEqual({
      enabled: true,
      keywords: ["Trump", "President Trump"],
    });
    await vi.waitFor(() => {
      expect(document.querySelector("#blocked-subjects-status")?.textContent).toBe("Saved locally");
    });
  });
});
