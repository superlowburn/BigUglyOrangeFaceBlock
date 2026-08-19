import { describe, expect, it, vi } from "vitest";
import {
  isSupportedVideoFrame,
  ProviderFrameController,
} from "../../src/media/provider-frames";

function frame(source?: string): HTMLIFrameElement {
  const element = document.createElement("iframe");
  if (source !== undefined) element.setAttribute("src", source);
  return element;
}

function authorization() {
  let nextGrant = 1;
  return {
    authorize: vi.fn(async (source: string, disableAutoplay: boolean) => {
      const url = new URL(source);
      if (disableAutoplay) url.searchParams.set("autoplay", "0");
      url.searchParams.set("eg_eclipse_goggles", "unit-token");
      return { grantId: nextGrant++, source: url.href };
    }),
    revoke: vi.fn().mockResolvedValue(undefined),
  };
}

function navigation() {
  return {
    prepare: vi.fn(async (element: HTMLIFrameElement) => {
      element.setAttribute("src", "about:blank");
    }),
    navigate: vi.fn((element: HTMLIFrameElement, source: string) => {
      element.setAttribute("src", source);
    }),
  };
}

describe("isSupportedVideoFrame", () => {
  it.each([
    "https://www.youtube.com/embed/abc123",
    "https://www.youtube-nocookie.com/embed/abc123",
    "https://player.vimeo.com/video/123456",
  ])("recognizes the supported provider embed %s", (source) => {
    expect(isSupportedVideoFrame(frame(source))).toBe(true);
  });

  it.each([
    "https://www.youtube.com/watch?v=abc123",
    "https://www.google.com/maps/embed?pb=location",
    "https://docs.google.com/forms/d/e/form-id/viewform",
    "",
    "https://www.youtube.com.evil.test/embed/abc123",
    "https://player.vimeo.com.evil.test/video/123456",
    "http://www.youtube.com/embed/abc123",
  ])("rejects the unsupported or deceptive source %j", (source) => {
    expect(isSupportedVideoFrame(frame(source))).toBe(false);
  });

  it("rejects non-iframe elements", () => {
    expect(isSupportedVideoFrame(document.createElement("video"))).toBe(false);
  });
});

describe("ProviderFrameController", () => {
  it("gates a supported frame idempotently and releases one autoplay-disabled source", async () => {
    const access = authorization();
    const browser = navigation();
    const controller = new ProviderFrameController(access, browser);
    const originalSource =
      "https://www.youtube-nocookie.com/embed/abc123?autoplay=1&start=4#chapter";
    const element = frame(originalSource);
    controller.gate(element);
    expect(element.getAttribute("src")).toBe("about:blank");

    controller.gate(element);
    expect(element.getAttribute("src")).toBe("about:blank");

    await controller.release(element);
    expect(browser.navigate).toHaveBeenCalledTimes(1);
    const released = new URL(browser.navigate.mock.calls[0]![1]);
    expect(element.getAttribute("src")).toBe(released.href);
    expect(released.origin + released.pathname).toBe(
      "https://www.youtube-nocookie.com/embed/abc123",
    );
    expect(released.searchParams.get("autoplay")).toBe("0");
    expect(released.searchParams.get("eg_eclipse_goggles")).toBe("unit-token");
    expect(released.hash).toBe("#chapter");
  });

  it("regates a released frame and restore authorizes its original source", async () => {
    const access = authorization();
    const browser = navigation();
    const controller = new ProviderFrameController(access, browser);
    const originalSource = "https://player.vimeo.com/video/123456?autopause=0";
    const element = frame(originalSource);
    controller.gate(element);
    await controller.release(element);

    controller.regate(element);
    expect(element.getAttribute("src")).toBe("about:blank");

    await controller.restore(element);
    const restored = new URL(browser.navigate.mock.calls.at(-1)![1]);
    expect(element.getAttribute("src")).toBe(restored.href);
    expect(restored.origin + restored.pathname).toBe("https://player.vimeo.com/video/123456");
    expect(restored.searchParams.get("autopause")).toBe("0");
    expect(restored.searchParams.get("autoplay")).toBeNull();
    expect(restored.searchParams.get("eg_eclipse_goggles")).toBe("unit-token");
    expect(access.revoke).toHaveBeenCalled();
  });

  it("authorizes and navigates a Trusted original iframe exactly once", async () => {
    const access = authorization();
    const browser = navigation();
    const controller = new ProviderFrameController(access, browser);
    const originalSource = "https://www.youtube.com/embed/abc123?autoplay=1";
    const element = frame(originalSource);

    await Promise.all([
      controller.trust(element),
      controller.trust(element),
      controller.trust(element),
    ]);
    await controller.trust(element);

    expect(access.authorize).toHaveBeenCalledTimes(1);
    expect(browser.navigate).toHaveBeenCalledTimes(1);
    expect(element.getAttribute("src")).toContain("eg_eclipse_goggles=unit-token");
    expect(browser.prepare).toHaveBeenCalledTimes(1);
  });

  it("re-authorizes Trusted iframe only after the page changes its visible source", async () => {
    const access = authorization();
    const browser = navigation();
    const controller = new ProviderFrameController(access, browser);
    const element = frame("https://www.youtube.com/embed/first");
    await controller.trust(element);

    element.setAttribute("src", "https://player.vimeo.com/video/456");
    await controller.trust(element);

    expect(access.authorize).toHaveBeenCalledTimes(2);
    expect(browser.navigate).toHaveBeenCalledTimes(2);
    expect(element.getAttribute("src")).toContain("https://player.vimeo.com/video/456");
    expect(element.getAttribute("src")).toContain("eg_eclipse_goggles=unit-token");
  });

  it("re-authorizes one Trusted iframe when the page resets its exact original source", async () => {
    const access = authorization();
    const browser = navigation();
    const controller = new ProviderFrameController(access, browser);
    const originalSource = "https://www.youtube.com/embed/first?autoplay=1";
    const element = frame(originalSource);
    await controller.trust(element);

    element.setAttribute("src", originalSource);
    await controller.trust(element);
    await controller.trust(element);

    expect(access.authorize).toHaveBeenCalledTimes(2);
    expect(browser.navigate).toHaveBeenCalledTimes(2);
  });

  it("revokes the grant when selected browsing-context navigation fails", async () => {
    const access = authorization();
    const controller = new ProviderFrameController(access, {
      prepare: vi.fn(async (target: HTMLIFrameElement) => {
        target.setAttribute("src", "about:blank");
      }),
      navigate: () => {
        throw new DOMException("frame detached", "InvalidStateError");
      },
    });
    const element = frame("https://www.youtube.com/embed/abc123");
    controller.gate(element);

    await expect(controller.release(element)).rejects.toThrow("frame detached");

    expect(access.revoke).toHaveBeenCalledWith(1);
    expect(element.getAttribute("src")).toBe("about:blank");
  });

  it("disposes Trusted frame grants during page teardown", async () => {
    const access = authorization();
    const browser = navigation();
    const controller = new ProviderFrameController(access, browser);
    const element = frame("https://www.youtube.com/embed/abc123");
    await controller.trust(element);

    controller.dispose();

    await vi.waitFor(() => expect(access.revoke).toHaveBeenCalledWith(1));
  });

  it("does not let a stale inert-document load revoke the selected navigation grant", async () => {
    const access = authorization();
    const browser = navigation();
    const controller = new ProviderFrameController(access, browser);
    const element = frame("https://www.youtube.com/embed/abc123");
    controller.gate(element);
    await controller.release(element);

    element.dispatchEvent(new Event("load"));
    await Promise.resolve();

    expect(access.revoke).not.toHaveBeenCalled();
    controller.regate(element);
    await vi.waitFor(() => expect(access.revoke).toHaveBeenCalledWith(1));
  });

  it("does not touch unrecognized frames", () => {
    const controller = new ProviderFrameController(authorization());
    const originalSource = "https://www.youtube.com/watch?v=abc123";
    const element = frame(originalSource);

    controller.gate(element);
    controller.release(element);
    controller.regate(element);
    controller.restore(element);

    expect(element.getAttribute("src")).toBe(originalSource);
  });
});
