import { expect, it, vi } from "vitest";
import { ProtectionRenderer } from "../../src/protection/renderer";

it("does not offer to trust an already Trusted site from a blocked-subject image", () => {
  const image = document.createElement("img");
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 640, 360));
  document.body.append(image);
  const renderer = new ProtectionRenderer();

  renderer.protect({ element: image, kind: "image" }, {
    description: "Donald Trump at a campaign event",
    mode: "trusted",
    onReveal: vi.fn(),
    onRevealAll: vi.fn(),
    onAllowSite: vi.fn(),
    onOpenSettings: vi.fn(),
    onToggleDescriptions: vi.fn(),
    descriptionsVisible: false,
    onReprotect: vi.fn(),
  });

  const layer = renderer.debugLayerFor(image);
  expect(layer?.querySelector(".eg-allow-site")).toBeNull();
  expect(layer?.querySelector(".eg-menu-brand")?.textContent).toBe(
    "Custom GogglesBlocked subjects and site rules",
  );
});
