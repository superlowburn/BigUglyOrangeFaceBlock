import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { mountOptions, type OptionsChromeApi } from "../../src/options/options";

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
      },
    },
  };
}

describe("mountOptions", () => {
  beforeEach(async () => {
    const source = await readFile("src/options/options.html", "utf8");
    document.body.innerHTML = new DOMParser().parseFromString(source, "text/html").body.innerHTML;
  });

  it("contains only subject controls", async () => {
    const root = document.querySelector<HTMLElement>("#app")!;
    await mountOptions(root, chromeApi({ "legacy-site-rule": "ignored" }));

    expect(document.title).toBe("Big Ugly Orange Face Settings");
    expect(root.querySelector<HTMLImageElement>(".brand-mark")?.getAttribute("src"))
      .toBe("../icons/icon.svg");
    expect(root.textContent).toContain("Big Ugly Orange Face");
    expect(root.textContent).toContain(
      "Frosts over pictures of the Orange One so you don't see that Big Ugly Orange Face everywhere.",
    );
    expect(root.textContent).toContain("Subjects to frost");
    expect(root.textContent).not.toContain("Sites showing");
    expect(root.querySelector("#site-rules")).toBeNull();
    expect(root.querySelector("#demo-media")).toBeNull();
  });

  it("loads and saves the editable subject preset", async () => {
    const api = chromeApi({
      "blocked-subjects": { enabled: true, keywords: ["Trump", "Donald Trump"] },
    });
    await mountOptions(document.querySelector("#app")!, api);

    const enabled = document.querySelector<HTMLInputElement>("#blocked-subjects-enabled")!;
    const keywords = document.querySelector<HTMLTextAreaElement>("#blocked-subject-keywords")!;
    expect(enabled.checked).toBe(true);
    keywords.value = "Trump\nPresident Trump\nTrump";
    keywords.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => expect(api.state["blocked-subjects"]).toEqual({
      enabled: true,
      keywords: ["Trump", "President Trump"],
    }));
  });
});
