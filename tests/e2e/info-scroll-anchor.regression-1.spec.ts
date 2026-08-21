import { chromium, expect, test } from "@playwright/test";
import { resolve } from "node:path";

const extensionPath = resolve("dist");

// Regression: the info button chased the viewport while a tall image scrolled.
test("keeps the info button at the image's true bottom-left corner", async () => {
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
    await page.goto("http://127.0.0.1:4173/tall-image.html");
    const image = page.locator("img");
    const info = page.getByRole("button", { name: "Show image description" });
    await expect(info).toHaveCount(1);

    const initialInfoBox = await info.boundingBox();
    expect(initialInfoBox).not.toBeNull();
    expect(initialInfoBox!.y).toBeGreaterThan(730);

    await page.evaluate(() => window.scrollTo(0, 500));
    await expect.poll(async () => {
      const [imageBox, infoBox] = await Promise.all([image.boundingBox(), info.boundingBox()]);
      if (!imageBox || !infoBox) return Number.POSITIVE_INFINITY;
      return Math.max(
        Math.abs(infoBox.x - (imageBox.x + 12)),
        Math.abs(infoBox.y + infoBox.height - (imageBox.y + imageBox.height - 12)),
      );
    }).toBeLessThanOrEqual(1);
  } finally {
    await context.close();
  }
});
