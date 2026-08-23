import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isTrustedActivation,
  ProtectionRenderer,
  type ProtectionHandle,
  type RendererEnvironment,
} from "../../src/protection/renderer";
import type { MediaCandidate, MediaKind } from "../../src/shared/media-types";

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
  options: {
    kind?: MediaKind;
    onReveal?: () => void;
    onToggleDescriptions?: () => void;
    descriptionsVisible?: boolean;
    onReprotect?: () => void;
    description?: string;
  } = {},
) {
  const protectionOptions = {
    description: options.description ?? "A black audio component",
    onReveal: options.onReveal ?? vi.fn(),
    onToggleDescriptions: options.onToggleDescriptions ?? vi.fn(),
    descriptionsVisible: options.descriptionsVisible ?? false,
    onReprotect: options.onReprotect ?? vi.fn(),
  };
  return renderer.protect(candidate(element, options.kind), protectionOptions);
}

afterEach(() => {
  document.documentElement.replaceChildren(document.createElement("head"), document.createElement("body"));
});

describe("ProtectionRenderer", () => {
  it("renders an isolated frost layer over one media item", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(20, 30, 640, 360));
    document.body.append(image);
    const renderer = new ProtectionRenderer();

    const handle = protect(renderer, image);
    const root = document.querySelector<HTMLElement>("[data-buof-root]");
    const layer = renderer.debugLayerFor(image);

    expect(root).not.toBeNull();
    expect(root?.shadowRoot).not.toBeNull();
    expect(root?.querySelector("[data-buof-root]")).toBeNull();
    expect(handle.isRevealed()).toBe(false);
    expect(image.getAttribute("data-buof-protected")).toBe("image");
    expect(image.getAttributeNames().filter((name) => name.startsWith("data-buof-"))).toEqual([
      "data-buof-protected",
    ]);
    expect(layer?.textContent).toContain("A black audio component");
    expect(layer?.querySelector("img")).toBeNull();
    expect(layer?.style.left).toBe("20px");
    expect(layer?.style.top).toBe("30px");
    expect(layer?.style.width).toBe("640px");
    expect(layer?.style.height).toBe("360px");
  });

  it("renders direct reveal and description controls without a media menu", () => {
    const before = document.createElement("button");
    before.textContent = "Before";
    const image = document.createElement("img");
    const after = document.createElement("button");
    after.textContent = "After";
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(20, 30, 640, 360));
    document.body.append(before, image, after);
    const renderer = new ProtectionRenderer();

    protect(renderer, image);

    const host = image.nextElementSibling as HTMLElement | null;
    const layer = renderer.debugLayerFor(image);
    expect(host?.hasAttribute("data-buof-root")).toBe(true);
    expect(host?.nextElementSibling).toBe(after);
    expect(layer?.tagName).toBe("DIV");
    expect(layer?.querySelector(".buof-reveal-surface")?.getAttribute("aria-label")).toBe(
      "Reveal blocked subject: A black audio component",
    );
    expect(layer?.querySelector(".buof-info-control")).not.toBeNull();
    expect(layer?.querySelector(".buof-site-control")).toBeNull();
    expect(layer?.querySelector(".buof-menu")).toBeNull();
    expect(layer?.querySelector(".buof-reveal-all")).toBeNull();
    expect(layer?.querySelector(".buof-allow-site")).toBeNull();
  });

  it("names a blocked subject on its reveal surface", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(20, 30, 640, 360));
    document.body.append(image);
    const renderer = new ProtectionRenderer();

    protect(renderer, image);

    expect(renderer.debugLayerFor(image)?.querySelector(".buof-reveal-surface")?.getAttribute("aria-label"))
      .toBe("Reveal blocked subject: A black audio component");
  });

  it("renders a quiet Show cue inside the reveal surface", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(20, 30, 640, 360));
    document.body.append(image);
    const renderer = new ProtectionRenderer();

    protect(renderer, image);

    const cue = renderer.debugLayerFor(image)?.querySelector(".buof-show-cue");
    expect(cue?.textContent).toBe("Show");
    expect(cue?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps a blocked image frosted beneath an overlapping iframe", () => {
    const image = document.createElement("img");
    const frame = document.createElement("iframe");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(20, 30, 640, 360));
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(rect(20, 30, 640, 360));
    document.body.append(image, frame);
    const renderer = new ProtectionRenderer();

    protect(renderer, image);

    expect(renderer.debugLayerFor(image)?.style.visibility).toBe("");
  });

  it("uses one info button to preview and pin the full description without revealing", () => {
    const description = "A deliberately long description of an image that continues well beyond fifty characters.";
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(20, 30, 640, 360));
    document.body.append(image);
    const onReveal = vi.fn();
    const renderer = new ProtectionRenderer({
      trustedActivation: (event) => event instanceof MouseEvent && event.type === "click",
    });
    const handle = protect(renderer, image, { description, onReveal });
    const layer = renderer.debugLayerFor(image);
    const control = layer?.querySelector<HTMLElement>(".buof-info-control");
    const info = layer?.querySelector<HTMLButtonElement>(".buof-info-button");

    expect(layer?.querySelector(".buof-caption")).toBeNull();
    expect(info?.textContent).toBe("i");
    expect(info?.getAttribute("aria-expanded")).toBe("false");
    expect(layer?.querySelector(".buof-info-preview")?.textContent).toBe(
      `${Array.from(description).slice(0, 50).join("")}…`,
    );
    expect(layer?.querySelector(".buof-info-description")?.textContent).toBe(description);
    expect(layer?.querySelector(".buof-info-always")?.textContent).toBe(
      "Show descriptions by default on this site",
    );

    info?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(control?.classList.contains("buof-info-pinned")).toBe(true);
    expect(info?.getAttribute("aria-expanded")).toBe("true");
    expect(handle.isRevealed()).toBe(false);
    expect(onReveal).not.toHaveBeenCalled();
  });

  it("pins descriptions for every item when the permanent site option is activated", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(20, 30, 640, 360));
    document.body.append(image);
    const onToggleDescriptions = vi.fn();
    const renderer = new ProtectionRenderer({
      trustedActivation: (event) => event instanceof MouseEvent && event.type === "click",
    });
    const handle = protect(renderer, image, { onToggleDescriptions });
    const pageDescriptions = renderer.debugLayerFor(image)?.querySelector(".buof-toggle-descriptions");

    expect(pageDescriptions).toBeNull();

    const descriptionHandle = handle as ProtectionHandle & {
      setDescriptionVisible?: (visible: boolean) => void;
    };
    expect(typeof descriptionHandle.setDescriptionVisible).toBe("function");
    expect(renderer.debugLayerFor(image)?.querySelector(".buof-info-control")?.classList
      .contains("buof-info-pinned")).toBe(false);

    renderer.debugLayerFor(image)?.querySelector(".buof-info-button")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    renderer.debugLayerFor(image)?.querySelector(".buof-info-always")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(onToggleDescriptions).toHaveBeenCalledTimes(1);

    descriptionHandle.setDescriptionVisible?.(true);
    expect(renderer.debugLayerFor(image)?.querySelector(".buof-info-control")?.classList)
      .toContain("buof-info-pinned");
    expect(renderer.debugLayerFor(image)?.querySelector(".buof-info-always")?.textContent)
      .toBe("Stop showing descriptions by default");
  });

  it("uses a compact thumbnail treatment at normal feed-thumbnail size", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(0, 0, 225, 169));
    document.body.append(image);
    const renderer = new ProtectionRenderer();

    protect(renderer, image);

    const layer = renderer.debugLayerFor(image);
    expect(layer?.classList).toContain("buof-compact");
    expect(layer?.style.getPropertyValue("--buof-control-size")).toBe("30px");
    expect(layer?.style.getPropertyValue("--buof-control-inset")).toBe("6px");
    expect(layer?.style.getPropertyValue("--buof-frost-blur")).toBe("12px");
    expect(layer?.querySelector(".buof-caption")).toBeNull();
    expect(layer?.querySelector(".buof-info-control")?.hasAttribute("hidden")).toBe(true);
  });

  it("hides image descriptions on short background-image cards", () => {
    const card = document.createElement("div");
    vi.spyOn(card, "getBoundingClientRect").mockReturnValue(rect(0, 0, 488, 275));
    document.body.append(card);
    const renderer = new ProtectionRenderer();

    protect(renderer, card, { kind: "background-image" });

    expect(renderer.debugLayerFor(card)?.querySelector(".buof-info-control")?.hasAttribute("hidden")).toBe(true);
  });

  it.each([
    [320, 240, "36px", "18px"],
    [800, 600, "44px", "25px"],
  ])("scales controls and blur for a %sx%s media item", (width, height, control, blur) => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(0, 0, width, height));
    document.body.append(image);
    const renderer = new ProtectionRenderer();

    protect(renderer, image);

    const layer = renderer.debugLayerFor(image);
    expect(layer?.style.getPropertyValue("--buof-control-size")).toBe(control);
    expect(layer?.style.getPropertyValue("--buof-frost-blur")).toBe(blur);
  });

  it("reveals linked media without activating its link", () => {
    const link = document.createElement("a");
    link.href = "/destination";
    const image = document.createElement("img");
    link.append(image);
    const after = document.createElement("button");
    document.body.append(link, after);
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(0, 0, 640, 360));
    const linkActivation = vi.fn();
    const documentActivation = vi.fn();
    link.addEventListener("click", (event) => {
      event.preventDefault();
      linkActivation();
    });
    document.addEventListener("click", documentActivation, { once: true });
    const onReveal = vi.fn();
    const renderer = new ProtectionRenderer({
      trustedActivation: (event) => event.type === "click",
    });
    protect(renderer, image, { onReveal });

    const host = link.nextElementSibling as HTMLElement | null;
    const activation = new MouseEvent("click", { bubbles: true, cancelable: true });
    const uncancelled = renderer.debugLayerFor(image)?.querySelector(".buof-reveal-surface")?.dispatchEvent(activation);

    expect(host?.hasAttribute("data-buof-root")).toBe(true);
    expect(host?.nextElementSibling).toBe(after);
    expect(link.contains(host)).toBe(false);
    expect(uncancelled).toBe(false);
    expect(linkActivation).not.toHaveBeenCalled();
    expect(documentActivation).not.toHaveBeenCalled();
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  it("places a picture control after its nearest interactive button ancestor", () => {
    const wrapper = document.createElement("button");
    const picture = document.createElement("picture");
    const image = document.createElement("img");
    picture.append(image);
    wrapper.append(picture);
    const after = document.createElement("span");
    document.body.append(wrapper, after);
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(0, 0, 640, 360));
    const renderer = new ProtectionRenderer();

    protect(renderer, image);

    const host = wrapper.nextElementSibling as HTMLElement | null;
    expect(host?.hasAttribute("data-buof-root")).toBe(true);
    expect(host?.nextElementSibling).toBe(after);
    expect(wrapper.contains(host)).toBe(false);
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
      trustedActivation: (event) => event instanceof MouseEvent && event.type === "click",
    });
    const firstHandle = protect(renderer, first, { onReveal: onFirstReveal });
    const secondHandle = protect(renderer, second, { onReveal: onSecondReveal });

    renderer.debugLayerFor(first)?.querySelector(".buof-reveal-surface")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    expect(onFirstReveal).toHaveBeenCalledTimes(1);
    expect(onSecondReveal).not.toHaveBeenCalled();
    expect(firstHandle.isRevealed()).toBe(true);
    expect(first.hasAttribute("data-buof-protected")).toBe(false);
    expect(secondHandle.isRevealed()).toBe(false);
    expect(second.getAttribute("data-buof-protected")).toBe("image");
  });

  it("moves keyboard focus from Reveal to Frost again", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(0, 0, 640, 360));
    document.body.append(image);
    const renderer = new ProtectionRenderer({ trustedActivation: () => true });
    protect(renderer, image);
    const layer = renderer.debugLayerFor(image)!;
    const shadow = layer.getRootNode() as ShadowRoot;
    const reveal = layer.querySelector<HTMLButtonElement>(".buof-reveal-surface")!;

    reveal.focus();
    reveal.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(shadow.activeElement).toBe(layer.querySelector(".buof-reprotect"));
  });

  it("moves keyboard focus from Frost again back to Reveal", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(0, 0, 640, 360));
    document.body.append(image);
    const renderer = new ProtectionRenderer({ trustedActivation: () => true });
    const handle = protect(renderer, image);
    const layer = renderer.debugLayerFor(image)!;
    const shadow = layer.getRootNode() as ShadowRoot;
    handle.reveal();
    const reprotect = layer.querySelector<HTMLButtonElement>(".buof-reprotect")!;

    reprotect.focus();
    reprotect.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(shadow.activeElement).toBe(layer.querySelector(".buof-reveal-surface"));
  });

  it("rejects page-dispatched synthetic pointer activation", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(0, 0, 640, 360));
    document.body.append(image);
    const onReveal = vi.fn();
    const renderer = new ProtectionRenderer();
    const handle = protect(renderer, image, { onReveal });

    renderer.debugLayerFor(image)?.querySelector(".buof-reveal-surface")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

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

    layer?.querySelector(".buof-reveal-surface")?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    expect(onReveal).not.toHaveBeenCalled();
    expect(handle.isRevealed()).toBe(false);

    layer?.querySelector(".buof-reveal-surface")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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

    const protectAgain = renderer.debugLayerFor(first);
    expect(protectAgain?.querySelector(".buof-reprotect")?.getAttribute("aria-label")).toBe("Frost again");
    protectAgain?.querySelector(".buof-reprotect")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onFirstReprotect).toHaveBeenCalledTimes(1);
    expect(onSecondReprotect).not.toHaveBeenCalled();
    expect(firstHandle.isRevealed()).toBe(false);
    expect(secondHandle.isRevealed()).toBe(true);
  });

  it("keeps protected and revealed controls in the visible corner of oversized media", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(427);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(240);
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(34, 0, 900, 506));
    document.body.append(image);
    const renderer = new ProtectionRenderer();
    const handle = protect(renderer, image);
    const layer = renderer.debugLayerFor(image);

    expect(layer?.style.getPropertyValue("--buof-control-right")).toBe("519px");
    expect(layer?.style.getPropertyValue("--buof-control-top")).toBe("12px");
    expect(layer?.style.getPropertyValue("--buof-caption-left")).toBe("12px");
    expect(layer?.style.getPropertyValue("--buof-caption-bottom")).toBe("12px");

    handle.reveal();

    expect(layer?.style.left).toBe("371px");
    expect(layer?.style.top).toBe("12px");
    expect(layer?.style.width).toBe("44px");
    expect(layer?.style.height).toBe("44px");
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

  it("uses document coordinates so the browser scrolls frost with its image", () => {
    vi.spyOn(window, "scrollX", "get").mockReturnValue(120);
    vi.spyOn(window, "scrollY", "get").mockReturnValue(500);
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(20, 30, 640, 360));
    document.body.append(image);
    const renderer = new ProtectionRenderer();

    protect(renderer, image);

    const layer = renderer.debugLayerFor(image);
    expect(layer?.getRootNode()).toBeInstanceOf(ShadowRoot);
    expect(((layer?.getRootNode() as ShadowRoot).host as HTMLElement).style.position).toBe("absolute");
    expect(layer?.style.left).toBe("140px");
    expect(layer?.style.top).toBe("530px");
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

  it("uses the same compact info control and preserves the full description on its reveal surface", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(0, 0, 159, 89));
    document.body.append(image);
    const renderer = new ProtectionRenderer();

    protect(renderer, image);

    const layer = renderer.debugLayerFor(image);
    expect(layer?.querySelector(".buof-caption")).toBeNull();
    expect(layer?.querySelector(".buof-info-control")?.hasAttribute("hidden")).toBe(true);
    expect(layer?.querySelector(".buof-reveal-surface")?.getAttribute("aria-label")).toContain("A black audio component");
    expect(layer?.querySelector(".buof-site-control")).toBeNull();
    expect(renderer.debugLayerFor(image)?.classList.contains("buof-compact")).toBe(true);
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

    const layer = renderer.debugLayerFor(image);
    expect(layer?.querySelector(".buof-caption")).toBeNull();
    expect(layer?.querySelector(".buof-info-control")?.hasAttribute("hidden")).toBe(true);
    expect(layer?.querySelector(".buof-reveal-surface")?.getAttribute("aria-label")).toContain("A black audio component");
    expect(layer?.querySelector(".buof-site-control")).toBeNull();
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
