import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountPopup, type PopupChromeApi } from "../../src/popup/popup";

function chromeApi(config: unknown): PopupChromeApi {
  return {
    storage: { local: { get: vi.fn().mockResolvedValue({ "blocked-subjects": config }) } },
    runtime: { openOptionsPage: vi.fn().mockResolvedValue(undefined) },
  };
}

describe("mountPopup", () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    root = document.querySelector<HTMLElement>("#app")!;
  });

  it("shows global subject protection without a site control", async () => {
    const api = chromeApi({ enabled: true, keywords: ["Donald Trump"] });

    await mountPopup(root, api);

    expect(document.title).toBe("Big Ugly Orange Face");
    expect(root.querySelector("h1")?.textContent).toBe("Big Ugly Orange Face");
    expect(root.querySelectorAll('[role="switch"]')).toHaveLength(0);
    expect(root.textContent).not.toContain("site");
    expect(root.querySelector(".popup-subjects-state")?.textContent).toBe("On");
    expect(root.textContent).toContain("Frosting likely matches everywhere.");
  });

  it("shows the disabled state and opens Settings", async () => {
    const api = chromeApi({ enabled: false, keywords: ["Donald Trump"] });
    await mountPopup(root, api);

    expect(root.querySelector(".popup-subjects-state")?.textContent).toBe("Off");
    (root.querySelector(".popup-settings") as HTMLButtonElement).click();

    expect(api.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
  });
});
