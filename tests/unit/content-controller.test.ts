import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ContentController,
  type ContentControllerDependencies,
  type DocumentObserverPort,
} from "../../src/content/content-controller";
import {
  bootstrapContentScript,
  type ContentBootstrapDependencies,
} from "../../src/content/index";
import type { MediaCandidate, MediaKind, ProtectionContext } from "../../src/shared/media-types";
import type { ProtectionHandle, ProtectionOptions } from "../../src/protection/renderer";

class FakeObserver implements DocumentObserverPort {
  readonly scan = vi.fn();
  readonly stop = vi.fn();
  readonly sourceChangeCount = vi.fn((_element: Element) => 0);
  private callback: ((elements: readonly Element[]) => void) | null = null;
  start(callback: (elements: readonly Element[]) => void): void { this.callback = callback; }
  emit(elements: readonly Element[]): void { this.callback?.(elements); }
}

function candidate(element: HTMLElement, kind: MediaKind): MediaCandidate {
  return { element, kind };
}

function controllerHarness(
  classifications = new Map<Element, MediaCandidate>(),
  overrides: Partial<ContentControllerDependencies> = {},
) {
  const observer = new FakeObserver();
  const items: Array<{
    candidate: MediaCandidate;
    options: ProtectionOptions;
    handle: ProtectionHandle;
    removed: () => boolean;
  }> = [];
  const renderer = {
    protect: vi.fn((media: MediaCandidate, options: ProtectionOptions): ProtectionHandle => {
      let revealed = false;
      let removed = false;
      const handle: ProtectionHandle = {
        reveal: () => { if (!revealed && !removed) { revealed = true; options.onReveal(); } },
        reprotect: () => { if (revealed && !removed) { revealed = false; options.onReprotect(); } },
        remove: () => { removed = true; },
        update: vi.fn(),
        setDescriptionVisible: vi.fn(),
        isRevealed: () => revealed,
      };
      items.push({ candidate: media, options, handle, removed: () => removed });
      return handle;
    }),
  };
  const nativeVideo = {
    secure: vi.fn(), release: vi.fn(), reprotect: vi.fn(), restore: vi.fn(),
  };
  const providerFrames = {
    gate: vi.fn(), release: vi.fn(), regate: vi.fn(), restore: vi.fn(), trust: vi.fn(),
    forget: vi.fn(), dispose: vi.fn(),
  };
  const controller = new ContentController({
    document,
    observer,
    renderer,
    nativeVideo,
    providerFrames,
    classify: (element) => classifications.get(element) ?? null,
    resolveDescription: (media) => `Description for ${media.kind}`,
    development: false,
    ...overrides,
  });
  return {
    controller, observer, renderer, nativeVideo, providerFrames, items,
    activeFor: (element: HTMLElement) => items.filter(
      (item) => item.candidate.element === element && !item.removed(),
    ),
  };
}

afterEach(() => {
  document.documentElement.replaceChildren(document.createElement("head"), document.createElement("body"));
});

describe("ContentController", () => {
  it("protects only matching subjects and leaves ordinary media visible", () => {
    const trump = document.createElement("img");
    trump.alt = "Donald Trump at a campaign event";
    const lake = document.createElement("img");
    lake.alt = "A quiet lake";
    document.body.append(trump, lake);
    const harness = controllerHarness(new Map([
      [trump, candidate(trump, "image")],
      [lake, candidate(lake, "image")],
    ]));

    harness.controller.start({
      origin: "https://news.example",
      blockedSubjects: { enabled: true, keywords: ["Trump"] },
    });
    harness.observer.emit([trump, lake]);

    expect(harness.activeFor(trump)).toHaveLength(1);
    expect(harness.activeFor(lake)).toHaveLength(0);
  });

  it("authorizes an unmatched provider frame instead of frosting it", () => {
    const frame = document.createElement("iframe");
    frame.src = "https://www.youtube.com/embed/weather";
    frame.title = "Weather report";
    document.body.append(frame);
    const harness = controllerHarness(new Map([[frame, candidate(frame, "video-iframe")]]));

    harness.controller.start({
      origin: "https://news.example",
      blockedSubjects: { enabled: true, keywords: ["Trump"] },
    });
    harness.observer.emit([frame]);

    expect(harness.providerFrames.trust).toHaveBeenCalledWith(frame, 0);
    expect(harness.renderer.protect).not.toHaveBeenCalled();
  });

  it("passes source mutation counts when re-authorizing an unmatched provider", () => {
    const frame = document.createElement("iframe");
    frame.src = "https://www.youtube.com/embed/weather";
    frame.title = "Weather report";
    document.body.append(frame);
    const harness = controllerHarness(new Map([[frame, candidate(frame, "video-iframe")]]));
    harness.observer.sourceChangeCount.mockReturnValue(2);

    harness.controller.start({
      origin: "https://news.example",
      blockedSubjects: { enabled: true, keywords: ["Trump"] },
    });
    harness.observer.emit([frame]);

    expect(harness.providerFrames.trust).toHaveBeenCalledWith(frame, 2);
  });

  it("gates a matching provider before rendering and permits one reveal", () => {
    const frame = document.createElement("iframe");
    frame.src = "https://www.youtube.com/embed/politics";
    frame.title = "Donald Trump campaign video";
    document.body.append(frame);
    const harness = controllerHarness(new Map([[frame, candidate(frame, "video-iframe")]]));

    harness.controller.start({
      origin: "https://news.example",
      blockedSubjects: { enabled: true, keywords: ["Trump"] },
    });
    harness.observer.emit([frame]);

    expect(harness.providerFrames.gate.mock.invocationCallOrder[0]).toBeLessThan(
      harness.renderer.protect.mock.invocationCallOrder[0]!,
    );
    harness.items[0]?.handle.reveal();
    harness.items[0]?.handle.reprotect();
    expect(harness.providerFrames.release).toHaveBeenCalledWith(frame);
    expect(harness.providerFrames.regate).toHaveBeenCalledWith(frame);
  });

  it("applies subject changes live without duplicate layers", () => {
    const image = document.createElement("img");
    image.alt = "Donald Trump at a campaign event";
    document.body.append(image);
    const harness = controllerHarness(new Map([[image, candidate(image, "image")]]));
    harness.controller.start({
      origin: "https://news.example",
      blockedSubjects: { enabled: false, keywords: ["Trump"] },
    });
    harness.observer.emit([image]);

    harness.controller.applyBlockedSubjects({ enabled: true, keywords: ["Trump"] });
    harness.observer.emit([image]);
    harness.observer.emit([image]);
    expect(harness.activeFor(image)).toHaveLength(1);

    harness.controller.applyBlockedSubjects({ enabled: false, keywords: ["Trump"] });
    expect(harness.activeFor(image)).toHaveLength(0);
  });

  it("persists description visibility for current and future matches", () => {
    const first = document.createElement("img");
    first.alt = "Donald Trump";
    const second = document.createElement("img");
    second.alt = "President Trump";
    document.body.append(first, second);
    const setDescriptionsVisible = vi.fn();
    const harness = controllerHarness(new Map([
      [first, candidate(first, "image")],
      [second, candidate(second, "image")],
    ]), { setDescriptionsVisible });
    harness.controller.start({
      origin: "https://news.example",
      descriptionsVisible: false,
      blockedSubjects: { enabled: true, keywords: ["Trump"] },
    });
    harness.observer.emit([first]);

    harness.items[0]?.options.onToggleDescriptions();
    expect(setDescriptionsVisible).toHaveBeenCalledWith("https://news.example", true);
    harness.observer.emit([second]);
    expect(harness.items[1]?.options.descriptionsVisible).toBe(true);
  });

  it("forgets gated provider state without restoring it during teardown", () => {
    const frame = document.createElement("iframe");
    frame.src = "https://www.youtube.com/embed/politics";
    frame.title = "Donald Trump";
    document.body.append(frame);
    const harness = controllerHarness(new Map([[frame, candidate(frame, "video-iframe")]]));
    harness.controller.start({
      origin: "https://news.example",
      blockedSubjects: { enabled: true, keywords: ["Trump"] },
    });
    harness.observer.emit([frame]);

    harness.controller.stop({ restoreMedia: false });

    expect(harness.providerFrames.forget).toHaveBeenCalledWith(frame);
    expect(harness.providerFrames.restore).not.toHaveBeenCalled();
    expect(harness.providerFrames.dispose).toHaveBeenCalledTimes(1);
  });
});

function bootstrapDependencies(
  overrides: Partial<ContentBootstrapDependencies> = {},
): ContentBootstrapDependencies & {
  controller: {
    start: ReturnType<typeof vi.fn>;
    applyBlockedSubjects: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
} {
  const controller = {
    start: vi.fn<(context: ProtectionContext) => void>(),
    applyBlockedSubjects: vi.fn(),
    stop: vi.fn(),
  };
  return {
    controller,
    href: "https://news.example/story",
    isChildFrame: false,
    parentLocation: () => null,
    createController: () => controller,
    getDescriptionsVisible: vi.fn().mockResolvedValue(false),
    getBlockedSubjects: vi.fn().mockResolvedValue({ enabled: true, keywords: ["Trump"] }),
    watchBlockedSubjects: vi.fn(() => () => undefined),
    addPageHideListener: vi.fn(),
    ...overrides,
  };
}

describe("bootstrapContentScript", () => {
  it("starts with local subject and description preferences", async () => {
    const deps = bootstrapDependencies({
      getDescriptionsVisible: vi.fn().mockResolvedValue(true),
    });

    await bootstrapContentScript(deps);

    expect(deps.controller.start).toHaveBeenCalledWith({
      origin: "https://news.example",
      descriptionsVisible: true,
      blockedSubjects: { enabled: true, keywords: ["Trump"] },
    });
  });

  it("applies storage changes that arrive after startup", async () => {
    let listener!: (config: { enabled: boolean; keywords: string[] }) => void;
    const deps = bootstrapDependencies({
      watchBlockedSubjects: vi.fn((next) => { listener = next; return () => undefined; }),
    });
    await bootstrapContentScript(deps);

    listener({ enabled: false, keywords: ["Trump"] });

    expect(deps.controller.applyBlockedSubjects).toHaveBeenCalledWith({
      enabled: false,
      keywords: ["Trump"],
    });
  });

  it("fails open when subject storage cannot be read", async () => {
    const deps = bootstrapDependencies({
      getBlockedSubjects: vi.fn().mockRejectedValue(new Error("storage unavailable")),
    });

    await bootstrapContentScript(deps);

    expect(deps.controller.start).toHaveBeenCalledWith(expect.objectContaining({
      blockedSubjects: { enabled: false, keywords: [] },
    }));
  });

  it("does not run inside a supported provider document", async () => {
    const deps = bootstrapDependencies({
      href: "https://www.youtube.com/embed/example",
      isChildFrame: true,
    });

    await bootstrapContentScript(deps);

    expect(deps.controller.start).not.toHaveBeenCalled();
  });
});
