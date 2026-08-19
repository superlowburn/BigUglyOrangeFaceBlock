import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Frame,
  type Locator,
  type Page,
  type Worker,
} from "@playwright/test";
import { resolve } from "node:path";
import { request as httpRequest } from "node:http";

const extensionPath = resolve("dist");
const fixtureOrigin = "http://127.0.0.1:4173";
const protectedSelector = "[data-eclipse-goggles-protected]";
const youtubeFixtureUrl = "https://www.youtube.com/embed/eclipse-test?autoplay=1";
const vimeoFixtureUrl = "https://player.vimeo.com/video/123456789?autoplay=1";
const youtubeChildFixtureUrl = "https://www.youtube.com/embed/child-test";
const videoProviderUrls = [youtubeFixtureUrl, vimeoFixtureUrl] as const;

type LaunchedExtension = {
  context: BrowserContext;
  page: Page;
  worker: Worker;
  unexpectedRequests: string[];
};

async function launchExtension(
  options: { deviceScaleFactor?: number; providerFixtureUrls?: readonly string[] } = {},
): Promise<LaunchedExtension> {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    viewport: { width: 1100, height: 800 },
    ...(options.deviceScaleFactor === undefined ? {} : { deviceScaleFactor: options.deviceScaleFactor }),
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  const unexpectedRequests: string[] = [];
  const providerFixtureUrls = new Set(options.providerFixtureUrls ?? []);
  context.on("request", (request) => {
    const url = request.url();
    if (isLocalRequest(url)) return;
    if (providerFixtureUrls.has(url)) return;
    unexpectedRequests.push(`${request.method()} ${request.resourceType()} ${url}`);
  });
  for (const url of providerFixtureUrls) {
    await context.route(url, (route) => route.fulfill({
      body: "<!doctype html><html><body><h1>Local provider fixture</h1></body></html>",
      contentType: "text/html",
    }));
  }
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const page = context.pages()[0] ?? await context.newPage();
  return { context, page, worker, unexpectedRequests };
}

function isLocalRequest(url: string): boolean {
  return url.startsWith(fixtureOrigin) ||
    url.startsWith("data:") ||
    url.startsWith("blob:") ||
    url.startsWith("about:") ||
    url.startsWith("chrome-extension:");
}

async function closeExtension(extension: LaunchedExtension): Promise<void> {
  await extension.page.waitForTimeout(50).catch(() => undefined);
  await extension.context.close();
  expect(
    extension.unexpectedRequests,
    "unexpected outbound request during a loaded-extension fixture run",
  ).toEqual([]);
}

function layers(scope: Page | Frame): Locator {
  return scope.locator("[data-eclipse-goggles-root]").locator(".eg-layer");
}

function layerWithText(scope: Page | Frame, text: string): Locator {
  return layers(scope).filter({ hasText: text });
}

async function setMode(worker: Worker, mode: "trusted" | "protected" | "strict"): Promise<void> {
  await worker.evaluate(
    async ({ key, value }) => chrome.storage.local.set({ [key]: value }),
    { key: `site-policy:${fixtureOrigin}`, value: mode },
  );
}

async function assertAligned(target: Locator, layer: Locator): Promise<void> {
  await expect.poll(async () => {
    const [targetBox, layerBox] = await Promise.all([target.boundingBox(), layer.boundingBox()]);
    if (!targetBox || !layerBox) return Number.POSITIVE_INFINITY;
    return Math.max(
      Math.abs(targetBox.x - layerBox.x),
      Math.abs(targetBox.y - layerBox.y),
      Math.abs(targetBox.width - layerBox.width),
      Math.abs(targetBox.height - layerBox.height),
    );
  }).toBeLessThanOrEqual(1);
}

function rawRequest(path: string): Promise<number> {
  return new Promise((resolveStatus, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port: 4173, path }, (response) => {
      response.resume();
      response.on("end", () => resolveStatus(response.statusCode ?? 0));
    });
    request.on("error", reject);
    request.end();
  });
}

test("fixture server is loopback-only and rejects traversal outside fixtures", async () => {
  expect(await rawRequest("/%2e%2e/package.json")).toBe(400);
  expect(await rawRequest("/package.json")).toBe(404);
  expect(await rawRequest("/")).toBe(200);
});

test("privacy enforcement rejects an unapproved provider-format URL", async () => {
  const extension = await launchExtension({ providerFixtureUrls: videoProviderUrls });
  const unexpectedUrl = "https://www.youtube.com/embed/unapproved-fixture";
  await extension.context.route(unexpectedUrl, (route) => route.fulfill({
    body: "<!doctype html><title>Rejected local provider fixture</title>",
    contentType: "text/html",
  }));
  await extension.page.goto(`${fixtureOrigin}/video.html`);
  await expect(extension.page.locator("#youtube")).toHaveAttribute("src", "about:blank");
  await expect(extension.page.locator("#vimeo")).toHaveAttribute("src", "about:blank");
  await extension.page.evaluate((url) => fetch(url).catch(() => undefined), unexpectedUrl);

  await expect(closeExtension(extension)).rejects.toThrow(/unapproved-fixture/);
});

test("protects article images", async () => {
  const extension = await launchExtension();
  const { page } = extension;
  try {
    await page.goto(`${fixtureOrigin}/article.html`);
    await expect(page.locator("#first")).toHaveAttribute("data-eclipse-goggles-protected", "image");
    await expect(page.locator("#second")).toHaveAttribute("data-eclipse-goggles-protected", "image");
    await expect(page.locator(".icon")).not.toHaveAttribute("data-eclipse-goggles-protected", "image");
    await expect(layers(page)).toHaveCount(2);
    await expect(layerWithText(page, "A moonlit lake beside dark hills")).toBeVisible();

    await layerWithText(page, "A moonlit lake").getByRole("button", { name: "Reveal" }).click();
    await expect(page.locator("#first")).not.toHaveAttribute("data-eclipse-goggles-protected", "image");
    await expect(page.locator("#second")).toHaveAttribute("data-eclipse-goggles-protected", "image");

    await layerWithText(page, "A red kite").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#second")).not.toHaveAttribute("data-eclipse-goggles-protected", "image");
  } finally {
    await closeExtension(extension);
  }
});

test("protects dynamic and client-route media and removes every layer in Trusted mode", async () => {
  const extension = await launchExtension();
  const { page, worker } = extension;
  try {
    await page.goto(`${fixtureOrigin}/dynamic-feed.html`);
    await expect(page.locator("#appended-image")).toHaveAttribute("data-eclipse-goggles-protected", "image");

    await page.evaluate(() => (window as typeof window & { replaceRoute(): void }).replaceRoute());
    await expect(page.locator("#route-image")).toHaveAttribute("data-eclipse-goggles-protected", "image");

    await setMode(worker, "trusted");
    await expect(page.locator(protectedSelector)).toHaveCount(0);
    await expect(page.locator("[data-eclipse-goggles-root]")).toHaveCount(0);
  } finally {
    await closeExtension(extension);
  }
});

test("Strict mode re-protects a revealed image after two seconds fully away", async () => {
  const extension = await launchExtension();
  const { page, worker } = extension;
  try {
    await setMode(worker, "strict");
    await page.goto(`${fixtureOrigin}/dynamic-feed.html`);
    await expect(page.locator("#strict-image")).toHaveAttribute("data-eclipse-goggles-protected", "image");
    await layerWithText(page, "A lighthouse").getByRole("button", { name: "Reveal" }).click();
    await expect(page.locator("#strict-image")).not.toHaveAttribute("data-eclipse-goggles-protected", "image");

    const scrolledAt = Date.now();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(1_250);
    await expect(page.locator("#strict-image")).not.toHaveAttribute(
      "data-eclipse-goggles-protected",
      "image",
    );
    await expect(page.locator("#strict-image")).toHaveAttribute(
      "data-eclipse-goggles-protected",
      "image",
      { timeout: 2_000 },
    );
    expect(Date.now() - scrolledAt).toBeGreaterThanOrEqual(2_000);
  } finally {
    await closeExtension(extension);
  }
});

test("secures native autoplay video and reveal never starts or unmutes it", async () => {
  const extension = await launchExtension({ providerFixtureUrls: videoProviderUrls });
  const { page } = extension;
  try {
    await page.goto(`${fixtureOrigin}/video.html`);
    const video = page.locator("#native-video");
    await expect(video).toHaveAttribute("data-eclipse-goggles-protected", "video");
    await expect.poll(() => video.evaluate((node) => {
      const media = node as HTMLVideoElement;
      return { paused: media.paused, muted: media.muted };
    })).toEqual({ paused: true, muted: true });

    const coveredTarget = await video.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.getAttribute("data-eclipse-goggles-root") !== null;
    });
    expect(coveredTarget).toBe(true);

    await layerWithText(page, "A looping color field").getByRole("button", { name: "Reveal" }).click();
    await expect(video).not.toHaveAttribute("data-eclipse-goggles-protected", "video");
    expect(await video.evaluate((node) => {
      const media = node as HTMLVideoElement;
      return { paused: media.paused, muted: media.muted };
    })).toEqual({ paused: true, muted: true });
    const revealedTarget = await video.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === node;
    });
    expect(revealedTarget).toBe(true);
  } finally {
    await closeExtension(extension);
  }
});

test("gates and exactly restores YouTube and Vimeo frames without real external traffic", async () => {
  const extension = await launchExtension({ providerFixtureUrls: videoProviderUrls });
  const { page } = extension;
  try {
    await page.goto(`${fixtureOrigin}/video.html`);
    const youtube = page.locator("#youtube");
    const vimeo = page.locator("#vimeo");
    await expect(youtube).toHaveAttribute("src", "about:blank");
    await expect(vimeo).toHaveAttribute("src", "about:blank");

    await layerWithText(page, "YouTube astronomy video").getByRole("button", { name: "Reveal" }).click();
    await expect(youtube).toHaveAttribute("src", "https://www.youtube.com/embed/eclipse-test?autoplay=1");
    await vimeo.scrollIntoViewIfNeeded();
    await layerWithText(page, "Vimeo landscape video").getByRole("button", { name: "Reveal" }).click();
    await expect(vimeo).toHaveAttribute("src", "https://player.vimeo.com/video/123456789?autoplay=1");

  } finally {
    await closeExtension(extension);
  }
});

test("protects native video in a same-origin child and does not double-protect provider child documents", async () => {
  const extension = await launchExtension({
    providerFixtureUrls: [...videoProviderUrls, youtubeChildFixtureUrl],
  });
  const { page } = extension;
  try {
    await page.goto(`${fixtureOrigin}/frame-host.html`);
    const nested = page.frameLocator("#same-origin");
    await expect(nested.locator("#native-video")).toHaveAttribute("data-eclipse-goggles-protected", "video");

    const provider = page.locator("#provider");
    await expect(provider).toHaveAttribute("src", "about:blank");
    await provider.scrollIntoViewIfNeeded();
    const providerNavigation = page.waitForEvent("framenavigated", {
      predicate: (frame) => frame.url().includes("youtube.com/embed/child-test"),
    });
    await layerWithText(page, "Recognized provider frame").getByRole("button", { name: "Reveal" }).click();
    await expect(provider).toHaveAttribute("src", "https://www.youtube.com/embed/child-test");
    const providerChild = await providerNavigation;
    await expect(providerChild.locator("[data-eclipse-goggles-root]")).toHaveCount(0);
  } finally {
    await closeExtension(extension);
  }
});

test("keeps overlays aligned after resize and 125 percent page scale", async () => {
  const extension = await launchExtension();
  const { context, page } = extension;
  try {
    await page.goto(`${fixtureOrigin}/article.html`);
    const target = page.locator("#first");
    const layer = layerWithText(page, "A moonlit lake");
    await expect(target).toHaveAttribute("data-eclipse-goggles-protected", "image");
    await assertAligned(target, layer);

    await page.setViewportSize({ width: 900, height: 650 });
    await assertAligned(target, layer);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1.25 });
    await assertAligned(target, layer);
  } finally {
    await closeExtension(extension);
  }
});

test("keeps overlays aligned at deviceScaleFactor 2", async () => {
  const extension = await launchExtension({ deviceScaleFactor: 2 });
  const { page } = extension;
  try {
    await page.goto(`${fixtureOrigin}/article.html`);
    await expect(page.locator("#first")).toHaveAttribute("data-eclipse-goggles-protected", "image");
    await assertAligned(page.locator("#first"), layerWithText(page, "A moonlit lake"));
  } finally {
    await closeExtension(extension);
  }
});

test("has visible keyboard focus, specified caption contrast, and only approved public attributes", async () => {
  const extension = await launchExtension();
  const { page } = extension;
  try {
    await page.goto(`${fixtureOrigin}/article.html`);
    const layer = layerWithText(page, "A moonlit lake");
    let reachedProtectedLayer = false;
    for (let step = 0; step < 8 && !reachedProtectedLayer; step += 1) {
      await page.keyboard.press("Tab");
      reachedProtectedLayer = await layer.evaluate((node) => {
        const root = node.getRootNode();
        return root instanceof ShadowRoot &&
          root.activeElement === node &&
          document.activeElement === root.host;
      });
    }
    expect(reachedProtectedLayer, "Tab navigation did not reach the protected media layer").toBe(true);
    const presentation = await layer.evaluate((node) => {
      const layerStyle = getComputedStyle(node);
      const captionStyle = getComputedStyle(node.querySelector(".eg-caption")!);
      return {
        outlineColor: layerStyle.outlineColor,
        outlineWidth: layerStyle.outlineWidth,
        color: captionStyle.color,
        background: captionStyle.backgroundColor,
      };
    });
    expect(presentation).toEqual({
      outlineColor: "rgb(22, 100, 215)",
      outlineWidth: "3px",
      color: "rgb(38, 41, 44)",
      background: "rgba(250, 250, 250, 0.94)",
    });

    const publicAttributes = await page.locator("*").evaluateAll((elements) =>
      elements.flatMap((element) => element.getAttributeNames().filter((name) => name.startsWith("data-eclipse-goggles-"))),
    );
    expect(new Set(publicAttributes)).toEqual(new Set([
      "data-eclipse-goggles-root",
      "data-eclipse-goggles-protected",
    ]));
  } finally {
    await closeExtension(extension);
  }
});
