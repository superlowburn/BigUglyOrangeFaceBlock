import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DocumentObserver,
  type DocumentObserverEnvironment,
  type ResizeObserverLike,
} from "../../src/content/document-observer";

function frameQueue(): {
  environment: Pick<
    DocumentObserverEnvironment,
    "requestAnimationFrame" | "cancelAnimationFrame"
  >;
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

async function deliverMutations(): Promise<void> {
  await Promise.resolve();
}

afterEach(() => {
  document.documentElement.replaceChildren(
    document.createElement("head"),
    document.createElement("body"),
  );
});

describe("DocumentObserver", () => {
  it("observes the document subtree with only the exact relevant attributes", () => {
    const observeMutation = vi.fn();
    const observer = new DocumentObserver({
      createMutationObserver: () => ({
        observe: observeMutation,
        disconnect: vi.fn(),
      }),
      createResizeObserver: () => ({ observe: vi.fn(), disconnect: vi.fn() }),
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
    });

    observer.start(vi.fn());

    expect(observeMutation).toHaveBeenCalledWith(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "src",
        "srcset",
        "poster",
        "style",
        "class",
        "alt",
        "title",
        "aria-label",
      ],
    });
  });

  it("batches ten synchronously appended images into one deduplicated frame", async () => {
    const frames = frameQueue();
    const observeResize = vi.fn();
    const observer = new DocumentObserver({
      ...frames.environment,
      createResizeObserver: () => ({ observe: observeResize, disconnect: vi.fn() }),
    });
    const onCandidates = vi.fn();
    observer.start(onCandidates);

    const images = Array.from({ length: 10 }, () => document.createElement("img"));
    document.body.append(...images);
    await deliverMutations();

    expect(frames.pending()).toBe(1);
    expect(onCandidates).not.toHaveBeenCalled();
    frames.flush();
    expect(onCandidates).toHaveBeenCalledTimes(1);
    expect(onCandidates).toHaveBeenCalledWith(images);
    expect(observeResize).toHaveBeenCalledTimes(10);
  });

  it("reconsiders exact relevant attribute changes and identifies them as mutations", async () => {
    const frames = frameQueue();
    const observer = new DocumentObserver({
      ...frames.environment,
      createResizeObserver: () => ({ observe: vi.fn(), disconnect: vi.fn() }),
    });
    const source = document.createElement("img");
    const sourceSet = document.createElement("img");
    const poster = document.createElement("video");
    const inlineStyle = document.createElement("div");
    const classStyled = document.createElement("div");
    document.body.append(source, sourceSet, poster, inlineStyle, classStyled);
    const onCandidates = vi.fn((elements: readonly Element[]) => {
      expect(elements.every((element) => observer.hadRelevantAttributeChange(element))).toBe(true);
    });
    observer.start(onCandidates);

    source.setAttribute("src", "/changed.png");
    sourceSet.setAttribute("srcset", "/changed-2x.png 2x");
    poster.setAttribute("poster", "/changed-poster.png");
    inlineStyle.setAttribute("style", "background-image: url('/changed-bg.png')");
    classStyled.className = "changed-background";
    await deliverMutations();
    frames.flush();

    expect(onCandidates).toHaveBeenCalledTimes(1);
    expect(onCandidates).toHaveBeenCalledWith([
      source,
      sourceSet,
      poster,
      inlineStyle,
      classStyled,
    ]);
  });

  it("scans ordinary HTML elements so externally styled backgrounds are candidates", () => {
    const frames = frameQueue();
    const observer = new DocumentObserver({
      ...frames.environment,
      createResizeObserver: () => ({ observe: vi.fn(), disconnect: vi.fn() }),
    });
    const externallyStyled = document.createElement("div");
    externallyStyled.className = "hero-art";
    document.body.append(externallyStyled);
    const onCandidates = vi.fn();
    observer.start(onCandidates);

    observer.scan(document.body);
    frames.flush();

    expect(onCandidates).toHaveBeenCalledWith([document.body, externallyStyled]);
  });

  it("reconsiders tracked elements after resize without marking an attribute change", () => {
    const frames = frameQueue();
    let resizeCallback: ResizeObserverCallback = () => undefined;
    const resizeObserver: ResizeObserverLike = {
      observe: vi.fn(),
      disconnect: vi.fn(),
    };
    const observer = new DocumentObserver({
      ...frames.environment,
      createResizeObserver: (callback) => {
        resizeCallback = callback;
        return resizeObserver;
      },
    });
    const image = document.createElement("img");
    document.body.append(image);
    const onCandidates = vi.fn();
    observer.start(onCandidates);
    observer.scan(image);
    frames.flush();
    onCandidates.mockClear();

    resizeCallback(
      [{ target: image } as unknown as ResizeObserverEntry],
      resizeObserver as ResizeObserver,
    );
    frames.flush();

    expect(onCandidates).toHaveBeenCalledWith([image]);
    expect(observer.hadRelevantAttributeChange(image)).toBe(false);
  });

  it("disconnects mutation and resize observation and cancels queued work on stop", () => {
    const frames = frameQueue();
    const disconnectMutation = vi.fn();
    const disconnectResize = vi.fn();
    const observer = new DocumentObserver({
      ...frames.environment,
      createMutationObserver: () => ({
        observe: vi.fn(),
        disconnect: disconnectMutation,
      }),
      createResizeObserver: () => ({ observe: vi.fn(), disconnect: disconnectResize }),
    });
    const onCandidates = vi.fn();
    observer.start(onCandidates);
    observer.scan(document.body);
    expect(frames.pending()).toBe(1);

    observer.stop();
    frames.flush();

    expect(disconnectMutation).toHaveBeenCalledTimes(1);
    expect(disconnectResize).toHaveBeenCalledTimes(1);
    expect(onCandidates).not.toHaveBeenCalled();
  });
});
