import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountPopup, type PopupChromeApi } from "../../src/popup/popup";

function policyContext(enabled: boolean) {
  return {
    origin: "https://verified.example",
    mode: "protected" as const,
    blockedSubjects: { enabled, keywords: ["Donald Trump"] },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

function createChromeApi(
  sendMessage: PopupChromeApi["runtime"]["sendMessage"] = vi
    .fn()
    .mockResolvedValue(policyContext(true)),
): PopupChromeApi {
  return {
    tabs: {
      query: vi.fn().mockResolvedValue([
        { id: 7, url: "https://untrusted-tab-value.example/story" },
      ]),
    },
    runtime: { sendMessage, openOptionsPage: vi.fn().mockResolvedValue(undefined) },
  };
}

function getSwitch(root: HTMLElement): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>('[role="switch"]')!;
}

describe("mountPopup", () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    root = document.querySelector<HTMLElement>("#app")!;
  });

  it("renders one subject-first switch with blocked subjects on everywhere", async () => {
    const chromeApi = createChromeApi();

    await mountPopup(root, chromeApi);

    expect(chromeApi.tabs.query).toHaveBeenCalledWith({
      active: true,
      currentWindow: true,
    });
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith({
      type: "policy:get-tab",
      tabId: 7,
    });
    expect(root.querySelectorAll("h1")).toHaveLength(1);
    expect(root.querySelector("h1")?.textContent).toBe("Goggles");
    expect(root.textContent).toContain("verified.example");
    expect(root.textContent).not.toContain("untrusted-tab-value.example");

    expect(root.querySelectorAll('[role="switch"]')).toHaveLength(1);
    expect(root.textContent).toContain("Frost ordinary media on verified.example");
    expect(root.textContent).toContain("Blocked subjects — On everywhere");
    expect(root.querySelector(".popup-settings")?.textContent).toBe("Settings");
    expect(getSwitch(root).getAttribute("aria-checked")).toBe("true");
  });

  it("renders blocked subjects as off when the verified policy context disables them", async () => {
    await mountPopup(root, createChromeApi(vi.fn().mockResolvedValue(policyContext(false))));

    expect(root.textContent).toContain("Blocked subjects — Off");
    expect(root.textContent).not.toContain("On everywhere");
  });

  it("shows ordinary media for the active tab when the switch is turned off", async () => {
    const chromeApi = createChromeApi(
      vi
        .fn()
        .mockResolvedValueOnce(policyContext(true))
        .mockResolvedValueOnce({ origin: "https://verified.example", mode: "trusted" }),
    );
    await mountPopup(root, chromeApi);
    const protectionSwitch = getSwitch(root);

    protectionSwitch.click();

    await vi.waitFor(() => {
      expect(chromeApi.runtime.sendMessage).toHaveBeenLastCalledWith({
        type: "policy:set-tab",
        tabId: 7,
        mode: "trusted",
        expectedOrigin: "https://verified.example",
      });
      expect(protectionSwitch.getAttribute("aria-checked")).toBe("false");
    });
  });

  it("rejects a successful-looking response for a different origin", async () => {
    const chromeApi = createChromeApi(
      vi
        .fn()
        .mockResolvedValueOnce(policyContext(true))
        .mockResolvedValueOnce({ origin: "https://redirected.example", mode: "trusted" }),
    );
    await mountPopup(root, chromeApi);
    const protectionSwitch = getSwitch(root);

    protectionSwitch.click();

    await vi.waitFor(() => {
      expect(protectionSwitch.getAttribute("aria-checked")).toBe("true");
      expect(root.querySelector('[role="alert"]')?.textContent).toBe(
        "Could not update protection. Try again.",
      );
    });
  });

  it("rolls back an optimistic mode change and shows a local error when saving fails", async () => {
    const save = deferred<unknown>();
    const chromeApi = createChromeApi(
      vi
        .fn()
        .mockResolvedValueOnce(policyContext(true))
        .mockImplementationOnce(() => save.promise),
    );
    await mountPopup(root, chromeApi);
    const protectionSwitch = getSwitch(root);

    protectionSwitch.click();
    expect(protectionSwitch.getAttribute("aria-checked")).toBe("false");

    save.reject(new Error("storage unavailable"));

    await vi.waitFor(() => {
      expect(protectionSwitch.getAttribute("aria-checked")).toBe("true");
      expect(root.querySelector('[role="alert"]')?.textContent).toBe(
        "Could not update protection. Try again.",
      );
    });
    expect((root.querySelector('[role="alert"]') as HTMLElement).hidden).toBe(false);
  });
});
