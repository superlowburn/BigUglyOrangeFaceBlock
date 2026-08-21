import { chromium, expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const extensionPath = resolve("dist");

async function visibleAsideFrostsOverChild(page: Page): Promise<number> {
  const frameBox = await page.locator('iframe[title="Floating video"]').boundingBox();
  expect(frameBox).not.toBeNull();
  const layers = page.locator("aside [data-eclipse-goggles-root] .eg-layer.eg-frost");
  let overlaps = 0;
  for (let index = 0; index < await layers.count(); index += 1) {
    const layer = layers.nth(index);
    if (!await layer.isVisible()) continue;
    const box = await layer.boundingBox();
    if (
      box &&
      box.x < frameBox!.x + frameBox!.width &&
      box.x + box.width > frameBox!.x &&
      box.y < frameBox!.y + frameBox!.height &&
      box.y + box.height > frameBox!.y
    ) overlaps += 1;
  }
  return overlaps;
}

// Regression: full-viewport parent-frame popover hosts intercepted a protected
// child-frame video on Fox News. Found by live QA on 2026-08-21.
test("keeps child-frame video controls clickable below many parent media roots", async () => {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    viewport: { width: 427, height: 240 },
    args: [
      "--window-position=-10000,-10000",
      "--window-size=427,240",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    await (context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker"));
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto("http://127.0.0.1:4173/cross-frame-popover-stack.html");
    await expect(page.locator('aside [data-eclipse-goggles-protected="image"]')).toHaveCount(20);
    await expect.poll(() => visibleAsideFrostsOverChild(page)).toBe(0);

    const child = page.frameLocator('iframe[title="Floating video"]');
    const video = child.locator("video");
    await expect(video).toHaveAttribute("data-eclipse-goggles-protected", "video");
    await child.getByRole("button", {
      name: "Reveal protected media: Floating child-frame video",
    }).click({ timeout: 5_000 });

    await expect(video).not.toHaveAttribute("data-eclipse-goggles-protected", "video");
    await expect.poll(() => visibleAsideFrostsOverChild(page)).toBe(0);
    await page.locator('iframe[title="Floating video"]').evaluate((frame) => {
      frame.style.left = "427px";
      window.dispatchEvent(new Event("resize"));
    });
    await expect(page.locator("aside [data-eclipse-goggles-root] .eg-layer.eg-frost").first())
      .toBeVisible();
  } finally {
    await context.close();
  }
});

test("keeps the exposed frost interactive on a partially iframe-covered link", async () => {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    viewport: { width: 427, height: 240 },
    args: [
      "--window-position=-10000,-10000",
      "--window-size=427,240",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    await (context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker"));
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto("http://127.0.0.1:4173/cross-frame-popover-stack.html");
    const target = page.locator("#partial-target");
    await expect(target).toHaveAttribute("data-eclipse-goggles-protected", "image");
    const reveal = page.getByRole("button", {
      name: "Reveal protected media: Partially covered linked image",
    });
    const box = await reveal.boundingBox();
    expect(box).not.toBeNull();
    const initialUrl = page.url();

    await page.mouse.click(box!.x + 40, box!.y + box!.height / 2);

    await expect(target).not.toHaveAttribute("data-eclipse-goggles-protected", "image");
    expect(page.url()).toBe(initialUrl);
  } finally {
    await context.close();
  }
});
