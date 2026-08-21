import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContentController,
  type ContentControllerDependencies,
  type DocumentObserverPort,
} from "../../src/content/content-controller";
import {
  bootstrapContentScript,
  type ContentBootstrapDependencies,
} from "../../src/content/index";
import type { MediaCandidate, MediaKind, SiteMode } from "../../src/shared/media-types";
import type {
  ProtectionHandle,
  ProtectionOptions,
} from "../../src/protection/renderer";
import { ProviderFrameController } from "../../src/media/provider-frames";

class FakeDocumentObserver implements DocumentObserverPort {
  readonly start = vi.fn((callback: (elements: readonly Element[]) => void) => {
    this.callback = callback;
  });
  readonly scan = vi.fn();
  readonly stop = vi.fn();
  private callback: ((elements: readonly Element[]) => void) | null = null;
  private readonly attributeChanges = new WeakSet<Element>();

  emit(elements: readonly Element[], attributes: readonly Element[] = []): void {
    for (const element of attributes) this.attributeChanges.add(element);
    this.callback?.(elements);
    for (const element of attributes) this.attributeChanges.delete(element);
  }

  hadRelevantAttributeChange(element: Element): boolean {
    return this.attributeChanges.has(element);
  }
}

interface RenderedItem {
  candidate: MediaCandidate;
  options: ProtectionOptions;
  handle: ProtectionHandle;
  isRemoved(): boolean;
}

function rendererHarness() {
  const items: RenderedItem[] = [];
  const protect = vi.fn((candidate: MediaCandidate, options: ProtectionOptions) => {
    let revealed = false;
    let removed = false;
    const handle: ProtectionHandle = {
      reveal: vi.fn(() => {
        if (revealed || removed) return;
        revealed = true;
        options.onReveal();
      }),
      reprotect: vi.fn(() => {
        if (!revealed || removed) return;
        revealed = false;
        options.onReprotect();
      }),
      remove: vi.fn(() => {
        removed = true;
      }),
      update: vi.fn(),
      setDescriptionVisible: vi.fn(),
      isRevealed: () => revealed,
    };
    items.push({ candidate, options, handle, isRemoved: () => removed });
    return handle;
  });
  const showSiteAllowedControl = vi.fn();
  const hideSiteAllowedControl = vi.fn();
  return {
    protect,
    items,
    activeFor: (element: HTMLElement) =>
      items.filter((item) => item.candidate.element === element && !item.isRemoved()),
    showSiteAllowedControl,
    hideSiteAllowedControl,
  };
}

function candidate(element: HTMLElement, kind: MediaKind): MediaCandidate {
  return { element, kind };
}

function controllerHarness(
  classifications = new Map<Element, MediaCandidate>(),
  overrides: Partial<ContentControllerDependencies> = {},
) {
  const observer = new FakeDocumentObserver();
  const renderer = rendererHarness();
  const nativeVideo = {
    secure: vi.fn(),
    release: vi.fn(),
    reprotect: vi.fn(),
    restore: vi.fn(),
  };
  const providerFrames = {
    gate: vi.fn(),
    release: vi.fn(),
    regate: vi.fn(),
    restore: vi.fn(),
    trust: vi.fn(),
    forget: vi.fn(),
    dispose: vi.fn(),
  };
  const classify = vi.fn((element: Element) => classifications.get(element) ?? null);
  const resolveDescription = vi.fn((media: MediaCandidate) => `Description for ${media.kind}`);
  const controller = new ContentController({
    document,
    observer,
    renderer,
    nativeVideo,
    providerFrames,
    classify,
    resolveDescription,
    development: false,
    ...overrides,
  });
  return {
    controller,
    observer,
    renderer,
    nativeVideo,
    providerFrames,
    classify,
    resolveDescription,
  };
}

afterEach(() => {
  document.documentElement.replaceChildren(
    document.createElement("head"),
    document.createElement("body"),
  );
});

beforeEach(() => {
  vi.mocked(chrome.storage.local.set).mockClear();
});

describe("ContentController", () => {
  it("observes Trusted mode only to allow dynamic provider frames without protection", () => {
    const image = document.createElement("img");
    const frame = document.createElement("iframe");
    frame.src = "https://www.youtube.com/embed/trusted-dynamic";
    document.body.append(image, frame);
    const harness = controllerHarness(new Map([[image, candidate(image, "image")]]));

    harness.controller.start({ origin: "https://news.example", mode: "trusted" });
    harness.observer.emit([image, frame]);

    expect(harness.observer.start).toHaveBeenCalledTimes(1);
    expect(harness.observer.scan).toHaveBeenCalledWith(document);
    expect(harness.providerFrames.trust).toHaveBeenCalledWith(frame);
    expect(harness.renderer.protect).not.toHaveBeenCalled();
  });

  it("keeps matching subject images protected on a Trusted site", () => {
    const trump = document.createElement("img");
    trump.alt = "Donald Trump at a campaign event";
    const unrelated = document.createElement("img");
    unrelated.alt = "A quiet lake";
    document.body.append(trump, unrelated);
    const harness = controllerHarness(new Map([
      [trump, candidate(trump, "image")],
      [unrelated, candidate(unrelated, "image")],
    ]));

    harness.controller.start({
      origin: "https://news.example",
      mode: "trusted",
      blockedSubjects: { enabled: true, keywords: ["Trump", "Donald Trump"] },
    });
    harness.observer.emit([trump, unrelated]);

    expect(harness.renderer.protect).toHaveBeenCalledTimes(1);
    expect(harness.renderer.protect).toHaveBeenCalledWith(
      candidate(trump, "image"),
      expect.objectContaining({ mode: "trusted" }),
    );
  });

  it("keeps matching subjects protected while a site becomes Trusted", () => {
    const blockedImage = document.createElement("img");
    blockedImage.alt = "Donald Trump at a campaign event";
    const ordinaryImage = document.createElement("img");
    ordinaryImage.alt = "A quiet lake";
    document.body.append(blockedImage, ordinaryImage);
    const blockedSubjects = { enabled: true, keywords: ["Trump"] };
    const harness = controllerHarness(new Map([
      [blockedImage, candidate(blockedImage, "image")],
      [ordinaryImage, candidate(ordinaryImage, "image")],
    ]));

    harness.controller.start({
      origin: "https://news.example",
      mode: "protected",
      blockedSubjects,
    });
    harness.observer.emit([blockedImage, ordinaryImage]);
    harness.controller.applyMode("trusted");

    expect(harness.renderer.activeFor(blockedImage)).toHaveLength(1);
    expect(harness.renderer.activeFor(ordinaryImage)).toHaveLength(0);
  });

  it("keeps matching native and provider videos protected while a site becomes Trusted", () => {
    const nativeVideo = document.createElement("video");
    nativeVideo.poster = "donald-trump-campaign.jpg";
    const providerFrame = document.createElement("iframe");
    providerFrame.title = "Donald Trump campaign video";
    document.body.append(nativeVideo, providerFrame);
    const harness = controllerHarness(new Map<Element, MediaCandidate>([
      [nativeVideo, candidate(nativeVideo, "native-video")],
      [providerFrame, candidate(providerFrame, "video-iframe")],
    ]));

    harness.controller.start({
      origin: "https://news.example",
      mode: "protected",
      blockedSubjects: { enabled: true, keywords: ["Trump"] },
    });
    harness.observer.emit([nativeVideo, providerFrame]);
    harness.controller.applyMode("trusted");

    expect(harness.renderer.activeFor(nativeVideo)).toHaveLength(1);
    expect(harness.renderer.activeFor(providerFrame)).toHaveLength(1);
  });

  it("protects matching native and provider videos discovered on a Trusted site", () => {
    const nativeVideo = document.createElement("video");
    nativeVideo.poster = "donald-trump-campaign.jpg";
    const providerFrame = document.createElement("iframe");
    providerFrame.title = "Donald Trump campaign video";
    const harness = controllerHarness(new Map<Element, MediaCandidate>([
      [nativeVideo, candidate(nativeVideo, "native-video")],
      [providerFrame, candidate(providerFrame, "video-iframe")],
    ]));

    harness.controller.start({
      origin: "https://news.example",
      mode: "trusted",
      blockedSubjects: { enabled: true, keywords: ["Trump"] },
    });
    document.body.append(nativeVideo, providerFrame);
    harness.observer.emit([nativeVideo, providerFrame]);

    expect(harness.renderer.activeFor(nativeVideo)).toHaveLength(1);
    expect(harness.renderer.activeFor(providerFrame)).toHaveLength(1);
  });

  it("matches a dynamic provider frame before trusting can replace its source", () => {
    const providerFrame = document.createElement("iframe");
    providerFrame.src = "https://www.youtube.com/embed/trump-campaign";
    providerFrame.title = "Donald Trump campaign video";
    const providerFrames = {
      gate: vi.fn(),
      release: vi.fn(),
      regate: vi.fn(),
      restore: vi.fn(),
      trust: vi.fn((frame: HTMLIFrameElement) => {
        frame.src = "about:blank";
      }),
      forget: vi.fn(),
      dispose: vi.fn(),
    };
    const classify = vi.fn((element: Element) =>
      element === providerFrame && providerFrame.src.includes("youtube.com")
        ? candidate(providerFrame, "video-iframe")
        : null,
    );
    const harness = controllerHarness(new Map(), { classify, providerFrames });

    harness.controller.start({
      origin: "https://news.example",
      mode: "trusted",
      blockedSubjects: { enabled: true, keywords: ["Trump"] },
    });
    document.body.append(providerFrame);
    harness.observer.emit([providerFrame]);

    expect(harness.providerFrames.trust).not.toHaveBeenCalled();
    expect(harness.renderer.activeFor(providerFrame)).toHaveLength(1);
  });

  it("adds ordinary media when a Trusted site becomes Protected without duplicating subjects", () => {
    const blockedImage = document.createElement("img");
    blockedImage.alt = "Donald Trump at a campaign event";
    const ordinaryImage = document.createElement("img");
    ordinaryImage.alt = "A quiet lake";
    document.body.append(blockedImage, ordinaryImage);
    const harness = controllerHarness(new Map([
      [blockedImage, candidate(blockedImage, "image")],
      [ordinaryImage, candidate(ordinaryImage, "image")],
    ]));

    harness.controller.start({
      origin: "https://news.example",
      mode: "trusted",
      blockedSubjects: { enabled: true, keywords: ["Trump"] },
    });
    harness.observer.emit([blockedImage, ordinaryImage]);
    harness.controller.applyMode("protected");
    harness.observer.emit([blockedImage, ordinaryImage]);

    expect(harness.renderer.activeFor(blockedImage)).toHaveLength(1);
    expect(harness.renderer.activeFor(ordinaryImage)).toHaveLength(1);
  });

  it("reconciles subject preference changes without replacing matching records", () => {
    const blockedImage = document.createElement("img");
    blockedImage.alt = "Donald Trump at a campaign event";
    const ordinaryImage = document.createElement("img");
    ordinaryImage.alt = "A quiet lake";
    document.body.append(blockedImage, ordinaryImage);
    const enabled = { enabled: true, keywords: ["Trump"] };
    const disabled = { enabled: false, keywords: ["Trump"] };
    const harness = controllerHarness(new Map([
      [blockedImage, candidate(blockedImage, "image")],
      [ordinaryImage, candidate(ordinaryImage, "image")],
    ]));

    harness.controller.start({
      origin: "https://news.example",
      mode: "trusted",
      blockedSubjects: disabled,
    });
    harness.observer.emit([blockedImage, ordinaryImage]);
    harness.controller.applyBlockedSubjects(enabled);
    harness.observer.emit([blockedImage, ordinaryImage]);
    const matchingRecord = harness.renderer.activeFor(blockedImage)[0];
    harness.controller.applyBlockedSubjects(enabled);
    harness.observer.emit([blockedImage, ordinaryImage]);

    expect(harness.renderer.activeFor(blockedImage)[0]).toBe(matchingRecord);
    expect(harness.renderer.activeFor(ordinaryImage)).toHaveLength(0);
    harness.controller.applyBlockedSubjects(disabled);
    expect(harness.renderer.activeFor(blockedImage)).toHaveLength(0);
  });

  it("protects matching subject media discovered after a Trusted site starts", () => {
    const blockedImage = document.createElement("img");
    blockedImage.alt = "Donald Trump at a campaign event";
    const harness = controllerHarness(new Map([
      [blockedImage, candidate(blockedImage, "image")],
    ]));

    harness.controller.start({
      origin: "https://news.example",
      mode: "trusted",
      blockedSubjects: { enabled: true, keywords: ["Trump"] },
    });
    document.body.append(blockedImage);
    harness.observer.emit([blockedImage]);
    harness.observer.emit([blockedImage]);

    expect(harness.renderer.activeFor(blockedImage)).toHaveLength(1);
  });

  it("classifies, describes, and protects one discovered candidate", () => {
    const image = document.createElement("img");
    document.body.append(image);
    const media = candidate(image, "image");
    const harness = controllerHarness(new Map([[image, media]]));
    harness.controller.start({ origin: "https://news.example", mode: "protected" });

    harness.observer.emit([image]);

    expect(harness.observer.scan).toHaveBeenCalledWith(document);
    expect(harness.classify).toHaveBeenCalledWith(image);
    expect(harness.resolveDescription).toHaveBeenCalledWith(media);
    expect(harness.renderer.protect).toHaveBeenCalledWith(
      media,
      expect.objectContaining({
        description: "Description for image",
        mode: "protected",
      }),
    );
  });

  it("secures a native video before rendering and release never starts playback", () => {
    const video = document.createElement("video");
    document.body.append(video);
    const play = vi.spyOn(video, "play");
    const harness = controllerHarness(
      new Map([[video, candidate(video, "native-video")]]),
    );
    harness.controller.start({ origin: "https://news.example", mode: "protected" });
    harness.observer.emit([video]);

    expect(harness.nativeVideo.secure.mock.invocationCallOrder[0]).toBeLessThan(
      harness.renderer.protect.mock.invocationCallOrder[0]!,
    );
    harness.renderer.items[0]?.handle.reveal();

    expect(harness.nativeVideo.release).toHaveBeenCalledWith(video);
    expect(play).not.toHaveBeenCalled();
  });

  it("reprotects only the selected strict native video", () => {
    const first = document.createElement("video");
    const second = document.createElement("video");
    document.body.append(first, second);
    const harness = controllerHarness(
      new Map([
        [first, candidate(first, "native-video")],
        [second, candidate(second, "native-video")],
      ]),
    );
    harness.controller.start({ origin: "https://news.example", mode: "strict" });
    harness.observer.emit([first, second]);

    harness.renderer.items[0]?.handle.reveal();
    harness.renderer.items[0]?.handle.reprotect();

    expect(harness.nativeVideo.reprotect).toHaveBeenCalledTimes(1);
    expect(harness.nativeVideo.reprotect).toHaveBeenCalledWith(first);
  });

  it("reveals every currently protected item from any item's Reveal all action", () => {
    const first = document.createElement("img");
    const second = document.createElement("video");
    document.body.append(first, second);
    const harness = controllerHarness(
      new Map<Element, MediaCandidate>([
        [first, candidate(first, "image")],
        [second, candidate(second, "native-video")],
      ]),
    );
    harness.controller.start({ origin: "https://news.example", mode: "protected" });
    harness.observer.emit([first, second]);

    harness.renderer.items[0]?.options.onRevealAll();

    expect(harness.renderer.items.every(({ handle }) => handle.isRevealed())).toBe(true);
    expect(harness.nativeVideo.release).toHaveBeenCalledWith(second);
  });

  it("persists Trusted mode from a protected item's site action", () => {
    const image = document.createElement("img");
    document.body.append(image);
    const setSiteMode = vi.fn();
    const harness = controllerHarness(
      new Map([[image, candidate(image, "image")]]),
      { setSiteMode },
    );
    harness.controller.start({ origin: "https://news.example", mode: "protected" });
    harness.observer.emit([image]);

    const options = harness.renderer.items[0]?.options as ProtectionOptions & {
      onAllowSite?: () => void;
    };
    expect(typeof options.onAllowSite).toBe("function");
    options.onAllowSite?.();

    expect(setSiteMode).toHaveBeenCalledWith("https://news.example", "trusted");
  });

  it("persists the site description choice and applies it to current and future media", () => {
    const first = document.createElement("img");
    const second = document.createElement("img");
    document.body.append(first, second);
    const setDescriptionsVisible = vi.fn();
    const harness = controllerHarness(new Map([
      [first, candidate(first, "image")],
      [second, candidate(second, "image")],
    ]), { setDescriptionsVisible } as Partial<ContentControllerDependencies>);
    harness.controller.start({
      origin: "https://news.example",
      mode: "protected",
      descriptionsVisible: false,
    });
    harness.observer.emit([first]);

    const firstOptions = harness.renderer.items[0]?.options as ProtectionOptions & {
      onToggleDescriptions?: () => void;
      descriptionsVisible?: boolean;
    };
    expect(firstOptions.descriptionsVisible).toBe(false);
    expect(typeof firstOptions.onToggleDescriptions).toBe("function");
    firstOptions.onToggleDescriptions?.();
    expect(setDescriptionsVisible).toHaveBeenCalledWith("https://news.example", true);
    expect(harness.renderer.items[0]?.handle.setDescriptionVisible).toHaveBeenCalledWith(true);

    harness.observer.emit([second]);
    const secondOptions = harness.renderer.items[1]?.options as ProtectionOptions & {
      descriptionsVisible?: boolean;
    };
    expect(secondOptions.descriptionsVisible).toBe(true);
  });

  it("keeps one site control in Trusted mode and restores Protected on request", () => {
    const setSiteMode = vi.fn();
    const harness = controllerHarness(new Map(), { setSiteMode });

    harness.controller.start({ origin: "https://news.example", mode: "trusted" });

    expect(harness.renderer.showSiteAllowedControl).toHaveBeenCalledTimes(1);
    const options = harness.renderer.showSiteAllowedControl.mock.calls[0]?.[0] as
      | { onProtectSite: () => void }
      | undefined;
    options?.onProtectSite();
    expect(setSiteMode).toHaveBeenCalledWith("https://news.example", "protected");

    harness.controller.applyMode("protected");
    expect(harness.renderer.hideSiteAllowedControl).toHaveBeenCalled();
  });

  it("does not render the top-level site control inside child frames", () => {
    const harness = controllerHarness(new Map(), { enableSiteControl: false });

    harness.controller.start({ origin: "https://news.example", mode: "trusted" });

    expect(harness.renderer.showSiteAllowedControl).not.toHaveBeenCalled();
  });

  it("gates a provider before rendering and releases or regates only that frame", () => {
    const frame = document.createElement("iframe");
    frame.src = "https://www.youtube.com/embed/abc?start=10";
    document.body.append(frame);
    const harness = controllerHarness(
      new Map([[frame, candidate(frame, "video-iframe")]]),
    );
    harness.controller.start({ origin: "https://news.example", mode: "strict" });
    harness.observer.emit([frame]);

    expect(harness.providerFrames.gate.mock.invocationCallOrder[0]).toBeLessThan(
      harness.renderer.protect.mock.invocationCallOrder[0]!,
    );
    harness.renderer.items[0]?.handle.reveal();
    harness.renderer.items[0]?.handle.reprotect();

    expect(harness.providerFrames.release).toHaveBeenCalledWith(frame);
    expect(harness.providerFrames.regate).toHaveBeenCalledWith(frame);
  });

  it("re-protects and emits only a sanitized diagnostic when a provider allow rule fails", async () => {
    const frame = document.createElement("iframe");
    frame.src = "https://www.youtube.com/embed/private-video";
    document.body.append(frame);
    const log = vi.fn();
    const providerFrames = {
      gate: vi.fn(),
      release: vi.fn().mockRejectedValue(new Error("secret provider URL failed")),
      regate: vi.fn(),
      restore: vi.fn(),
      trust: vi.fn(),
      forget: vi.fn(),
    };
    const harness = controllerHarness(
      new Map([[frame, candidate(frame, "video-iframe")]]),
      { providerFrames, development: true, logDiagnostic: log },
    );
    harness.controller.start({ origin: "https://news.example", mode: "protected" });
    harness.observer.emit([frame]);

    harness.renderer.items[0]?.handle.reveal();

    await vi.waitFor(() => expect(harness.renderer.items[0]?.handle.isRevealed()).toBe(false));
    expect(providerFrames.regate).toHaveBeenCalledWith(frame);
    expect(log).toHaveBeenCalledWith("IFRAME", "provider allow rule failed");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });

  it("switching to Trusted removes layers and restores native and provider state", () => {
    const image = document.createElement("img");
    const video = document.createElement("video");
    const frame = document.createElement("iframe");
    document.body.append(image, video, frame);
    const harness = controllerHarness(
      new Map<Element, MediaCandidate>([
        [image, candidate(image, "image")],
        [video, candidate(video, "native-video")],
        [frame, candidate(frame, "video-iframe")],
      ]),
    );
    harness.controller.start({ origin: "https://news.example", mode: "protected" });
    harness.observer.emit([image, video, frame]);

    harness.controller.applyMode("trusted");

    expect(harness.observer.stop).not.toHaveBeenCalled();
    expect(harness.observer.scan).toHaveBeenLastCalledWith(document);
    expect(harness.renderer.items.map(({ handle }) => handle.remove)).toSatisfy(
      (removes: Array<ReturnType<typeof vi.fn>>) =>
        removes.every((remove) => remove.mock.calls.length === 1),
    );
    expect(harness.nativeVideo.restore).toHaveBeenCalledWith(video);
    expect(harness.providerFrames.restore).toHaveBeenCalledWith(frame);
  });

  it("forgets provider state without a restore allow rule during page teardown", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const harness = controllerHarness(
      new Map([[frame, candidate(frame, "video-iframe")]]),
    );
    harness.controller.start({ origin: "https://news.example", mode: "protected" });
    harness.observer.emit([frame]);

    harness.controller.stop({ restoreMedia: false });

    expect(harness.providerFrames.forget).toHaveBeenCalledWith(frame);
    expect(harness.providerFrames.restore).not.toHaveBeenCalled();
    expect(harness.providerFrames.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes Trusted provider state during page teardown", () => {
    const frame = document.createElement("iframe");
    frame.src = "https://www.youtube.com/embed/trusted";
    document.body.append(frame);
    const harness = controllerHarness();
    harness.controller.start({ origin: "https://news.example", mode: "trusted" });
    harness.observer.emit([frame]);

    harness.controller.stop({ restoreMedia: false });

    expect(harness.providerFrames.dispose).toHaveBeenCalledTimes(1);
    expect(harness.providerFrames.restore).not.toHaveBeenCalled();
  });

  it("keeps a deliberately revealed subject visible across a legacy Strict transition", () => {
    const image = document.createElement("img");
    image.alt = "Donald Trump at a campaign event";
    document.body.append(image);
    const harness = controllerHarness(
      new Map([[image, candidate(image, "image")]]),
    );
    harness.controller.start({
      origin: "https://news.example",
      mode: "protected",
      blockedSubjects: { enabled: true, keywords: ["Trump"] },
    });
    harness.observer.emit([image]);
    const matchingRecord = harness.renderer.activeFor(image)[0];
    matchingRecord?.handle.reveal();

    harness.controller.applyMode("strict");

    expect(harness.renderer.activeFor(image)[0]).toBe(matchingRecord);
    expect(matchingRecord?.handle.isRevealed()).toBe(true);
    expect(harness.renderer.protect).toHaveBeenCalledTimes(1);
    expect(matchingRecord?.handle.remove).not.toHaveBeenCalled();
  });

  it("updates protected rectangles on resize and rebuilds on relevant attribute changes", () => {
    const image = document.createElement("img");
    document.body.append(image);
    const harness = controllerHarness(
      new Map([[image, candidate(image, "image")]]),
    );
    harness.controller.start({ origin: "https://news.example", mode: "protected" });
    harness.observer.emit([image]);

    harness.observer.emit([image]);
    expect(harness.classify).toHaveBeenCalledTimes(1);
    expect(harness.renderer.items[0]?.handle.update).toHaveBeenCalledTimes(1);

    image.alt = "Changed description";
    harness.observer.emit([image], [image]);
    expect(harness.renderer.items[0]?.handle.remove).toHaveBeenCalledTimes(1);
    expect(harness.classify).toHaveBeenCalledTimes(2);
    expect(harness.renderer.protect).toHaveBeenCalledTimes(2);
  });

  it("isolates malformed candidates and logs no page-derived values", () => {
    const broken = document.createElement("img");
    broken.alt = "private alt";
    broken.src = "https://private.example/secret.png";
    const healthy = document.createElement("img");
    document.body.append(broken, healthy);
    const healthyCandidate = candidate(healthy, "image");
    const log = vi.fn();
    const classify = vi.fn((element: Element) => {
      if (element === broken) {
        throw new Error("bad https://private.example/secret.png <img alt='private alt'>");
      }
      return healthyCandidate;
    });
    const harness = controllerHarness(new Map(), {
      classify,
      development: true,
      logDiagnostic: log,
    });
    harness.controller.start({ origin: "https://news.example", mode: "protected" });

    harness.observer.emit([broken, healthy]);

    expect(harness.renderer.protect).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("IMG", "candidate processing failed");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
    expect(JSON.stringify(log.mock.calls)).not.toContain("https://");
    expect(JSON.stringify(log.mock.calls)).not.toContain("<img");
  });

  it("uses the browser development build flag for default sanitized diagnostics", () => {
    const broken = document.createElement("img");
    broken.alt = "private alt";
    broken.src = "https://private.example/secret.png";
    document.body.append(broken);
    const observer = new FakeDocumentObserver();
    const renderer = rendererHarness();
    const log = vi.fn();
    vi.stubGlobal("process", undefined);

    try {
      const controller = new ContentController({
        document,
        observer,
        renderer,
        classify: () => {
          throw new Error("bad https://private.example/secret.png <img alt='private alt'>");
        },
        logDiagnostic: log,
      });
      controller.start({ origin: "https://news.example", mode: "protected" });

      observer.emit([broken]);

      expect(log).toHaveBeenCalledWith("IMG", "candidate processing failed");
      expect(JSON.stringify(log.mock.calls)).not.toContain("private");
      expect(JSON.stringify(log.mock.calls)).not.toContain("https://");
      expect(JSON.stringify(log.mock.calls)).not.toContain("<img");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("restores native state when attribute reclassification fails and continues the batch", () => {
    const brokenVideo = document.createElement("video");
    const healthyImage = document.createElement("img");
    document.body.append(brokenVideo, healthyImage);
    const videoCandidate = candidate(brokenVideo, "native-video");
    const imageCandidate = candidate(healthyImage, "image");
    let failVideo = false;
    const classify = vi.fn((element: Element) => {
      if (element === brokenVideo && failVideo) throw new Error("bad source");
      if (element === brokenVideo) return videoCandidate;
      return element === healthyImage ? imageCandidate : null;
    });
    const harness = controllerHarness(new Map(), { classify });
    harness.controller.start({ origin: "https://news.example", mode: "protected" });
    harness.observer.emit([brokenVideo]);
    failVideo = true;

    harness.observer.emit([brokenVideo, healthyImage], [brokenVideo]);

    expect(harness.nativeVideo.restore).toHaveBeenCalledWith(brokenVideo);
    expect(harness.renderer.protect).toHaveBeenCalledTimes(2);
    expect(harness.renderer.items[1]?.candidate).toBe(imageCandidate);
  });

  it("regates an externally replaced provider source and reveals that exact new source", async () => {
    const frame = document.createElement("iframe");
    frame.setAttribute("src", "https://www.youtube.com/embed/first?start=10#one");
    document.body.append(frame);
    const media = candidate(frame, "video-iframe");
    const navigate = vi.fn();
    const realProviderFrames = new ProviderFrameController({
      authorize: async (source, disableAutoplay) => {
        const url = new URL(source);
        if (disableAutoplay) url.searchParams.set("autoplay", "0");
        url.searchParams.set("eg_eclipse_goggles", "controller-token");
        return { grantId: 91, source: url.href };
      },
      revoke: vi.fn().mockResolvedValue(undefined),
    }, {
      prepare: vi.fn().mockResolvedValue(undefined),
      navigate,
    });
    const harness = controllerHarness(new Map([[frame, media]]), {
      providerFrames: realProviderFrames,
    });
    harness.controller.start({ origin: "https://news.example", mode: "protected" });
    harness.observer.emit([frame]);
    expect(frame.getAttribute("src")).toBe("https://www.youtube.com/embed/first?start=10#one");

    const replacement = "https://player.vimeo.com/video/456?autoplay=0#two";
    frame.setAttribute("src", replacement);
    harness.observer.emit([frame], [frame]);

    expect(harness.renderer.items[0]?.handle.remove).toHaveBeenCalledTimes(1);
    expect(harness.renderer.protect).toHaveBeenCalledTimes(2);
    expect(frame.getAttribute("src")).toBe(replacement);
    harness.renderer.items[1]?.handle.reveal();
    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalledTimes(1);
      const released = new URL(navigate.mock.calls[0]![1]);
      expect(released.origin + released.pathname).toBe("https://player.vimeo.com/video/456");
      expect(released.searchParams.get("autoplay")).toBe("0");
      expect(released.searchParams.get("eg_eclipse_goggles")).toBe("controller-token");
      expect(released.hash).toBe("#two");
      expect(frame.getAttribute("src")).toBe(replacement);
    });
  });
});

function bootstrapHarness(
  overrides: Partial<ContentBootstrapDependencies> = {},
): {
  dependencies: ContentBootstrapDependencies;
  controller: {
    start: ReturnType<typeof vi.fn>;
    applyMode: ReturnType<typeof vi.fn>;
    applyBlockedSubjects: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
  sendMessage: ReturnType<typeof vi.fn>;
  watchPolicy: ReturnType<typeof vi.fn>;
  addPageHideListener: ReturnType<typeof vi.fn>;
} {
  const controller = {
    start: vi.fn(),
    applyMode: vi.fn(),
    applyBlockedSubjects: vi.fn(),
    stop: vi.fn(),
  };
  const sendMessage = vi.fn().mockResolvedValue({
    origin: "https://top.example",
    mode: "strict" satisfies SiteMode,
  });
  const watchPolicy = vi.fn(() => vi.fn());
  const getDescriptionsVisible = vi.fn().mockResolvedValue(false);
  const getBlockedSubjects = vi.fn().mockResolvedValue({ enabled: false, keywords: [] });
  const watchBlockedSubjects = vi.fn(() => vi.fn());
  const addPageHideListener = vi.fn();
  const dependencies: ContentBootstrapDependencies = {
    href: "https://child.example/story",
    isChildFrame: false,
    parentLocation: () => null,
    createController: () => controller,
    sendMessage,
    getDescriptionsVisible,
    getBlockedSubjects,
    watchPolicy,
    watchBlockedSubjects,
    addPageHideListener,
    ...overrides,
  };
  return { dependencies, controller, sendMessage, watchPolicy, addPageHideListener };
}

describe("content-script bootstrap", () => {
  it("falls back to Protected when policy messaging rejects without persisting or watching", async () => {
    const harness = bootstrapHarness({
      sendMessage: vi.fn().mockRejectedValue(new Error("storage unavailable")),
    });

    await bootstrapContentScript(harness.dependencies);

    expect(harness.controller.start).toHaveBeenCalledWith({
      origin: "https://child.example",
      mode: "protected",
    });
    expect(harness.watchPolicy).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it("falls back to Protected when the policy response is rejected as malformed", async () => {
    const harness = bootstrapHarness({
      sendMessage: vi.fn().mockResolvedValue({ error: "unsupported-page" }),
    });

    await bootstrapContentScript(harness.dependencies);

    expect(harness.controller.start).toHaveBeenCalledWith({
      origin: "https://child.example",
      mode: "protected",
    });
    expect(harness.watchPolicy).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it("starts the returned policy and watches only its exact top origin", async () => {
    const harness = bootstrapHarness();

    await bootstrapContentScript(harness.dependencies);

    expect(harness.sendMessage).toHaveBeenCalledWith({ type: "policy:get-current" });
    expect(harness.controller.start).toHaveBeenCalledWith({
      origin: "https://top.example",
      mode: "strict",
      descriptionsVisible: false,
    });
    expect(harness.watchPolicy).toHaveBeenCalledWith(
      "https://top.example",
      expect.any(Function),
    );
    const listener = harness.watchPolicy.mock.calls[0]?.[1] as
      | ((mode: SiteMode) => void)
      | undefined;
    listener?.("trusted");
    expect(harness.controller.applyMode).toHaveBeenCalledWith("trusted");
  });

  it("starts with the permanent description choice for the top origin", async () => {
    const getDescriptionsVisible = vi.fn().mockResolvedValue(true);
    const harness = bootstrapHarness({ getDescriptionsVisible });

    await bootstrapContentScript(harness.dependencies);

    expect(getDescriptionsVisible).toHaveBeenCalledWith("https://top.example");
    expect(harness.controller.start).toHaveBeenCalledWith({
      origin: "https://top.example",
      mode: "strict",
      descriptionsVisible: true,
    });
  });

  it("starts and live-updates the enabled blocked-subject preset", async () => {
    const initial = { enabled: true, keywords: ["Trump", "Donald Trump"] };
    let listener: ((config: typeof initial) => void) | undefined;
    const harness = bootstrapHarness({
      getBlockedSubjects: vi.fn().mockResolvedValue(initial),
      watchBlockedSubjects: vi.fn((next) => {
        listener = next;
        return vi.fn();
      }),
    });

    await bootstrapContentScript(harness.dependencies);

    expect(harness.controller.start).toHaveBeenCalledWith({
      origin: "https://top.example",
      mode: "strict",
      descriptionsVisible: false,
      blockedSubjects: initial,
    });
    const updated = { enabled: true, keywords: ["President Trump"] };
    listener?.(updated);
    expect(harness.controller.applyBlockedSubjects).toHaveBeenCalledWith(updated);
  });

  it("keeps the site policy when the optional description preference cannot load", async () => {
    const harness = bootstrapHarness({
      getDescriptionsVisible: vi.fn().mockRejectedValue(new Error("storage unavailable")),
    });

    await bootstrapContentScript(harness.dependencies);

    expect(harness.controller.start).toHaveBeenCalledWith({
      origin: "https://top.example",
      mode: "strict",
      descriptionsVisible: false,
    });
    expect(harness.watchPolicy).toHaveBeenCalledWith(
      "https://top.example",
      expect.any(Function),
    );
  });

  it.each([
    "https://www.youtube.com/embed/abc",
    "https://www.youtube-nocookie.com/embed/abc?start=10",
    "https://player.vimeo.com/video/123#t=5s",
  ])("returns before policy lookup in a recognized provider child document: %s", async (href) => {
    const harness = bootstrapHarness({ href, isChildFrame: true });

    await bootstrapContentScript(harness.dependencies);

    expect(harness.sendMessage).not.toHaveBeenCalled();
    expect(harness.controller.start).not.toHaveBeenCalled();
    expect(harness.watchPolicy).not.toHaveBeenCalled();
  });

  it("allows a child about:blank created by a supported parent", async () => {
    const harness = bootstrapHarness({
      href: "about:blank",
      isChildFrame: true,
      parentLocation: () => ({ protocol: "https:", origin: "https://top.example" }),
    });

    await bootstrapContentScript(harness.dependencies);

    expect(harness.sendMessage).toHaveBeenCalledWith({ type: "policy:get-current" });
    expect(harness.controller.start).toHaveBeenCalled();
  });

  it("returns on unsupported top-level schemes", async () => {
    const harness = bootstrapHarness({ href: "file:///tmp/page.html" });

    await bootstrapContentScript(harness.dependencies);

    expect(harness.sendMessage).not.toHaveBeenCalled();
    expect(harness.controller.start).not.toHaveBeenCalled();
  });

  it("stops policy watching and discards provider grants without restoring on pagehide", async () => {
    const stopWatching = vi.fn();
    const harness = bootstrapHarness({ watchPolicy: vi.fn(() => stopWatching) });
    await bootstrapContentScript(harness.dependencies);

    const onPageHide = harness.addPageHideListener.mock.calls[0]?.[0] as
      | (() => void)
      | undefined;
    onPageHide?.();

    expect(stopWatching).toHaveBeenCalledTimes(1);
    expect(harness.controller.stop).toHaveBeenCalledWith({ restoreMedia: false });
  });

  it("does not start after pagehide wins a pending policy lookup", async () => {
    let resolvePolicy!: (value: unknown) => void;
    const pendingPolicy = new Promise<unknown>((resolve) => {
      resolvePolicy = resolve;
    });
    const harness = bootstrapHarness({ sendMessage: vi.fn(() => pendingPolicy) });

    const bootstrap = bootstrapContentScript(harness.dependencies);
    const onPageHide = harness.addPageHideListener.mock.calls[0]?.[0] as
      | (() => void)
      | undefined;
    onPageHide?.();
    resolvePolicy({ origin: "https://top.example", mode: "strict" });
    await bootstrap;

    expect(harness.controller.stop).toHaveBeenCalledWith({ restoreMedia: false });
    expect(harness.controller.start).not.toHaveBeenCalled();
    expect(harness.watchPolicy).not.toHaveBeenCalled();
  });
});
