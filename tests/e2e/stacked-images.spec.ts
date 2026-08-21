import { chromium, expect, test } from "@playwright/test";
import { resolve } from "node:path";

const fixtureUrl = "http://127.0.0.1:4173/stacked-images.html";
const extensionPath = resolve("dist");
const windowSize = { width: 427, height: 240 } as const;

test("protects only the meaningful foreground copy in a stacked image treatment", async () => {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    viewport: windowSize,
    args: [
      `--window-size=${windowSize.width},${windowSize.height}`,
      "--window-position=-10000,-10000",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    await (context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker"));
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(fixtureUrl);

    const backdrop = page.locator("#backdrop");
    const foreground = page.locator("#foreground");
    await expect(foreground).toHaveAttribute("data-eclipse-goggles-protected", "image");
    await expect(backdrop).not.toHaveAttribute("data-eclipse-goggles-protected", "image");
    await expect(page.locator("[data-eclipse-goggles-root]")).toHaveCount(1);

    const [targetBox, layerBox] = await Promise.all([
      foreground.boundingBox(),
      page.locator("[data-eclipse-goggles-root] .eg-layer").boundingBox(),
    ]);
    expect(targetBox).not.toBeNull();
    expect(layerBox).not.toBeNull();
    expect(layerBox).toEqual(targetBox);
  } finally {
    await context.close();
  }
});

test("uses one frost layer for a Reddit video with a gradient control scrim", async () => {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    viewport: windowSize,
    args: [
      `--window-size=${windowSize.width},${windowSize.height}`,
      "--window-position=-10000,-10000",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    await (context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker"));
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto("http://127.0.0.1:4173/reddit-video-stack.html");

    await expect(page.locator("[data-eclipse-goggles-protected]")).toHaveCount(1);
    await expect(page.locator("[data-eclipse-goggles-root]")).toHaveCount(1);
    await expect(page.locator("[data-eclipse-goggles-root] .eg-goggles-control")).toHaveCount(0);
    await expect(page.locator("video")).toHaveAttribute(
      "data-eclipse-goggles-protected",
      "video",
    );
    await expect(page.locator(".scrim")).not.toHaveAttribute(
      "data-eclipse-goggles-protected",
      "image",
    );
    await expect(page.locator("[data-eclipse-goggles-root] .eg-goggles-control")).toHaveCount(0);

    await page.getByRole("button", {
      name: "Reveal protected media: Reddit native video",
    }).click();

    await expect(page.locator("[data-eclipse-goggles-protected]")).toHaveCount(0);
    await expect(page.locator("[data-eclipse-goggles-root] .eg-frost")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Frost again" })).toHaveCount(1);
  } finally {
    await context.close();
  }
});

test("reveals a linked Reddit thumbnail without activating its destination", async () => {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    viewport: windowSize,
    args: [
      `--window-size=${windowSize.width},${windowSize.height}`,
      "--window-position=-10000,-10000",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    await (context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker"));
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto("http://127.0.0.1:4173/reddit-link.html");
    await page.getByRole("button", {
      name: "Reveal protected media: Reddit video thumbnail",
    }).click();

    await expect(page.locator("img")).not.toHaveAttribute(
      "data-eclipse-goggles-protected",
      "image",
    );
    expect(new URL(page.url()).pathname).toBe("/reddit-link.html");
  } finally {
    await context.close();
  }
});

test("keeps the reveal surface clickable above a hostile page stacking context", async () => {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    viewport: windowSize,
    args: [
      `--window-size=${windowSize.width},${windowSize.height}`,
      "--window-position=-10000,-10000",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    await (context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker"));
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto("http://127.0.0.1:4173/stacking-context.html");
    const reveal = page.getByRole("button", { name: /Reveal protected media/ });
    const revealBox = await reveal.boundingBox();
    expect(revealBox).not.toBeNull();
    await page.locator("#interceptor").evaluate((element, box) => {
      Object.assign((element as HTMLElement).style, {
        left: `${box!.x}px`,
        top: `${box!.y}px`,
        width: `${box!.width}px`,
        height: `${box!.height}px`,
        right: "auto",
      });
    }, revealBox);
    await reveal.click({ timeout: 2_000 });

    await expect(page.locator("[data-eclipse-goggles-root] .eg-frost")).toHaveCount(0);
    expect(await page.evaluate(() => (window as typeof window & {
      interceptorClicks: number;
    }).interceptorClicks)).toBe(0);
  } finally {
    await context.close();
  }
});

test("reveals a linked Reddit shadow card without activating its destination", async () => {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    viewport: windowSize,
    args: [
      `--window-size=${windowSize.width},${windowSize.height}`,
      "--window-position=-10000,-10000",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    await (context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker"));
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto("http://127.0.0.1:4173/reddit-shadow-link.html");
    await page.getByRole("button", {
      name: "Reveal protected media: Background image protected by Goggles",
    }).click();

    expect(new URL(page.url()).pathname).toBe("/reddit-shadow-link.html");
  } finally {
    await context.close();
  }
});
