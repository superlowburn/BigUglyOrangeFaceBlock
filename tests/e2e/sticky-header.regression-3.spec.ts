import { chromium, expect, test } from "@playwright/test";
import { resolve } from "node:path";

const extensionPath = resolve("dist");
const fixtureUrl = "http://127.0.0.1:4173/sticky-header-media.html";

test("clips frost below a sticky site header without losing reveal isolation", async () => {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    viewport: { width: 427, height: 240 },
    args: [
      "--window-size=427,240",
      "--window-position=-10000,-10000",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    await (context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker"));
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(fixtureUrl);
    const media = page.locator("#media");
    const frost = page.locator("[data-eclipse-goggles-root] .eg-layer.eg-frost");
    await expect(media).toHaveAttribute("data-eclipse-goggles-protected", "image");
    await expect(frost).toHaveCount(1);

    await page.locator("#media").evaluate((element) => {
      window.scrollTo({ top: (element as HTMLImageElement).offsetTop, behavior: "instant" });
    });
    await expect.poll(async () => (await media.boundingBox())?.y).toBe(0);
    await expect.poll(async () => (await frost.boundingBox())?.y).toBe(56);

    const [headerBox, mediaBox, frostBox] = await Promise.all([
      page.locator("#site-header").boundingBox(),
      media.boundingBox(),
      frost.boundingBox(),
    ]);
    expect(headerBox).not.toBeNull();
    expect(mediaBox).not.toBeNull();
    expect(frostBox).not.toBeNull();
    expect(frostBox?.y).toBe(headerBox?.height);
    expect(frostBox?.height).toBe(mediaBox!.height - headerBox!.height);

    const fixturePath = new URL(page.url()).pathname;
    await page.locator("#header-link").click({ timeout: 2_000 });
    await page.locator("#header-button").click({ timeout: 2_000 });
    expect(new URL(page.url()).pathname).toBe(fixturePath);

    await page.getByRole("button", {
      name: "Reveal protected media: A linked landscape beneath a sticky site header",
    }).click();
    await expect(frost).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(fixturePath);
    await page.locator("#header-button").click({ timeout: 2_000 });

    await page.getByRole("button", { name: "Frost again" }).click();
    await expect(frost).toHaveCount(1);
    await page.locator("#header-button").click({ timeout: 2_000 });
    expect(await page.evaluate(() => ({
      button: (window as typeof window & { headerButtonClicks: number }).headerButtonClicks,
      link: (window as typeof window & { headerLinkClicks: number }).headerLinkClicks,
    }))).toEqual({ button: 3, link: 1 });

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect.poll(async () => (await media.boundingBox())?.y).toBeGreaterThan(56);
    await expect.poll(async () => (await frost.boundingBox())?.y).toBeGreaterThan(56);
    const [restoredMediaBox, restoredFrostBox] = await Promise.all([
      media.boundingBox(),
      frost.boundingBox(),
    ]);
    expect(restoredFrostBox).toEqual(restoredMediaBox);
  } finally {
    await context.close();
  }
});
