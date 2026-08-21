import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { mountOptions, type OptionsChromeApi } from "../../src/options/options";
import { policyKey } from "../../src/shared/site-policy";

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
  beforeEach(async () => {
    const source = await readFile("src/options/options.html", "utf8");
    document.body.innerHTML = new DOMParser().parseFromString(source, "text/html").body.innerHTML;
  });

  it("puts blocked subjects first and lists only ordinary-media exceptions", async () => {
    const api = chromeApi({
      [policyKey("https://example.com")]: "trusted",
      [policyKey("https://frosted.example")]: "protected",
      [policyKey("https://legacy.example")]: "strict",
    });

    const root = document.querySelector<HTMLElement>("#app")!;
    await mountOptions(root, api);

    expect(root.querySelector('[data-default-mode]')).toBeNull();
    expect(root.querySelector("section h2")?.textContent).toBe("Blocked subjects");
    expect(root.textContent).toContain("Sites showing ordinary media");
    expect(root.textContent).toContain("Blocked subjects stay frosted");
    expect(document.querySelector("#site-rules")?.textContent).toContain("example.com");
    expect(document.querySelector("#site-rules")?.textContent).not.toContain("frosted.example");
    expect(document.querySelector("#site-rules")?.textContent).not.toContain("legacy.example");
    expect(document.querySelector("[data-remove-policy]")?.textContent).toBe("Frost ordinary media again");
  });

  it("removes a trusted-site exception from the settings list", async () => {
    const key = policyKey("https://example.com");
    const api = chromeApi({ [key]: "trusted" });
    await mountOptions(document.querySelector("#app")!, api);

    (document.querySelector("[data-remove-policy]") as HTMLButtonElement).click();
    await Promise.resolve();

    expect(key in api.state).toBe(false);
    expect(document.querySelector("#site-rules .empty-rules")).not.toBeNull();
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

  it("keeps matching words in a native expandable editor", async () => {
    await mountOptions(document.querySelector("#app")!, chromeApi({}));

    const disclosure = document.querySelector<HTMLDetailsElement>(".keyword-editor");
    const summary = disclosure?.querySelector("summary");
    const keywords = disclosure?.querySelector<HTMLTextAreaElement>("#blocked-subject-keywords");

    expect(disclosure?.open).toBe(false);
    expect(summary?.textContent).toContain("Matching words");
    expect(keywords?.labels?.[0]?.textContent).toContain("One phrase per line");

    summary?.click();
    expect(disclosure?.open).toBe(true);
  });
});
