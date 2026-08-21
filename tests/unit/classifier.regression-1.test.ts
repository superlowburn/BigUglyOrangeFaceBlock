import { expect, test } from "vitest";
import { classifyElement, type ClassificationEnvironment } from "../../src/media/classifier";

// Regression: Reddit lightbox protected both its decorative backdrop and foreground image.
// Found by live Reddit QA on 2026-08-20.
test("ignores an empty-alt backdrop behind an overlapping described image", () => {
  const backdrop = document.createElement("img");
  backdrop.src = "https://preview.redd.it/photo.jpeg?width=640";
  const foreground = document.createElement("img");
  foreground.src = "https://i.redd.it/photo.jpeg";
  foreground.alt = "The full Reddit image";
  const lightbox = document.createElement("div");
  lightbox.id = "shreddit-media-lightbox";
  const backdropWrap = document.createElement("div");
  const foregroundWrap = document.createElement("zoomable-img");
  backdropWrap.append(backdrop);
  foregroundWrap.append(foreground);
  lightbox.append(backdropWrap, foregroundWrap);
  document.body.append(lightbox);

  const boxes = new Map<Element, DOMRect>([
    [backdrop, new DOMRect(-70, -70, 850, 875)],
    [foreground, new DOMRect(25, 120, 660, 475)],
  ]);
  const env: ClassificationEnvironment = {
    box: (element) => boxes.get(element) ?? new DOMRect(),
    style: () => ({ backgroundImage: "none" }) as CSSStyleDeclaration,
  };

  expect(classifyElement(backdrop, env)).toBeNull();
  expect(classifyElement(foreground, env)).toMatchObject({ kind: "image" });
});
