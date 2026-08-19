import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountPopup, type PopupChromeApi } from "../../src/popup/popup";

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
    .mockResolvedValue({ origin: "https://verified.example", mode: "protected" }),
): PopupChromeApi {
  return {
    tabs: {
      query: vi.fn().mockResolvedValue([
        { id: 7, url: "https://untrusted-tab-value.example/story" },
      ]),
    },
    runtime: { sendMessage },
  };
}

function getModeButtons(root: HTMLElement): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button[type="button"]'));
}

describe("mountPopup", () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    root = document.querySelector<HTMLElement>("#app")!;
  });

  it("renders the worker-verified hostname and exactly three accessible modes", async () => {
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
    expect(root.querySelector("h1")?.textContent).toBe("Eclipse Goggles");
    expect(root.textContent).toContain("verified.example");
    expect(root.textContent).not.toContain("untrusted-tab-value.example");

    const group = root.querySelector('[role="group"]');
    expect(group?.getAttribute("aria-label")).toBe("Image protection for this site");

    const buttons = getModeButtons(root);
    expect(buttons).toHaveLength(3);
    expect(
      buttons.map((button) => [
        button.querySelector(".mode-label")?.textContent,
        button.querySelector(".mode-description")?.textContent,
      ]),
    ).toEqual([
      ["Trusted", "Show normally"],
      ["Protected", "Frost individually"],
      ["Strict", "Always re-protect"],
    ]);
    expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
      "false",
    ]);
  });

  it("sets Strict for the active tab and moves the selected state after success", async () => {
    const chromeApi = createChromeApi(
      vi
        .fn()
        .mockResolvedValueOnce({ origin: "https://verified.example", mode: "protected" })
        .mockResolvedValueOnce({ origin: "https://verified.example", mode: "strict" }),
    );
    await mountPopup(root, chromeApi);
    const [trusted, protectedButton, strict] = getModeButtons(root);

    strict!.click();

    await vi.waitFor(() => {
      expect(chromeApi.runtime.sendMessage).toHaveBeenLastCalledWith({
        type: "policy:set-tab",
        tabId: 7,
        mode: "strict",
        expectedOrigin: "https://verified.example",
      });
      expect(strict?.getAttribute("aria-pressed")).toBe("true");
    });
    expect(trusted?.getAttribute("aria-pressed")).toBe("false");
    expect(protectedButton?.getAttribute("aria-pressed")).toBe("false");
  });

  it("rejects a successful-looking response for a different origin", async () => {
    const chromeApi = createChromeApi(
      vi
        .fn()
        .mockResolvedValueOnce({ origin: "https://verified.example", mode: "protected" })
        .mockResolvedValueOnce({ origin: "https://redirected.example", mode: "strict" }),
    );
    await mountPopup(root, chromeApi);
    const [, protectedButton, strict] = getModeButtons(root);

    strict!.click();

    await vi.waitFor(() => {
      expect(protectedButton?.getAttribute("aria-pressed")).toBe("true");
      expect(strict?.getAttribute("aria-pressed")).toBe("false");
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
        .mockResolvedValueOnce({ origin: "https://verified.example", mode: "protected" })
        .mockImplementationOnce(() => save.promise),
    );
    await mountPopup(root, chromeApi);
    const [, protectedButton, strict] = getModeButtons(root);

    strict!.click();
    expect(strict?.getAttribute("aria-pressed")).toBe("true");
    expect(protectedButton?.getAttribute("aria-pressed")).toBe("false");

    save.reject(new Error("storage unavailable"));

    await vi.waitFor(() => {
      expect(protectedButton?.getAttribute("aria-pressed")).toBe("true");
      expect(strict?.getAttribute("aria-pressed")).toBe("false");
      expect(root.querySelector('[role="alert"]')?.textContent).toBe(
        "Could not update protection. Try again.",
      );
    });
    expect((root.querySelector('[role="alert"]') as HTMLElement).hidden).toBe(false);
  });
});
