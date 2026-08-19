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
  it("gates a supported frame idempotently and restores its exact source on release", () => {
    const controller = new ProviderFrameController();
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

    controller.release(element);
    expect(element.getAttribute("src")).toBe(originalSource);
    expect(contentWindowRead).not.toHaveBeenCalled();
  });

  it("regates a released frame and restore returns its exact original source", () => {
    const controller = new ProviderFrameController();
    const originalSource = "https://player.vimeo.com/video/123456?autopause=0";
    const element = frame(originalSource);
    controller.gate(element);
    controller.release(element);

    controller.regate(element);
    expect(element.getAttribute("src")).toBe("about:blank");

    controller.restore(element);
    expect(element.getAttribute("src")).toBe(originalSource);
  });

  it("does not touch unrecognized frames", () => {
    const controller = new ProviderFrameController();
    const originalSource = "https://www.youtube.com/watch?v=abc123";
    const element = frame(originalSource);

    controller.gate(element);
    controller.release(element);
    controller.regate(element);
    controller.restore(element);

    expect(element.getAttribute("src")).toBe(originalSource);
  });
});
