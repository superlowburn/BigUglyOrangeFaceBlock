import { describe, expect, it } from "vitest";
import {
  classifyElement,
  type ClassificationEnvironment,
} from "../../src/media/classifier";

interface TestRect {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function environment(): {
  env: ClassificationEnvironment;
  setRect: (element: Element, rect: TestRect) => void;
} {
  const boxes = new WeakMap<Element, TestRect>();
  return {
    env: {
      box: (element) => boxes.get(element) ?? { width: 0, height: 0 },
      style: () => ({ backgroundImage: "none" }) as CSSStyleDeclaration,
    },
    setRect: (element, rect) => boxes.set(element, rect),
  };
}

function rect(left: number, top: number, width: number, height: number): TestRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

describe("stacked image classification", () => {
  it("skips an empty-alt backdrop that substantially overlaps a meaningful sibling", () => {
    const { env, setRect } = environment();
    const container = document.createElement("div");
    const backdrop = document.createElement("img");
    const foreground = document.createElement("img");
    backdrop.src = "/jazz-collage.png";
    foreground.src = "/jazz-collage.png";
    foreground.alt = "A collage of jazz album covers";
    container.append(backdrop, foreground);
    setRect(backdrop, rect(0, 0, 900, 500));
    setRect(foreground, rect(75, 40, 750, 420));

    expect(classifyElement(backdrop, env)).toBeNull();
    expect(classifyElement(foreground, env)).toMatchObject({
      element: foreground,
      kind: "image",
    });
  });

  it("still protects a lone large image whose alt text is missing", () => {
    const { env, setRect } = environment();
    const image = document.createElement("img");
    setRect(image, rect(0, 0, 640, 360));

    expect(classifyElement(image, env)).toMatchObject({ element: image, kind: "image" });
  });

  it("keeps a non-overlapping empty-alt sibling image protected", () => {
    const { env, setRect } = environment();
    const container = document.createElement("div");
    const first = document.createElement("img");
    const second = document.createElement("img");
    first.src = "/reused-photo.png";
    second.src = "/reused-photo.png";
    second.alt = "A second photo";
    container.append(first, second);
    setRect(first, rect(0, 0, 300, 200));
    setRect(second, rect(320, 0, 300, 200));

    expect(classifyElement(first, env)).toMatchObject({ element: first, kind: "image" });
    expect(classifyElement(second, env)).toMatchObject({ element: second, kind: "image" });
  });

  it("keeps an overlapping empty-alt image when it has different content", () => {
    const { env, setRect } = environment();
    const container = document.createElement("div");
    const first = document.createElement("img");
    const second = document.createElement("img");
    first.src = "/first-photo.png";
    second.src = "/second-photo.png";
    second.alt = "A second photo";
    container.append(first, second);
    setRect(first, rect(0, 0, 640, 360));
    setRect(second, rect(0, 0, 640, 360));

    expect(classifyElement(first, env)).toMatchObject({ element: first, kind: "image" });
    expect(classifyElement(second, env)).toMatchObject({ element: second, kind: "image" });
  });
});
