import { chromium, expect, test } from "@playwright/test";
import { resolve } from "node:path";

const extensionPath = resolve("dist");

// Regression: Reddit lightboxes received duplicate frost, info, and Goggles controls.
// Found by live Reddit QA on 2026-08-20.
test("gives an overlapping Reddit lightbox stack one visible control set", async () => {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    viewport: { width: 711, height: 730 },
    args: [
      "--window-size=711,730",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    await (context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker"));
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto("http://127.0.0.1:4173/reddit-lightbox.html");

    await expect(page.locator("[data-eclipse-goggles-protected]")).toHaveCount(1);
    await expect(page.locator(".foreground")).toHaveAttribute(
      "data-eclipse-goggles-protected",
      "image",
    );
    await expect(page.locator(".backdrop")).not.toHaveAttribute(
      "data-eclipse-goggles-protected",
      "image",
    );
    await expect(page.getByRole("button", { name: "Goggles reveal options" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Show image description" })).toHaveCount(1);

    await page.getByRole("button", { name: "Goggles reveal options" }).click();
    const menu = page.locator("[data-eclipse-goggles-root] .eg-menu");
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(8);
    expect(box!.x + box!.width).toBeLessThanOrEqual(703);
    expect(box!.y).toBeGreaterThanOrEqual(8);
    expect(box!.y + box!.height).toBeLessThanOrEqual(722);
  } finally {
    await context.close();
  }
});
