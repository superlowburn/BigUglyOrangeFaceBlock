import type { MediaCandidate, MediaKind } from "../shared/media-types";

const fallbackDescriptions: Record<MediaKind, string> = {
  image: "Image protected by Eclipse Goggles",
  "background-image": "Background image protected by Eclipse Goggles",
  "native-video": "Video protected by Eclipse Goggles",
  "video-iframe": "Embedded video protected by Eclipse Goggles",
};

export function resolveDescription(candidate: MediaCandidate): string {
  const { element, kind } = candidate;
  const description =
    normalize(element.getAttribute("alt")) ||
    normalize(element.getAttribute("aria-label")) ||
    figureCaption(element) ||
    normalize(element.getAttribute("title")) ||
    fallbackDescriptions[kind];

  return Array.from(description).slice(0, 500).join("");
}

function figureCaption(element: HTMLElement): string {
  const figure = element.closest("figure");
  return normalize(figure?.querySelector(":scope > figcaption")?.textContent ?? null);
}

function normalize(value: string | null): string {
  return value?.replace(/\s+/gu, " ").trim() ?? "";
}
