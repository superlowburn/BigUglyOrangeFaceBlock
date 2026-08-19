import type { MediaCandidate } from "../shared/media-types";
import { isSupportedVideoFrame } from "./provider-frames";

const imageMinimum = 48;
const undecoratedImageMinimum = 96;
const videoMinimum = 96;
const interactiveDescendant =
  "button, a, input, select, textarea, [role=button], [tabindex]";

export interface ClassificationEnvironment {
  box(element: Element): Pick<DOMRect, "width" | "height">;
  style(element: Element): CSSStyleDeclaration;
}

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
    if (alt || hasBothDimensions(width, height, undecoratedImageMinimum)) {
      return { element, kind: "image" };
    }
    return null;
  }

  if (
    hasBothDimensions(width, height, undecoratedImageMinimum) &&
    env.style(element).backgroundImage !== "none" &&
    !element.textContent?.trim() &&
    !element.querySelector(interactiveDescendant)
  ) {
    return { element, kind: "background-image" };
  }

  return null;
}

function hasBothDimensions(width: number, height: number, minimum: number): boolean {
  return width >= minimum && height >= minimum;
}

function hasEitherDimension(width: number, height: number, minimum: number): boolean {
  return width >= minimum || height >= minimum;
}
