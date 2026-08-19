import { describe, expect, it } from "vitest";
import { resolveDescription } from "../../src/media/description";
import type { MediaCandidate, MediaKind } from "../../src/shared/media-types";

function candidate(element: HTMLElement, kind: MediaKind = "image"): MediaCandidate {
  return { element, kind };
}

describe("resolveDescription", () => {
  it("prefers useful alt text over aria-label", () => {
    const element = document.createElement("img");
    element.alt = "  Mountain\n sunrise  ";
    element.setAttribute("aria-label", "A labelled image");

    expect(resolveDescription(candidate(element))).toBe("Mountain sunrise");
  });

  it("resolves normalized aria-labelledby text before aria-label and caps it", () => {
    const first = document.createElement("span");
    first.id = "first-label";
    first.textContent = `  ${"😀".repeat(498)}  `;
    const second = document.createElement("span");
    second.id = "second-label";
    second.textContent = "  final label  ";
    const element = document.createElement("img");
    element.setAttribute("aria-labelledby", "first-label missing second-label");
    element.setAttribute("aria-label", "Fallback label");
    document.body.append(first, second, element);

    const description = resolveDescription(candidate(element));

    expect(Array.from(description)).toHaveLength(500);
    expect(description.startsWith("😀".repeat(498))).toBe(true);
    expect(description.endsWith("f")).toBe(true);
    expect(description).not.toContain("Fallback label");
  });

  it("resolves aria-labelledby within the element's open shadow root", () => {
    const host = document.createElement("section");
    const shadow = host.attachShadow({ mode: "open" });
    const label = document.createElement("span");
    label.id = "shadow-label";
    label.textContent = "  Shadow moonrise  ";
    const element = document.createElement("img");
    element.setAttribute("aria-labelledby", "shadow-label");
    element.setAttribute("aria-label", "Wrong document fallback");
    shadow.append(label, element);
    document.body.append(host);

    expect(resolveDescription(candidate(element))).toBe("Shadow moonrise");
  });

  it("uses a closest figure caption when alt text is missing", () => {
    const figure = document.createElement("figure");
    const element = document.createElement("img");
    const caption = document.createElement("figcaption");
    caption.textContent = "  A lighthouse\n at dusk  ";
    figure.append(element, caption);

    expect(resolveDescription(candidate(element))).toBe("A lighthouse at dusk");
  });

  it("uses an iframe title to describe a video", () => {
    const element = document.createElement("iframe");
    element.title = "  Product\t demo ";

    expect(resolveDescription(candidate(element, "video-iframe"))).toBe("Product demo");
  });

  it("uses exact kind-specific fallback copy", () => {
    expect(resolveDescription(candidate(document.createElement("img"), "image"))).toBe(
      "Image protected by Eclipse Goggles",
    );
    expect(resolveDescription(candidate(document.createElement("div"), "background-image"))).toBe(
      "Background image protected by Eclipse Goggles",
    );
    expect(resolveDescription(candidate(document.createElement("video"), "native-video"))).toBe(
      "Video protected by Eclipse Goggles",
    );
    expect(resolveDescription(candidate(document.createElement("iframe"), "video-iframe"))).toBe(
      "Embedded video protected by Eclipse Goggles",
    );
  });

  it("returns hostile alt text literally without creating DOM", () => {
    const element = document.createElement("img");
    element.alt = "<img src=x onerror=alert(1)>";

    expect(resolveDescription(candidate(element))).toBe("<img src=x onerror=alert(1)>");
    expect(element.querySelector("img")).toBeNull();
  });

  it("limits normalized display copy to 500 Unicode code points", () => {
    const element = document.createElement("img");
    element.alt = "😀".repeat(501);

    expect(Array.from(resolveDescription(candidate(element)))).toHaveLength(500);
  });
});
