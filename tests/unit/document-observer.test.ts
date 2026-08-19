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
      characterData: true,
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

  it("batches layout invalidation once when unrelated content is inserted or removed", async () => {
    const frames = frameQueue();
    const observer = new DocumentObserver({
      ...frames.environment,
      createResizeObserver: () => ({ observe: vi.fn(), disconnect: vi.fn() }),
    });
    const onLayoutChange = vi.fn();
    observer.start(vi.fn(), onLayoutChange);

    const spacer = document.createElement("div");
    document.body.prepend(spacer);
    spacer.remove();
    await deliverMutations();

    expect(frames.pending()).toBe(1);
    frames.flush();
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
  });

  it("batches layout invalidation for text insertion and character-data changes", async () => {
    const frames = frameQueue();
    const observer = new DocumentObserver({
      ...frames.environment,
      createResizeObserver: () => ({ observe: vi.fn(), disconnect: vi.fn() }),
    });
    const onLayoutChange = vi.fn();
    observer.start(vi.fn(), onLayoutChange);

    const text = document.createTextNode("short");
    document.body.append(text);
    await deliverMutations();
    text.data = "a much longer line that changes layout";
    await deliverMutations();

    expect(frames.pending()).toBe(1);
    frames.flush();
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
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

  it("tracks resize only for plausible media or background candidates", () => {
    const frames = frameQueue();
    const observeResize = vi.fn();
    const observer = new DocumentObserver({
      ...frames.environment,
      createResizeObserver: () => ({
        observe: observeResize,
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      }),
    });
    const ordinary = Array.from({ length: 50 }, () => document.createElement("div"));
    const image = document.createElement("img");
    const possibleBackground = document.createElement("div");
    possibleBackground.className = "hero-art";
    document.body.append(...ordinary, image, possibleBackground);
    observer.start(vi.fn());

    observer.scan(document.body);

    expect(observeResize).toHaveBeenCalledTimes(2);
    expect(observeResize).toHaveBeenCalledWith(image);
    expect(observeResize).toHaveBeenCalledWith(possibleBackground);
  });

  it("unobserves detached and reclassified resize candidates", async () => {
    const frames = frameQueue();
    const unobserve = vi.fn();
    const observer = new DocumentObserver({
      ...frames.environment,
      createResizeObserver: () => ({
        observe: vi.fn(),
        unobserve,
        disconnect: vi.fn(),
      }),
    });
    const image = document.createElement("img");
    const possibleBackground = document.createElement("div");
    possibleBackground.className = "hero-art";
    document.body.append(image, possibleBackground);
    observer.start(vi.fn());
    observer.scan(document.body);
    frames.flush();

    image.remove();
    possibleBackground.className = "";
    await deliverMutations();
    frames.flush();

    expect(unobserve).toHaveBeenCalledWith(image);
    expect(unobserve).toHaveBeenCalledWith(possibleBackground);
  });

  it("recursively discovers existing and dynamically inserted open shadow roots", async () => {
    const frames = frameQueue();
    const observer = new DocumentObserver({
      ...frames.environment,
      createResizeObserver: () => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }),
    });
    const existingHost = document.createElement("section");
    const existingImage = document.createElement("img");
    existingHost.attachShadow({ mode: "open" }).append(existingImage);
    document.body.append(existingHost);
    const onCandidates = vi.fn();
    observer.start(onCandidates);
    observer.scan(document.body);
    frames.flush();

    expect(onCandidates.mock.calls.flatMap(([elements]) => elements)).toContain(existingImage);

    onCandidates.mockClear();
    const dynamicHost = document.createElement("article");
    const dynamicImage = document.createElement("img");
    dynamicHost.attachShadow({ mode: "open" }).append(dynamicImage);
    document.body.append(dynamicHost);
    await deliverMutations();
    frames.flush();

    expect(onCandidates.mock.calls.flatMap(([elements]) => elements)).toContain(dynamicImage);
  });

  it("discovers an open shadow root attached after its host is already connected", async () => {
    const frames = frameQueue();
    const observer = new DocumentObserver({
      ...frames.environment,
      createResizeObserver: () => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }),
    });
    const onCandidates = vi.fn();
    observer.start(onCandidates);
    const host = document.createElement("div");
    document.body.append(host);
    await deliverMutations();
    frames.flush();
    onCandidates.mockClear();

    const image = document.createElement("img");
    host.attachShadow({ mode: "open" }).append(image);
    host.dispatchEvent(new CustomEvent("eclipse-goggles-open-shadow", { bubbles: true }));
    frames.flush();

    expect(onCandidates.mock.calls.flatMap(([elements]) => elements)).toContain(image);
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
