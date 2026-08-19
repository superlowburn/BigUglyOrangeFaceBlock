import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isTrustedActivation,
  ProtectionRenderer,
  type RendererEnvironment,
} from "../../src/protection/renderer";
import type { MediaCandidate, MediaKind, SiteMode } from "../../src/shared/media-types";

function candidate(element: HTMLElement, kind: MediaKind = "image"): MediaCandidate {
  return { element, kind };
}

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
  pending: () => number;
} {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();

  return {
    environment: {
      requestAnimationFrame: (callback) => {
        const id = nextId++;
        callbacks.set(id, callback);
        return id;
      },
      cancelAnimationFrame: (id) => callbacks.delete(id),
    },
    flush: () => {
      const queued = [...callbacks.values()];
      callbacks.clear();
      queued.forEach((callback) => callback(0));
    },
    pending: () => callbacks.size,
  };
}

function protect(
  renderer: ProtectionRenderer,
  element: HTMLElement,
  options: { kind?: MediaKind; mode?: SiteMode; onReveal?: () => void; onReprotect?: () => void } = {},
) {
  return renderer.protect(candidate(element, options.kind), {
    description: "A black audio component",
    mode: options.mode ?? "protected",
    onReveal: options.onReveal ?? vi.fn(),
    onReprotect: options.onReprotect ?? vi.fn(),
  });
}

afterEach(() => {
  document.documentElement.replaceChildren(document.createElement("head"), document.createElement("body"));
});

describe("ProtectionRenderer", () => {
  it("renders an isolated text-only frost layer over one media item", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(20, 30, 640, 360));
    document.body.append(image);
    const renderer = new ProtectionRenderer();

    const handle = protect(renderer, image);
    const root = document.querySelector<HTMLElement>("[data-eclipse-goggles-root]");
    const layer = renderer.debugLayerFor(image);

    expect(root).not.toBeNull();
    expect(root?.shadowRoot).not.toBeNull();
    expect(root?.querySelector("[data-eclipse-goggles-root]")).toBeNull();
    expect(handle.isRevealed()).toBe(false);
    expect(layer?.textContent).toContain("A black audio component");
    expect(layer?.querySelector("img")).toBeNull();
    expect(layer?.style.left).toBe("20px");
    expect(layer?.style.top).toBe("30px");
    expect(layer?.style.width).toBe("640px");
    expect(layer?.style.height).toBe("360px");
  });

  it("reveals only the keyboard-activated item once", () => {
    const first = document.createElement("img");
    const second = document.createElement("img");
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue(rect(0, 0, 640, 360));
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue(rect(0, 400, 640, 360));
    document.body.append(first, second);
    const onFirstReveal = vi.fn();
    const onSecondReveal = vi.fn();
    const renderer = new ProtectionRenderer({
      trustedActivation: (event) => event instanceof KeyboardEvent && event.key === "Enter",
    });
    const firstHandle = protect(renderer, first, { onReveal: onFirstReveal });
    const secondHandle = protect(renderer, second, { onReveal: onSecondReveal });

    renderer.debugLayerFor(first)?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    renderer.debugLayerFor(first)?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onFirstReveal).toHaveBeenCalledTimes(1);
    expect(onSecondReveal).not.toHaveBeenCalled();
    expect(firstHandle.isRevealed()).toBe(true);
    expect(secondHandle.isRevealed()).toBe(false);
  });

  it("rejects page-dispatched synthetic pointer activation", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(0, 0, 640, 360));
    document.body.append(image);
    const onReveal = vi.fn();
    const renderer = new ProtectionRenderer();
    const handle = protect(renderer, image, { onReveal });

    renderer.debugLayerFor(image)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onReveal).not.toHaveBeenCalled();
    expect(handle.isRevealed()).toBe(false);
  });

  it("ignores trusted pointerup and reveals on trusted click through the activation seam", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(0, 0, 640, 360));
    document.body.append(image);
    const onReveal = vi.fn();
    const renderer = new ProtectionRenderer({
      trustedActivation: (event) =>
        isTrustedActivation({
          type: event.type,
          key: event instanceof KeyboardEvent ? event.key : undefined,
          isTrusted: true,
        } as unknown as Event),
    });
    const handle = protect(renderer, image, { onReveal });
    const layer = renderer.debugLayerFor(image);

    layer?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    expect(onReveal).not.toHaveBeenCalled();
    expect(handle.isRevealed()).toBe(false);

    layer?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(handle.isRevealed()).toBe(true);
  });

  it("re-protects only the item whose compact control is activated", () => {
    const first = document.createElement("img");
    const second = document.createElement("img");
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue(rect(0, 0, 640, 360));
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue(rect(0, 400, 640, 360));
    document.body.append(first, second);
    const onFirstReprotect = vi.fn();
    const onSecondReprotect = vi.fn();
    const renderer = new ProtectionRenderer({
      trustedActivation: (event) => event instanceof MouseEvent && event.type === "click",
    });
    const firstHandle = protect(renderer, first, { onReprotect: onFirstReprotect });
    const secondHandle = protect(renderer, second, { onReprotect: onSecondReprotect });
    firstHandle.reveal();
    secondHandle.reveal();

    const protectAgain = renderer.debugLayerFor(first)?.querySelector<HTMLButtonElement>("button");
    expect(protectAgain?.textContent).toBe("Protect again");
    protectAgain?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onFirstReprotect).toHaveBeenCalledTimes(1);
    expect(onSecondReprotect).not.toHaveBeenCalled();
    expect(firstHandle.isRevealed()).toBe(false);
    expect(secondHandle.isRevealed()).toBe(true);
  });

  it("deduplicates scroll and resize position work into one animation frame", () => {
    const frames = frameQueue();
    const image = document.createElement("img");
    const box = vi
      .spyOn(image, "getBoundingClientRect")
      .mockReturnValueOnce(rect(20, 30, 640, 360))
      .mockReturnValue(rect(45, 55, 500, 280));
    document.body.append(image);
    const renderer = new ProtectionRenderer(frames.environment);
    protect(renderer, image);

    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));

    expect(frames.pending()).toBe(1);
    frames.flush();
    expect(box).toHaveBeenCalledTimes(2);
    expect(renderer.debugLayerFor(image)?.style.left).toBe("45px");
    expect(renderer.debugLayerFor(image)?.style.top).toBe("55px");
    expect(renderer.debugLayerFor(image)?.style.width).toBe("500px");
    expect(renderer.debugLayerFor(image)?.style.height).toBe("280px");
  });

  it("deduplicates repeated public updates and applies the latest rectangle after the frame", () => {
    const frames = frameQueue();
    const image = document.createElement("img");
    const box = vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(20, 30, 640, 360));
    document.body.append(image);
    const renderer = new ProtectionRenderer(frames.environment);
    const handle = protect(renderer, image);

    box.mockReturnValue(rect(45, 55, 500, 280));
    handle.update();
    box.mockReturnValue(rect(80, 90, 420, 240));
    handle.update();

    expect(frames.pending()).toBe(1);
    expect(box).toHaveBeenCalledTimes(1);
    expect(renderer.debugLayerFor(image)?.style.left).toBe("20px");
    frames.flush();
    expect(box).toHaveBeenCalledTimes(2);
    expect(renderer.debugLayerFor(image)?.style.left).toBe("80px");
    expect(renderer.debugLayerFor(image)?.style.top).toBe("90px");
    expect(renderer.debugLayerFor(image)?.style.width).toBe("420px");
    expect(renderer.debugLayerFor(image)?.style.height).toBe("240px");
  });

  it("uses compact copy and preserves the full description as its accessible label", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(0, 0, 159, 89));
    document.body.append(image);
    const renderer = new ProtectionRenderer();

    protect(renderer, image);

    const button = renderer.debugLayerFor(image)?.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toBe("Reveal image");
    expect(button?.getAttribute("aria-label")).toContain("A black audio component");
    expect(renderer.debugLayerFor(image)?.classList.contains("eg-compact")).toBe(true);
  });

  it("switches to compact controls when an updated media rectangle becomes small", () => {
    const frames = frameQueue();
    const image = document.createElement("img");
    const box = vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(0, 0, 640, 360));
    document.body.append(image);
    const renderer = new ProtectionRenderer(frames.environment);
    const handle = protect(renderer, image);

    box.mockReturnValue(rect(0, 0, 159, 89));
    handle.update();
    frames.flush();

    const button = renderer.debugLayerFor(image)?.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toBe("Reveal image");
    expect(button?.getAttribute("aria-label")).toContain("A black audio component");
  });

  it("watches revealed strict items and disposes the watch when they are re-protected", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(0, 0, 640, 360));
    document.body.append(image);
    const dispose = vi.fn();
    const watch = vi.fn(() => dispose);
    const createStrictGuard = vi.fn(() => ({ watch }));
    const renderer = new ProtectionRenderer({ createStrictGuard });
    const handle = protect(renderer, image, { mode: "strict" });

    handle.reveal();
    expect(createStrictGuard).toHaveBeenCalledTimes(1);
    expect(watch).toHaveBeenCalledWith(image, expect.any(Function));

    handle.reprotect();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it.each(["protected", "trusted"] as const)("does not create a strict guard for %s mode", (mode) => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(0, 0, 640, 360));
    document.body.append(image);
    const createStrictGuard = vi.fn();
    const renderer = new ProtectionRenderer({ createStrictGuard });
    const handle = protect(renderer, image, { mode });

    handle.reveal();

    expect(createStrictGuard).not.toHaveBeenCalled();
  });
});

describe("isTrustedActivation", () => {
  it("accepts only trusted click and supported keyboard activations", () => {
    expect(isTrustedActivation({ type: "click", isTrusted: true } as Event)).toBe(true);
    expect(isTrustedActivation({ type: "keydown", key: "Enter", isTrusted: true } as KeyboardEvent)).toBe(true);
    expect(isTrustedActivation({ type: "keydown", key: " ", isTrusted: true } as KeyboardEvent)).toBe(true);
    expect(isTrustedActivation({ type: "click", isTrusted: false } as Event)).toBe(false);
    expect(isTrustedActivation({ type: "pointerup", isTrusted: true } as Event)).toBe(false);
    expect(isTrustedActivation({ type: "keydown", key: "Escape", isTrusted: true } as KeyboardEvent)).toBe(false);
  });
});
