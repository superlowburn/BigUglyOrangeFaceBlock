import type { MediaCandidate } from "../shared/media-types";
import { isSupportedVideoFrame } from "./provider-frames";

const imageMinimum = 48;
const undecoratedImageMinimum = 96;
const videoMinimum = 96;
const interactiveDescendant =
  "button, a, input, select, textarea, [role=button], [tabindex]";

export interface ClassificationEnvironment {
  box(element: Element): ClassificationBox;
  style(element: Element): CSSStyleDeclaration;
}

type ClassificationBox = Pick<DOMRect, "width" | "height"> &
  Partial<Pick<DOMRect, "top" | "right" | "bottom" | "left">>;

export function classifyElement(
  element: Element,
  env: ClassificationEnvironment,
): MediaCandidate | null {
  if (!(element instanceof HTMLElement)) return null;

  const { width, height } = env.box(element);
  if (width <= 0 || height <= 0) return null;

  if (element instanceof HTMLVideoElement) {
    return hasEitherDimension(width, height, videoMinimum)
      ? { element, kind: "native-video" }
      : null;
  }

  if (isSupportedVideoFrame(element)) {
    return hasEitherDimension(width, height, videoMinimum)
      ? { element, kind: "video-iframe" }
      : null;
  }

  if (element instanceof HTMLInputElement && element.type.toLowerCase() === "image") {
    return hasBothDimensions(width, height, imageMinimum)
      ? { element, kind: "image" }
      : null;
  }

  if (element instanceof HTMLImageElement) {
    if (!hasBothDimensions(width, height, imageMinimum)) return null;

    const alt = element.getAttribute("alt")?.trim() ?? "";
    if (!alt && hasMeaningfulOverlappingCopy(element, env)) return null;
    if (alt || hasBothDimensions(width, height, undecoratedImageMinimum)) {
      return { element, kind: "image" };
    }
    return null;
  }

  if (
    hasBothDimensions(width, height, undecoratedImageMinimum) &&
    env.style(element).backgroundImage !== "none" &&
    !hasRenderedText(element, env) &&
    !element.querySelector(interactiveDescendant)
  ) {
    return { element, kind: "background-image" };
  }

  return null;
}

function hasMeaningfulOverlappingCopy(
  element: HTMLImageElement,
  env: ClassificationEnvironment,
): boolean {
  const source = element.currentSrc || element.src;
  const parent = element.parentElement;
  if (!source || !parent) return false;

  const box = env.box(element);
  for (const sibling of parent.children) {
    if (
      sibling === element ||
      !(sibling instanceof HTMLImageElement) ||
      !sibling.getAttribute("alt")?.trim() ||
      (sibling.currentSrc || sibling.src) !== source
    ) {
      continue;
    }

    if (substantiallyOverlaps(box, env.box(sibling))) return true;
  }
  return false;
}

function substantiallyOverlaps(first: ClassificationBox, second: ClassificationBox): boolean {
  if (
    first.left === undefined ||
    first.top === undefined ||
    first.right === undefined ||
    first.bottom === undefined ||
    second.left === undefined ||
    second.top === undefined ||
    second.right === undefined ||
    second.bottom === undefined
  ) {
    return false;
  }

  const intersectionWidth = Math.max(
    0,
    Math.min(first.right, second.right) - Math.max(first.left, second.left),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top),
  );
  const smallerArea = Math.min(first.width * first.height, second.width * second.height);
  const largerArea = Math.max(first.width * first.height, second.width * second.height);
  if (smallerArea <= 0 || smallerArea / largerArea < 0.5) return false;
  return (intersectionWidth * intersectionHeight) / smallerArea >= 0.8;
}

function hasRenderedText(element: HTMLElement, env: ClassificationEnvironment): boolean {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.textContent?.trim() && node.parentElement && isRendered(node.parentElement, element, env)) {
      return true;
    }
    node = walker.nextNode();
  }
  return false;
}

function isRendered(
  textHost: HTMLElement,
  boundary: HTMLElement,
  env: ClassificationEnvironment,
): boolean {
  let current: HTMLElement | null = textHost;
  while (current) {
    const style = env.style(current);
    if (
      current.hidden ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0"
    ) {
      return false;
    }
    if (current === boundary) break;
    current = current.parentElement;
  }

  const style = env.style(textHost);
  const box = env.box(textHost);
  const clipped =
    style.position === "absolute" &&
    box.width <= 1 &&
    box.height <= 1 &&
    style.overflow === "hidden" &&
    ((style.clip && style.clip !== "auto") ||
      (style.clipPath && style.clipPath !== "none"));
  return !clipped;
}

function hasBothDimensions(width: number, height: number, minimum: number): boolean {
  return width >= minimum && height >= minimum;
}

function hasEitherDimension(width: number, height: number, minimum: number): boolean {
  return width >= minimum || height >= minimum;
}
