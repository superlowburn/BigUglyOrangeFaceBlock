import { expect, it, vi } from "vitest";
import { ProtectionRenderer } from "../../src/protection/renderer";

it("labels a frosted subject without offering site controls", () => {
  const image = document.createElement("img");
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 640, 360));
  document.body.append(image);
  const renderer = new ProtectionRenderer();

  renderer.protect({ element: image, kind: "image" }, {
    description: "Donald Trump at a campaign event",
    onReveal: vi.fn(),
    onToggleDescriptions: vi.fn(),
    descriptionsVisible: false,
    onReprotect: vi.fn(),
  });

  const layer = renderer.debugLayerFor(image);
  expect(layer?.querySelector(".buof-site-control")).toBeNull();
  expect(layer?.querySelector(".buof-reveal-surface")?.getAttribute("aria-label")).toBe(
    "Reveal blocked subject: Donald Trump at a campaign event",
  );
});
