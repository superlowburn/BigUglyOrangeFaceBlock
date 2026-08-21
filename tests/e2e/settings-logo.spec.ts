import { chromium, expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const extensionPath = resolve("dist");
const qaWindow = { width: 427, height: 240 } as const;

async function openSettings(page: Page, workerUrl: string): Promise<void> {
  await page.goto(`chrome-extension://${new URL(workerUrl).host}/options/options.html`);
}

test("keeps the settings-page Goggles logo clear and centered", async ({}, testInfo) => {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    viewport: qaWindow,
    args: [
      "--window-position=-10000,-10000",
      `--window-size=${qaWindow.width},${qaWindow.height}`,
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const page = context.pages()[0] ?? await context.newPage();
    await openSettings(page, worker.url());

    const brand = page.locator(".brand");
    const logo = brand.locator(".brand-mark");
    await expect(brand).toContainText("Goggles");
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute("aria-hidden", "true");
    await expect(brand).not.toContainText("SETTINGS");
    const cdp = await context.newCDPSession(page);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    const { bounds: launchBounds } = await cdp.send("Browser.getWindowBounds", { windowId });

    for (const viewport of [qaWindow, { width: 375, height: 812 }] as const) {
      if (viewport !== qaWindow) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile: false,
        });
      }
      const { bounds } = await cdp.send("Browser.getWindowBounds", { windowId });
      expect(bounds).toEqual(launchBounds);
      const metrics = await logo.evaluate((mark) => {
        const box = mark.getBoundingClientRect();
        return {
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
          x: box.x,
          right: box.right,
          width: box.width,
          height: box.height,
        };
      });

      expect(metrics.documentWidth).toBe(metrics.viewportWidth);
      expect(metrics.width).toBeGreaterThanOrEqual(50);
      expect(metrics.height).toBeGreaterThanOrEqual(28);
      expect(metrics.x).toBeGreaterThanOrEqual(0);
      expect(metrics.right).toBeLessThanOrEqual(viewport.width);

      await testInfo.attach(`settings-logo-${viewport.width}px`, {
        body: await page.locator(".hero").screenshot(),
        contentType: "image/png",
      });
    }
  } finally {
    await context.close();
  }
});

test("keeps the first settings controls in the opening desktop view", async () => {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    viewport: qaWindow,
    args: [
      "--window-position=-10000,-10000",
      `--window-size=${qaWindow.width},${qaWindow.height}`,
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const page = context.pages()[0] ?? await context.newPage();
    await openSettings(page, worker.url());

    await expect(page).toHaveTitle(/Settings/u);
    const firstSectionTop = await page.locator("section").first().evaluate((section) =>
      section.getBoundingClientRect().top,
    );
    expect(firstSectionTop).toBeLessThan(600);
  } finally {
    await context.close();
  }
});

test("makes the blocked-subject controls and small labels visually clear", async () => {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    viewport: qaWindow,
    args: [
      "--window-position=-10000,-10000",
      `--window-size=${qaWindow.width},${qaWindow.height}`,
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const page = context.pages()[0] ?? await context.newPage();
    await openSettings(page, worker.url());

    await expect(page.locator(".subject-card")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Blocked subjects" })).toBeVisible();
    await expect(page.locator("#blocked-subjects-enabled")).toBeVisible();
    await expect(page.getByText("Default for new sites")).toHaveCount(0);
    const keywordEditor = page.locator(".keyword-editor");
    await expect(keywordEditor).not.toHaveAttribute("open", "");
    await expect(page.getByText("Matching words", { exact: true })).toBeVisible();
    await expect(page.locator("#blocked-subject-keywords")).not.toBeVisible();

    await page.getByText("Matching words", { exact: true }).click();
    await expect(keywordEditor).toHaveAttribute("open", "");
    await expect(page.locator("#blocked-subject-keywords")).toBeVisible();

    const labelContrast = await page.locator(".section-number").first().evaluate((label) => {
      const parse = (color: string): number[] => color.match(/[\d.]+/gu)?.slice(0, 3).map(Number) ?? [];
      const luminance = (rgb: number[]): number => {
        const channels = rgb.map((value) => {
          const normalized = value / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
      };
      const foreground = luminance(parse(getComputedStyle(label).color));
      const background = luminance(parse(getComputedStyle(document.body).backgroundColor));
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(labelContrast).toBeGreaterThanOrEqual(4.5);
  } finally {
    await context.close();
  }
});
