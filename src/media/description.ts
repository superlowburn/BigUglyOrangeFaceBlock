import type { MediaCandidate, MediaKind } from "../shared/media-types";

const fallbackDescriptions: Record<MediaKind, string> = {
  image: "Image protected by Goggles",
  "background-image": "Background image protected by Goggles",
  "native-video": "Video protected by Goggles",
  "video-iframe": "Embedded video protected by Goggles",
};

export function resolveDescription(candidate: MediaCandidate): string {
  const { element, kind } = candidate;
  const description =
    normalize(element.getAttribute("alt")) ||
    labelledBy(element) ||
    normalize(element.getAttribute("aria-label")) ||
    figureCaption(element) ||
    normalize(element.getAttribute("title")) ||
    fallbackDescriptions[kind];

  return Array.from(description).slice(0, 500).join("").trim();
}

function labelledBy(element: HTMLElement): string {
  const ids = element.getAttribute("aria-labelledby")?.split(/\s+/u).filter(Boolean) ?? [];
  const root = element.getRootNode();
  return normalize(ids
    .map((id) => {
      if (root instanceof Document || root instanceof ShadowRoot) {
        return root.getElementById(id)?.textContent ?? "";
      }
      return "";
    })
    .filter(Boolean)
    .join(" "));
}

function figureCaption(element: HTMLElement): string {
  const figure = element.closest("figure");
  return normalize(figure?.querySelector(":scope > figcaption")?.textContent ?? null);
}

function normalize(value: string | null): string {
  return value?.replace(/\s+/gu, " ").trim() ?? "";
}
