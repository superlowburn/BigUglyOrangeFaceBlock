import { describe, expect, it } from "vitest";
import { classifyElement, type ClassificationEnvironment } from "../../src/media/classifier";
import { isSupportedVideoFrame } from "../../src/media/provider-frames";

function environment(): {
  env: ClassificationEnvironment;
  setBox: (element: Element, width: number, height: number) => void;
  setBackground: (element: Element, backgroundImage: string) => void;
} {
  const boxes = new WeakMap<Element, Pick<DOMRect, "width" | "height">>();
  const backgrounds = new WeakMap<Element, string>();

  return {
    env: {
      box: (element) => boxes.get(element) ?? { width: 0, height: 0 },
      style: (element) => ({
        backgroundImage: backgrounds.get(element) ?? "none",
      }) as CSSStyleDeclaration,
    },
    setBox: (element, width, height) => boxes.set(element, { width, height }),
    setBackground: (element, backgroundImage) => backgrounds.set(element, backgroundImage),
  };
}

function image(attributes: Record<string, string> = {}): HTMLImageElement {
  const element = document.createElement("img");
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function video(): HTMLVideoElement {
  return document.createElement("video");
}

function youtubeIframe(): HTMLIFrameElement {
  const element = document.createElement("iframe");
  element.src = "https://www.youtube.com/embed/abc123";
  return element;
}

describe("classifyElement", () => {
  it("classifies a large image", () => {
    const { env, setBox } = environment();
    const element = image();
    setBox(element, 640, 360);

    expect(classifyElement(element, env)).toMatchObject({ kind: "image" });
  });

  it("ignores a small image without meaningful alt text", () => {
    const { env, setBox } = environment();
    const element = image();
    setBox(element, 32, 32);

    expect(classifyElement(element, env)).toBeNull();
  });

  it("classifies a semantic image at the lower threshold", () => {
    const { env, setBox } = environment();
    const element = image({ alt: "Profile photo" });
    setBox(element, 80, 80);

    expect(classifyElement(element, env)).toMatchObject({ kind: "image" });
  });

  it("classifies a native video when either dimension reaches 96px", () => {
    const { env, setBox } = environment();
    const element = video();
    setBox(element, 640, 80);

    expect(classifyElement(element, env)).toMatchObject({ kind: "native-video" });
  });

  it("classifies a supported YouTube embed", () => {
    const { env, setBox } = environment();
    const element = youtubeIframe();
    setBox(element, 640, 360);

    expect(classifyElement(element, env)).toMatchObject({ kind: "video-iframe" });
  });

  it("ignores a supported video iframe below the 96px video boundary", () => {
    const { env, setBox } = environment();
    const element = youtubeIframe();
    setBox(element, 95, 95);

    expect(classifyElement(element, env)).toBeNull();
  });

  it("recognizes only the supported exact-host video embeds", () => {
    const frame = (source: string) => {
      const element = document.createElement("iframe");
      element.src = source;
      return element;
    };

    expect(isSupportedVideoFrame(frame("https://www.youtube.com/embed/abc123"))).toBe(true);
    expect(isSupportedVideoFrame(frame("https://www.youtube-nocookie.com/embed/abc123"))).toBe(true);
    expect(isSupportedVideoFrame(frame("https://player.vimeo.com/video/123456"))).toBe(true);
    expect(isSupportedVideoFrame(frame("https://www.youtube.com/watch?v=abc123"))).toBe(false);
    expect(isSupportedVideoFrame(frame("https://www.youtube.com.evil.test/embed/abc123"))).toBe(false);
  });

  it("protects a large empty CSS background", () => {
    const { env, setBox, setBackground } = environment();
    const element = document.createElement("div");
    setBox(element, 640, 360);
    setBackground(element, 'url("hero.jpg")');

    expect(classifyElement(element, env)).toMatchObject({ kind: "background-image" });
  });

  it("ignores a CSS background that contains visible text", () => {
    const { env, setBox, setBackground } = environment();
    const element = document.createElement("div");
    element.textContent = "Read the story";
    setBox(element, 640, 360);
    setBackground(element, 'url("hero.jpg")');

    expect(classifyElement(element, env)).toBeNull();
  });

  it("ignores a CSS background that contains a control", () => {
    const { env, setBox, setBackground } = environment();
    const element = document.createElement("div");
    element.append(document.createElement("button"));
    setBox(element, 640, 360);
    setBackground(element, 'url("hero.jpg")');

    expect(classifyElement(element, env)).toBeNull();
  });

  it("applies image thresholds to image inputs", () => {
    const { env, setBox } = environment();
    const small = document.createElement("input");
    small.type = "image";
    const large = document.createElement("input");
    large.type = "image";
    setBox(small, 47, 48);
    setBox(large, 48, 48);

    expect(classifyElement(small, env)).toBeNull();
    expect(classifyElement(large, env)).toMatchObject({ kind: "image" });
  });

  it("classifies the image inside a picture without classifying its wrapper", () => {
    const { env, setBox } = environment();
    const picture = document.createElement("picture");
    const element = image();
    picture.append(element);
    setBox(picture, 640, 360);
    setBox(element, 640, 360);

    expect(classifyElement(picture, env)).toBeNull();
    expect(classifyElement(element, env)).toMatchObject({ element, kind: "image" });
  });
});
