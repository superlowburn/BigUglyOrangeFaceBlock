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

type LaunchedExtension = {
  context: BrowserContext;
  page: Page;
  worker: Worker;
};

async function launchExtension(
  options: { deviceScaleFactor?: number } = {},
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
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const page = context.pages()[0] ?? await context.newPage();
  return { context, page, worker };
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

test("protects article images", async () => {
  const { context, page } = await launchExtension();
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
    await context.close();
  }
});

test("protects dynamic and client-route media and removes every layer in Trusted mode", async () => {
  const { context, page, worker } = await launchExtension();
  try {
    await page.goto(`${fixtureOrigin}/dynamic-feed.html`);
    await expect(page.locator("#appended-image")).toHaveAttribute("data-eclipse-goggles-protected", "image");

    await page.evaluate(() => (window as typeof window & { replaceRoute(): void }).replaceRoute());
    await expect(page.locator("#route-image")).toHaveAttribute("data-eclipse-goggles-protected", "image");

    await setMode(worker, "trusted");
    await expect(page.locator(protectedSelector)).toHaveCount(0);
    await expect(page.locator("[data-eclipse-goggles-root]")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("Strict mode re-protects a revealed image after two seconds fully away", async () => {
  const { context, page, worker } = await launchExtension();
  try {
    await setMode(worker, "strict");
    await page.goto(`${fixtureOrigin}/dynamic-feed.html`);
    await expect(page.locator("#strict-image")).toHaveAttribute("data-eclipse-goggles-protected", "image");
    await layerWithText(page, "A lighthouse").getByRole("button", { name: "Reveal" }).click();
    await expect(page.locator("#strict-image")).not.toHaveAttribute("data-eclipse-goggles-protected", "image");

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator("#strict-image")).toHaveAttribute(
      "data-eclipse-goggles-protected",
      "image",
      { timeout: 3_500 },
    );
  } finally {
    await context.close();
  }
});

test("secures native autoplay video and reveal never starts or unmutes it", async () => {
  const { context, page } = await launchExtension();
  try {
    await page.route("https://www.youtube.com/**", (route) => route.fulfill({ body: "<!doctype html><title>YouTube fixture</title>", contentType: "text/html" }));
    await page.route("https://player.vimeo.com/**", (route) => route.fulfill({ body: "<!doctype html><title>Vimeo fixture</title>", contentType: "text/html" }));
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
    await context.close();
  }
});

test("gates and exactly restores YouTube and Vimeo frames without real external traffic", async () => {
  const { context, page } = await launchExtension();
  const externalRequests: string[] = [];
  context.on("request", (request) => {
    if (!request.url().startsWith(fixtureOrigin) && !request.url().startsWith("data:")) externalRequests.push(request.url());
  });
  await context.route("https://www.youtube.com/**", (route) => route.fulfill({ body: "<!doctype html><title>YouTube fixture</title>", contentType: "text/html" }));
  await context.route("https://player.vimeo.com/**", (route) => route.fulfill({ body: "<!doctype html><title>Vimeo fixture</title>", contentType: "text/html" }));
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

    expect(new Set(externalRequests)).toEqual(new Set([
      "https://www.youtube.com/embed/eclipse-test?autoplay=1",
      "https://player.vimeo.com/video/123456789?autoplay=1",
    ]));
  } finally {
    await context.close();
  }
});

test("protects native video in a same-origin child and does not double-protect provider child documents", async () => {
  const { context, page } = await launchExtension();
  await context.route("https://www.youtube.com/**", (route) => route.fulfill({ body: "<!doctype html><html><body><h1>Provider child</h1></body></html>", contentType: "text/html" }));
  await context.route("https://player.vimeo.com/**", (route) => route.fulfill({ body: "<!doctype html><title>Vimeo fixture</title>", contentType: "text/html" }));
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
    await context.close();
  }
});

test("keeps overlays aligned after resize and 125 percent page scale", async () => {
  const { context, page } = await launchExtension();
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
    await context.close();
  }
});

test("keeps overlays aligned at deviceScaleFactor 2", async () => {
  const { context, page } = await launchExtension({ deviceScaleFactor: 2 });
  try {
    await page.goto(`${fixtureOrigin}/article.html`);
    await expect(page.locator("#first")).toHaveAttribute("data-eclipse-goggles-protected", "image");
    await assertAligned(page.locator("#first"), layerWithText(page, "A moonlit lake"));
  } finally {
    await context.close();
  }
});

test("has visible keyboard focus, specified caption contrast, and only approved public attributes", async () => {
  const { context, page } = await launchExtension();
  const outbound: string[] = [];
  context.on("request", (request) => {
    if (!request.url().startsWith(fixtureOrigin) && !request.url().startsWith("data:")) outbound.push(request.url());
  });
  try {
    await page.goto(`${fixtureOrigin}/article.html`);
    const layer = layerWithText(page, "A moonlit lake");
    await layer.focus();
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
    expect(outbound).toEqual([]);
  } finally {
    await context.close();
  }
});
