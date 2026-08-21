import { expect, test } from "vitest";
import { classifyElement, type ClassificationEnvironment } from "../../src/media/classifier";

// Regression: Facebook story tiles protected both a poster image and its video.
// Found by live Facebook QA on 2026-08-21.
test("prefers a video over an overlapping poster image in the same linked tile", () => {
  const link = document.createElement("a");
  link.href = "/stories/example";
  const poster = document.createElement("img");
  const video = document.createElement("video");
  link.append(poster, video);
  document.body.append(link);

  const sharedBox = new DOMRect(24, 40, 110, 160);
  const boxes = new Map<Element, DOMRect>([
    [poster, sharedBox],
    [video, sharedBox],
  ]);
  const env: ClassificationEnvironment = {
    box: (element) => boxes.get(element) ?? new DOMRect(),
    style: () => ({ backgroundImage: "none" }) as CSSStyleDeclaration,
  };

  expect(classifyElement(poster, env)).toBeNull();
  expect(classifyElement(video, env)).toMatchObject({ kind: "native-video" });
});

test("prefers a nested player video over its overlapping poster image", () => {
  const player = document.createElement("div");
  const posterWrap = document.createElement("div");
  const poster = document.createElement("img");
  const videoWrap = document.createElement("div");
  const video = document.createElement("video");
  posterWrap.append(poster);
  videoWrap.append(video);
  player.append(posterWrap, videoWrap);
  document.body.append(player);

  const sharedBox = new DOMRect(20, 20, 640, 360);
  const boxes = new Map<Element, DOMRect>([
    [poster, sharedBox],
    [video, sharedBox],
  ]);
  const env: ClassificationEnvironment = {
    box: (element) => boxes.get(element) ?? new DOMRect(),
    style: () => ({ backgroundImage: "none" }) as CSSStyleDeclaration,
  };

  expect(classifyElement(poster, env)).toBeNull();
  expect(classifyElement(video, env)).toMatchObject({ kind: "native-video" });
});

test("prefers a nested player video over an overlapping CSS placeholder", () => {
  const player = document.createElement("div");
  const placeholder = document.createElement("div");
  const videoWrap = document.createElement("div");
  const video = document.createElement("video");
  videoWrap.append(video);
  player.append(placeholder, videoWrap);
  document.body.append(player);

  const sharedBox = new DOMRect(20, 20, 640, 360);
  const boxes = new Map<Element, DOMRect>([
    [placeholder, sharedBox],
    [video, sharedBox],
  ]);
  const env: ClassificationEnvironment = {
    box: (element) => boxes.get(element) ?? new DOMRect(),
    style: (element) => ({
      backgroundImage: element === placeholder ? 'url("video-placeholder.svg")' : "none",
    }) as CSSStyleDeclaration,
  };

  expect(classifyElement(placeholder, env)).toBeNull();
  expect(classifyElement(video, env)).toMatchObject({ kind: "native-video" });
});
