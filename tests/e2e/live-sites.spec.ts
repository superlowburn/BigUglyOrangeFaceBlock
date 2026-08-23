import { chromium, expect, test } from "@playwright/test";
import { resolve } from "node:path";

const sites = [
  ["Reddit", "https://www.reddit.com/"],
  ["CNN", "https://www.cnn.com/"],
  ["The New York Times", "https://www.nytimes.com/"],
  ["Fox News", "https://www.foxnews.com/"],
  ["The Washington Post", "https://www.washingtonpost.com/"],
  ["The Wall Street Journal", "https://www.wsj.com/"],
] as const;

test.skip(!process.env.LIVE_SITE_QA, "Set LIVE_SITE_QA=1 for fresh live-site checks.");

for (const [name, url] of sites) {
  test(`${name}: ordinary media remains visible and matched media has one layer`, async ({}, testInfo) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: true,
      viewport: { width: 1280, height: 900 },
      args: [
        `--disable-extensions-except=${resolve("dist")}`,
        `--load-extension=${resolve("dist")}`,
      ],
    });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
      await worker.evaluate(() => chrome.storage.local.set({
        "blocked-subjects": {
          enabled: true,
          keywords: ["Trump", "Donald Trump", "Donald J. Trump", "President Trump"],
        },
      }));
      const page = await context.newPage();
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 })
        .catch(() => null);
      await page.waitForTimeout(4_000);

      const title = await page.title();
      const accessBlocked = !response || (response.status() >= 400) ||
        /captcha|access denied|verify you are human|just a moment/iu.test(title);
      const media = await page.locator("img, video, iframe").count();
      const protectedMedia = page.locator("[data-buof-protected]");
      const protectedCount = await protectedMedia.count();
      const layerCount = await page.locator("[data-buof-root] .buof-frost").count();

      console.log(`LIVE_QA ${name}: status=${response?.status() ?? "navigation-failed"} media=${media} protected=${protectedCount} layers=${layerCount} title=${JSON.stringify(title)}`);
      await testInfo.attach(name.toLowerCase().replace(/\W+/gu, "-"), {
        body: await page.screenshot({ fullPage: false }),
        contentType: "image/png",
      });

      if (accessBlocked) {
        test.info().annotations.push({ type: "blocker", description: `Access blocked: ${title || "navigation failed"}` });
        return;
      }

      expect(layerCount).toBe(protectedCount);
      if (media > 0) expect(protectedCount).toBeLessThan(media);
      if (protectedCount === 0) {
        test.info().annotations.push({ type: "blocker", description: "No subject match was available in the opening viewport." });
        return;
      }

      const first = protectedMedia.first();
      const contextText = await first.evaluate((element) => {
        const link = element.closest("a[href]");
        const containers = new Set([
          element.closest("figure, shreddit-post, [data-testid*='post']"),
          element.closest("article"),
        ]);
        const values = [
          element.getAttribute("alt"),
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("src"),
          element.getAttribute("data-src"),
          element.getAttribute("poster"),
          getComputedStyle(element).backgroundImage,
          link?.getAttribute("href"),
          link?.getAttribute("aria-label"),
          link?.getAttribute("title"),
        ];
        for (const container of containers) {
          if (!container) continue;
          values.push(...Array.from(container.querySelectorAll(
            "h1, h2, h3, h4, figcaption, [slot='title'], [slot='post-title']",
          )).map((node) => node.textContent));
        }
        return values.filter(Boolean).join(" ");
      });
      expect(contextText).toMatch(/trump/iu);
    } finally {
      await context.close();
    }
  });
}
