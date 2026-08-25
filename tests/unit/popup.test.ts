import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountPopup, type PopupChromeApi } from "../../src/popup/popup";

type TestPopupApi = PopupChromeApi & {
  state: Record<string, unknown>;
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
};

function chromeApi(config: unknown): TestPopupApi {
  const state = { "blocked-subjects": config };
  return {
    state,
    storage: {
      local: {
        get: async () => ({ ...state }),
        set: async (items: Record<string, unknown>) => { Object.assign(state, items); },
      },
    },
    runtime: { openOptionsPage: vi.fn().mockResolvedValue(undefined) },
  };
}

describe("mountPopup", () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    root = document.querySelector<HTMLElement>("#app")!;
  });

  it("shows the named subject, logo, and useful status", async () => {
    const api = chromeApi({ enabled: true, keywords: ["Donald Trump"] });

    await mountPopup(root, api);

    expect(document.title).toBe("Big Ugly Orange Face");
    expect(root.querySelector("h1")?.textContent).toBe("Big Ugly Orange Face");
    expect(root.querySelector<HTMLImageElement>(".popup-logo")?.getAttribute("src"))
      .toBe("../icons/icon.svg");
    expect(root.textContent).toContain("Donald Trump");
    expect(root.textContent).toContain(
      "Likely pictures of Donald Trump are frosted on every site.",
    );
    expect(root.textContent).toContain("Works locally. Your images never leave this device.");
  });

  it("toggles subject frosting without changing its matching words", async () => {
    const api = chromeApi({ enabled: true, keywords: ["Donald Trump", "President Trump"] });
    await mountPopup(root, api);

    const subjectSwitch = root.querySelector<HTMLInputElement>('[role="switch"]')!;
    expect(subjectSwitch.checked).toBe(true);
    subjectSwitch.click();

    await vi.waitFor(() => expect(api.state["blocked-subjects"]).toEqual({
      enabled: false,
      keywords: ["Donald Trump", "President Trump"],
    }));
    await vi.waitFor(() => expect(root.textContent)
      .toContain("Pictures of Donald Trump are currently visible."));
  });

  it("opens matching words and settings", async () => {
    const api = chromeApi({ enabled: false, keywords: ["Donald Trump"] });
    await mountPopup(root, api);

    (root.querySelector(".popup-settings") as HTMLButtonElement).click();

    expect(api.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
  });

  it("restores the switch when saving fails", async () => {
    const api = chromeApi({ enabled: true, keywords: ["Donald Trump"] });
    api.storage.local.set = vi.fn().mockRejectedValue(new Error("storage unavailable"));
    await mountPopup(root, api);

    const subjectSwitch = root.querySelector<HTMLInputElement>('[role="switch"]')!;
    subjectSwitch.click();

    await vi.waitFor(() => expect(subjectSwitch.checked).toBe(true));
    expect(root.querySelector('[role="alert"]')?.textContent)
      .toBe("Subject settings are unavailable.");
  });
});
