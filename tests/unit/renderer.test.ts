import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isTrustedActivation,
  ProtectionRenderer,
  type ProtectionHandle,
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
  options: {
    kind?: MediaKind;
    mode?: SiteMode;
    onReveal?: () => void;
    onRevealAll?: () => void;
    onAllowSite?: () => void;
    onOpenSettings?: () => void;
    onToggleDescriptions?: () => void;
    descriptionsVisible?: boolean;
    onReprotect?: () => void;
    description?: string;
  } = {},
) {
  const protectionOptions = {
    description: options.description ?? "A black audio component",
    mode: options.mode ?? "protected",
    onReveal: options.onReveal ?? vi.fn(),
    onRevealAll: options.onRevealAll ?? vi.fn(),
    onAllowSite: options.onAllowSite ?? vi.fn(),
    onOpenSettings: options.onOpenSettings ?? vi.fn(),
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
    const root = document.querySelector<HTMLElement>("[data-eclipse-goggles-root]");
    const layer = renderer.debugLayerFor(image);

    expect(root).not.toBeNull();
    expect(root?.shadowRoot).not.toBeNull();
    expect(root?.querySelector("[data-eclipse-goggles-root]")).toBeNull();
    expect(handle.isRevealed()).toBe(false);
    expect(image.getAttribute("data-eclipse-goggles-protected")).toBe("image");
    expect(image.getAttributeNames().filter((name) => name.startsWith("data-eclipse-goggles-"))).toEqual([
      "data-eclipse-goggles-protected",
    ]);
    expect(layer?.textContent).toContain("A black audio component");
    expect(layer?.querySelector("img")).toBeNull();
    expect(layer?.style.left).toBe("20px");
    expect(layer?.style.top).toBe("30px");
    expect(layer?.style.width).toBe("640px");
    expect(layer?.style.height).toBe("360px");
  });

  it("exposes a direct reveal surface and a closed goggles menu adjacent to the media", () => {
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
    expect(host?.hasAttribute("data-eclipse-goggles-root")).toBe(true);
    expect(host?.nextElementSibling).toBe(after);
    expect(layer?.tagName).toBe("DIV");
    expect(layer?.querySelector(".eg-reveal-surface")?.getAttribute("aria-label")).toBe(
      "Reveal protected media: A black audio component",
    );
    expect(layer?.querySelector(".eg-goggles")?.getAttribute("aria-expanded")).toBe("false");
    expect(layer?.querySelector(".eg-menu")?.hasAttribute("hidden")).toBe(true);
    expect(Array.from(layer?.querySelectorAll(".eg-menu > button:not(.eg-menu-brand)") ?? []).map((button) => button.textContent)).toEqual([
      "Reveal image",
      "Reveal all on page",
      "Always show on this site",
    ]);
    expect(layer?.querySelector(".eg-menu-brand")?.textContent).toBe("Custom GogglesBlocked subjects and site rules");
    expect(layer?.querySelector(".eg-goggles svg")?.getAttribute("aria-hidden")).toBe("true");
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
    const control = layer?.querySelector<HTMLElement>(".eg-info-control");
    const info = layer?.querySelector<HTMLButtonElement>(".eg-info-button");

    expect(layer?.querySelector(".eg-caption")).toBeNull();
    expect(info?.textContent).toBe("i");
    expect(info?.getAttribute("aria-expanded")).toBe("false");
    expect(layer?.querySelector(".eg-info-preview")?.textContent).toBe(
      `${Array.from(description).slice(0, 50).join("")}…`,
    );
    expect(layer?.querySelector(".eg-info-description")?.textContent).toBe(description);
    expect(layer?.querySelector(".eg-info-always")?.textContent).toBe(
      "Always show descriptions on this site",
    );

    info?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(control?.classList.contains("eg-info-pinned")).toBe(true);
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
    const pageDescriptions = renderer.debugLayerFor(image)?.querySelector(".eg-toggle-descriptions");

    expect(pageDescriptions).toBeNull();

    const descriptionHandle = handle as ProtectionHandle & {
      setDescriptionVisible?: (visible: boolean) => void;
    };
    expect(typeof descriptionHandle.setDescriptionVisible).toBe("function");
    expect(renderer.debugLayerFor(image)?.querySelector(".eg-info-control")?.classList
      .contains("eg-info-pinned")).toBe(false);

    renderer.debugLayerFor(image)?.querySelector(".eg-info-button")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    renderer.debugLayerFor(image)?.querySelector(".eg-info-always")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(onToggleDescriptions).toHaveBeenCalledTimes(1);

    descriptionHandle.setDescriptionVisible?.(true);
    expect(renderer.debugLayerFor(image)?.querySelector(".eg-info-control")?.classList)
      .toContain("eg-info-pinned");
    expect(renderer.debugLayerFor(image)?.querySelector(".eg-info-always")?.textContent)
      .toBe("Stop always showing descriptions");
  });

  it("uses a compact thumbnail treatment at normal feed-thumbnail size", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(0, 0, 225, 169));
    document.body.append(image);
    const renderer = new ProtectionRenderer();

    protect(renderer, image);

    const layer = renderer.debugLayerFor(image);
    expect(layer?.classList).toContain("eg-compact");
    expect(layer?.style.getPropertyValue("--eg-control-size")).toBe("30px");
    expect(layer?.style.getPropertyValue("--eg-control-inset")).toBe("6px");
    expect(layer?.style.getPropertyValue("--eg-frost-blur")).toBe("12px");
    expect(layer?.querySelector(".eg-caption")).toBeNull();
    expect(layer?.querySelector(".eg-info-control")?.hasAttribute("hidden")).toBe(true);
  });

  it("hides image descriptions on short background-image cards", () => {
    const card = document.createElement("div");
    vi.spyOn(card, "getBoundingClientRect").mockReturnValue(rect(0, 0, 488, 275));
    document.body.append(card);
    const renderer = new ProtectionRenderer();

    protect(renderer, card, { kind: "background-image" });

    expect(renderer.debugLayerFor(card)?.querySelector(".eg-info-control")?.hasAttribute("hidden")).toBe(true);
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
    expect(layer?.style.getPropertyValue("--eg-control-size")).toBe(control);
    expect(layer?.style.getPropertyValue("--eg-frost-blur")).toBe(blur);
  });

  it("opens settings from the Goggles brand row", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(0, 0, 640, 360));
    document.body.append(image);
    const onOpenSettings = vi.fn();
    const renderer = new ProtectionRenderer({
      trustedActivation: (event) => event instanceof MouseEvent && event.type === "click",
    });
    protect(renderer, image, { onOpenSettings });

    renderer.debugLayerFor(image)?.querySelector(".eg-menu-brand")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("opens the goggles menu and closes it when the pointer leaves the control", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(20, 30, 640, 360));
    document.body.append(image);
    const renderer = new ProtectionRenderer({
      trustedActivation: (event) => event instanceof MouseEvent && event.type === "click",
    });
    protect(renderer, image);
    const layer = renderer.debugLayerFor(image);
    const goggles = layer?.querySelector<HTMLButtonElement>(".eg-goggles");
    const menu = layer?.querySelector<HTMLElement>(".eg-menu");

    goggles?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(goggles?.getAttribute("aria-expanded")).toBe("true");
    expect(menu?.hasAttribute("hidden")).toBe(false);
    expect(layer?.classList.contains("eg-menu-open")).toBe(true);

    layer?.querySelector(".eg-goggles-control")?.dispatchEvent(new MouseEvent("mouseleave"));

    expect(goggles?.getAttribute("aria-expanded")).toBe("false");
    expect(menu?.hasAttribute("hidden")).toBe(true);
    expect(layer?.classList.contains("eg-menu-open")).toBe(false);
  });

  it("closes an open goggles menu when the user clicks elsewhere", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(20, 30, 640, 360));
    document.body.append(image);
    const renderer = new ProtectionRenderer();
    protect(renderer, image);
    const layer = renderer.debugLayerFor(image);
    const goggles = layer?.querySelector<HTMLButtonElement>(".eg-goggles");
    const menu = layer?.querySelector<HTMLElement>(".eg-menu");
    goggles?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));

    expect(goggles?.getAttribute("aria-expanded")).toBe("false");
    expect(menu?.hasAttribute("hidden")).toBe(true);
  });

  it("closes an open goggles menu with Escape and returns focus to its trigger", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(20, 30, 640, 360));
    document.body.append(image);
    const renderer = new ProtectionRenderer();
    protect(renderer, image);
    const layer = renderer.debugLayerFor(image);
    const goggles = layer?.querySelector<HTMLButtonElement>(".eg-goggles");
    const menu = layer?.querySelector<HTMLElement>(".eg-menu");
    goggles?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    menu?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(menu?.hasAttribute("hidden")).toBe(true);
    expect(goggles?.getRootNode()).toBeInstanceOf(ShadowRoot);
    expect((goggles?.getRootNode() as ShadowRoot).activeElement).toBe(goggles);
  });

  it("prevents pointer focus without blocking the later click activation", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(20, 30, 640, 360));
    document.body.append(image);
    const renderer = new ProtectionRenderer();
    protect(renderer, image);
    const goggles = renderer.debugLayerFor(image)?.querySelector<HTMLButtonElement>(".eg-goggles");

    const uncancelled = goggles?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(uncancelled).toBe(false);
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
    const uncancelled = renderer.debugLayerFor(image)?.querySelector(".eg-reveal-surface")?.dispatchEvent(activation);

    expect(host?.hasAttribute("data-eclipse-goggles-root")).toBe(true);
    expect(host?.nextElementSibling).toBe(after);
    expect(link.contains(host)).toBe(false);
    expect(uncancelled).toBe(false);
    expect(linkActivation).not.toHaveBeenCalled();
    expect(documentActivation).not.toHaveBeenCalled();
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  it("keeps an opened media menu inside the visible viewport", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(427);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(240);
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(-300, 20, 640, 360));
    document.body.append(image);
    const renderer = new ProtectionRenderer();
    protect(renderer, image);
    const layer = renderer.debugLayerFor(image)!;
    const control = layer.querySelector<HTMLElement>(".eg-goggles-control")!;
    const goggles = layer.querySelector<HTMLButtonElement>(".eg-goggles")!;
    const menu = layer.querySelector<HTMLElement>(".eg-menu")!;
    vi.spyOn(layer, "getBoundingClientRect").mockReturnValue(rect(-300, 20, 640, 360));
    vi.spyOn(control, "getBoundingClientRect").mockReturnValue(rect(6, 30, 30, 30));
    vi.spyOn(goggles, "getBoundingClientRect").mockReturnValue(rect(6, 30, 30, 30));
    vi.spyOn(menu, "getBoundingClientRect").mockReturnValue(rect(0, 0, 204, 176));

    goggles.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(Number.parseFloat(menu.style.left) + control.getBoundingClientRect().left).toBe(8);
    expect(Number.parseFloat(menu.style.top) + control.getBoundingClientRect().top).toBe(8);
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
    expect(host?.hasAttribute("data-eclipse-goggles-root")).toBe(true);
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

    renderer.debugLayerFor(first)?.querySelector(".eg-reveal-surface")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    expect(onFirstReveal).toHaveBeenCalledTimes(1);
    expect(onSecondReveal).not.toHaveBeenCalled();
    expect(firstHandle.isRevealed()).toBe(true);
    expect(first.hasAttribute("data-eclipse-goggles-protected")).toBe(false);
    expect(secondHandle.isRevealed()).toBe(false);
    expect(second.getAttribute("data-eclipse-goggles-protected")).toBe("image");
  });

  it("offers Reveal all from every protected item", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(0, 0, 640, 360));
    document.body.append(image);
    const onRevealAll = vi.fn();
    const renderer = new ProtectionRenderer({
      trustedActivation: (event) => event instanceof MouseEvent && event.type === "click",
    });
    protect(renderer, image, { onRevealAll });

    renderer.debugLayerFor(image)?.querySelector(".eg-reveal-all")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    expect(onRevealAll).toHaveBeenCalledTimes(1);
  });

  it("offers a persistent site allow action from every protected item", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(0, 0, 640, 360));
    document.body.append(image);
    const onAllowSite = vi.fn();
    const renderer = new ProtectionRenderer({
      trustedActivation: (event) => event instanceof MouseEvent && event.type === "click",
    });
    protect(renderer, image, { onAllowSite });

    renderer.debugLayerFor(image)?.querySelector(".eg-allow-site")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    expect(onAllowSite).toHaveBeenCalledTimes(1);
  });

  it("keeps a site control available while the site is allowed", () => {
    const onProtectSite = vi.fn();
    const renderer = new ProtectionRenderer({
      trustedActivation: (event) => event instanceof MouseEvent && event.type === "click",
    });
    const siteRenderer = renderer as ProtectionRenderer & {
      showSiteAllowedControl?: (options: { onProtectSite: () => void }) => void;
      hideSiteAllowedControl?: () => void;
      debugSiteLayer?: () => HTMLElement | null;
    };

    expect(typeof siteRenderer.showSiteAllowedControl).toBe("function");
    if (!siteRenderer.showSiteAllowedControl || !siteRenderer.debugSiteLayer) return;
    siteRenderer.showSiteAllowedControl({ onProtectSite });
    const layer = siteRenderer.debugSiteLayer();
    const goggles = layer?.querySelector<HTMLButtonElement>(".eg-goggles");
    goggles?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(goggles?.getAttribute("aria-label")).toBe("Goggles site options");
    expect(layer?.querySelector(".eg-site-protect")?.textContent).toBe("Frost this site again");
    expect(layer?.querySelector(".eg-menu-brand")?.textContent).toBe("Custom GogglesBlocked subjects and site rules");
    layer?.querySelector(".eg-site-protect")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onProtectSite).toHaveBeenCalledTimes(1);

    siteRenderer.hideSiteAllowedControl?.();
    expect(siteRenderer.debugSiteLayer()).toBeNull();
  });

  it("rejects page-dispatched synthetic pointer activation", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(0, 0, 640, 360));
    document.body.append(image);
    const onReveal = vi.fn();
    const renderer = new ProtectionRenderer();
    const handle = protect(renderer, image, { onReveal });

    renderer.debugLayerFor(image)?.querySelector(".eg-reveal-surface")?.dispatchEvent(
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

    layer?.querySelector(".eg-reveal-surface")?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    expect(onReveal).not.toHaveBeenCalled();
    expect(handle.isRevealed()).toBe(false);

    layer?.querySelector(".eg-reveal-surface")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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
    expect(protectAgain?.querySelector(".eg-reprotect")?.getAttribute("aria-label")).toBe("Protect again");
    protectAgain?.querySelector(".eg-reprotect")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

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

    expect(layer?.style.getPropertyValue("--eg-control-right")).toBe("519px");
    expect(layer?.style.getPropertyValue("--eg-control-top")).toBe("12px");
    expect(layer?.style.getPropertyValue("--eg-caption-left")).toBe("12px");
    expect(layer?.style.getPropertyValue("--eg-caption-bottom")).toBe("12px");

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
    expect(layer?.querySelector(".eg-caption")).toBeNull();
    expect(layer?.querySelector(".eg-info-control")?.hasAttribute("hidden")).toBe(true);
    expect(layer?.querySelector(".eg-reveal-surface")?.getAttribute("aria-label")).toContain("A black audio component");
    expect(layer?.querySelector(".eg-goggles")).not.toBeNull();
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

    const layer = renderer.debugLayerFor(image);
    expect(layer?.querySelector(".eg-caption")).toBeNull();
    expect(layer?.querySelector(".eg-info-control")?.hasAttribute("hidden")).toBe(true);
    expect(layer?.querySelector(".eg-reveal-surface")?.getAttribute("aria-label")).toContain("A black audio component");
    expect(layer?.querySelector(".eg-goggles")).not.toBeNull();
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
