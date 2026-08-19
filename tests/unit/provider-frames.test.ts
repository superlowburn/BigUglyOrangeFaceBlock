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
    const controller = new ProviderFrameController(access);
    const originalSource =
      "https://www.youtube-nocookie.com/embed/abc123?autoplay=1&start=4#chapter";
    const element = frame(originalSource);
    const contentWindowRead = vi.fn();
    Object.defineProperty(element, "contentWindow", {
      configurable: true,
      get: contentWindowRead,
    });

    controller.gate(element);
    expect(element.getAttribute("src")).toBe("about:blank");

    controller.gate(element);
    expect(element.getAttribute("src")).toBe("about:blank");

    await controller.release(element);
    const released = new URL(element.getAttribute("src")!);
    expect(released.origin + released.pathname).toBe(
      "https://www.youtube-nocookie.com/embed/abc123",
    );
    expect(released.searchParams.get("autoplay")).toBe("0");
    expect(released.searchParams.get("eg_eclipse_goggles")).toBe("unit-token");
    expect(released.hash).toBe("#chapter");
    expect(contentWindowRead).not.toHaveBeenCalled();
  });

  it("regates a released frame and restore authorizes its original source", async () => {
    const access = authorization();
    const controller = new ProviderFrameController(access);
    const originalSource = "https://player.vimeo.com/video/123456?autopause=0";
    const element = frame(originalSource);
    controller.gate(element);
    await controller.release(element);

    controller.regate(element);
    expect(element.getAttribute("src")).toBe("about:blank");

    await controller.restore(element);
    const restored = new URL(element.getAttribute("src")!);
    expect(restored.origin + restored.pathname).toBe("https://player.vimeo.com/video/123456");
    expect(restored.searchParams.get("autopause")).toBe("0");
    expect(restored.searchParams.get("autoplay")).toBeNull();
    expect(restored.searchParams.get("eg_eclipse_goggles")).toBe("unit-token");
    expect(access.revoke).toHaveBeenCalled();
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
