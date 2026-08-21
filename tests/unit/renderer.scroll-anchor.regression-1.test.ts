import { afterEach, expect, it, vi } from "vitest";
import { ProtectionRenderer, type RendererEnvironment } from "../../src/protection/renderer";
import type { MediaCandidate } from "../../src/shared/media-types";

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  };
}

function frameQueue(): {
  environment: Pick<RendererEnvironment, "requestAnimationFrame" | "cancelAnimationFrame">;
  flush: () => void;
} {
  let callback: FrameRequestCallback | undefined;
  return {
    environment: {
      requestAnimationFrame: (next) => {
        callback = next;
        return 1;
      },
      cancelAnimationFrame: () => {
        callback = undefined;
      },
    },
    flush: () => {
      const next = callback;
      callback = undefined;
      next?.(0);
    },
  };
}

afterEach(() => {
  document.documentElement.replaceChildren(document.createElement("head"), document.createElement("body"));
});

// Regression: the info button chased the viewport while a tall image scrolled.
// It must remain anchored to the image's actual bottom-left corner.
it("keeps the info control anchored to the media bottom-left while scrolling", () => {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(711);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(730);
  const frames = frameQueue();
  const image = document.createElement("img");
  const imageBox = vi.spyOn(image, "getBoundingClientRect");
  imageBox.mockReturnValue(rect(111, 312, 620, 800));
  document.body.append(image);

  const renderer = new ProtectionRenderer(frames.environment);
  renderer.protect(
    { element: image, kind: "image" } satisfies MediaCandidate,
    {
      description: "A news photograph",
      mode: "protected",
      onReveal: vi.fn(),
      onToggleDescriptions: vi.fn(),
      descriptionsVisible: false,
      onReprotect: vi.fn(),
    },
  );
  const layer = renderer.debugLayerFor(image);

  expect(layer?.style.getPropertyValue("--eg-caption-bottom")).toBe("12px");

  imageBox.mockReturnValue(rect(111, -188, 620, 800));
  window.dispatchEvent(new Event("scroll"));
  frames.flush();

  expect(layer?.style.getPropertyValue("--eg-caption-bottom")).toBe("12px");
});
