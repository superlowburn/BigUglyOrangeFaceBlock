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
const acceptanceWindow = { width: 427, height: 240 } as const;

type LaunchedExtension = {
  context: BrowserContext;
  page: Page;
  worker: Worker;
  unexpectedRequests: string[];
  providerRequests: string[];
  allowProviderAssets(): void;
};

async function launchExtension(
  options: { deviceScaleFactor?: number; providerFixtureUrls?: readonly string[] } = {},
): Promise<LaunchedExtension> {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    viewport: acceptanceWindow,
    ...(options.deviceScaleFactor === undefined ? {} : { deviceScaleFactor: options.deviceScaleFactor }),
    args: [
      `--window-size=${acceptanceWindow.width},${acceptanceWindow.height}`,
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  const unexpectedRequests: string[] = [];
  const providerRequests: string[] = [];
  let providerAssetsAllowed = false;
  const providerFixtureUrls = new Set(options.providerFixtureUrls ?? []);
  context.on("request", (request) => {
    const url = request.url();
    if (isLocalRequest(url)) return;
    if (isApprovedProviderFixture(url, providerFixtureUrls)) return;
    if (providerAssetsAllowed && isProviderAsset(url)) return;
    unexpectedRequests.push(`${request.method()} ${request.resourceType()} ${url}`);
  });
  await context.route(/^https:\/\//, (route) => {
    const url = route.request().url();
    if (isApprovedProviderFixture(url, providerFixtureUrls)) {
      providerRequests.push(url);
      return route.fulfill({
        body: "<!doctype html><html><body><h1>Local provider fixture</h1></body></html>",
        contentType: "text/html",
      });
    }
    if (providerAssetsAllowed && isProviderAsset(url)) {
      return route.fulfill({ body: "", contentType: "application/octet-stream" });
    }
    return route.fallback();
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const page = context.pages()[0] ?? await context.newPage();
  return {
    context,
    page,
    worker,
    unexpectedRequests,
    providerRequests,
    allowProviderAssets: () => {
      providerAssetsAllowed = true;
    },
  };
}

function isApprovedProviderFixture(url: string, approved: ReadonlySet<string>): boolean {
  let candidate: URL;
  try {
    candidate = new URL(url);
  } catch {
    return false;
  }
  return [...approved].some((source) => {
    const expected = new URL(source);
    return candidate.origin === expected.origin && candidate.pathname === expected.pathname;
  });
}

function isProviderAsset(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "www.youtube.com" ||
      host.endsWith(".youtube.com") ||
      host.endsWith(".ytimg.com") ||
      host === "fonts.gstatic.com" ||
      host.endsWith(".googlevideo.com") ||
      host === "player.vimeo.com" ||
      host.endsWith(".vimeocdn.com");
  } catch {
    return false;
  }
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

test("launches the loaded extension in the compact acceptance window", async () => {
  const extension = await launchExtension();
  try {
    const dimensions = await extension.page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    expect(dimensions).toEqual({
      width: acceptanceWindow.width,
      height: acceptanceWindow.height,
    });
  } finally {
    await closeExtension(extension);
  }
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
    await expect(layers(page)).toHaveCount(3);
    await expect(layerWithText(page, "A moonlit lake beside dark hills")).toBeVisible();

    await layerWithText(page, "A moonlit lake").click();
    await expect(page.locator("#first")).not.toHaveAttribute("data-eclipse-goggles-protected", "image");
    await expect(page.locator("#second")).toHaveAttribute("data-eclipse-goggles-protected", "image");

    await layerWithText(page, "A red kite").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#second")).not.toHaveAttribute("data-eclipse-goggles-protected", "image");
  } finally {
    await closeExtension(extension);
  }
});

test("refreshes stale geometry after layout-only DOM mutations", async () => {
  const extension = await launchExtension();
  const { page } = extension;
  try {
    await page.goto(`${fixtureOrigin}/article.html`);
    const target = page.locator("#first");
    const layer = layerWithText(page, "A moonlit lake");
    await assertAligned(target, layer);

    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.id = "layout-spacer";
      spacer.style.height = "173px";
      document.querySelector("#first")!.before(spacer);
    });

    await assertAligned(target, layer);
  } finally {
    await closeExtension(extension);
  }
});

test("protects media in existing and dynamically inserted open shadow roots", async () => {
  const extension = await launchExtension();
  const { page } = extension;
  try {
    await page.goto(`${fixtureOrigin}/article.html`);
    const existing = page.locator("#open-shadow-host").locator("#shadow-image");
    await expect(existing).toHaveAttribute("data-eclipse-goggles-protected", "image");

    await page.evaluate(() => {
      const host = document.createElement("aside");
      host.id = "dynamic-shadow-host";
      const image = document.createElement("img");
      image.id = "dynamic-shadow-image";
      image.alt = "A dynamic open shadow image";
      Object.assign(image.style, { display: "block", width: "640px", height: "360px" });
      image.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='360'%3E%3C/svg%3E";
      host.attachShadow({ mode: "open" }).append(image);
      document.body.append(host);
    });
    await expect(page.locator("#dynamic-shadow-host").locator("#dynamic-shadow-image"))
      .toHaveAttribute("data-eclipse-goggles-protected", "image");
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

test("protects media inserted by back-forward SPA navigation", async () => {
  const extension = await launchExtension();
  const { page } = extension;
  try {
    await page.goto(`${fixtureOrigin}/dynamic-feed.html`);
    await page.evaluate(() => (window as typeof window & { replaceRoute(): void }).replaceRoute());
    await expect(page.locator("#route-image")).toHaveAttribute("data-eclipse-goggles-protected", "image");

    await page.goBack();

    await expect(page.locator("#history-image")).toHaveAttribute("data-eclipse-goggles-protected", "image");
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
    await layerWithText(page, "A lighthouse").click();
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

    await layerWithText(page, "A looping color field").click();
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

test("withholds provider requests until one exact trusted reveal and re-protection", async () => {
  const extension = await launchExtension({ providerFixtureUrls: videoProviderUrls });
  const { page } = extension;
  try {
    await page.goto(`${fixtureOrigin}/video.html`);
    const youtube = page.locator("#youtube");
    const vimeo = page.locator("#vimeo");
    await expect(youtube).toHaveAttribute("src", "about:blank");
    await expect(vimeo).toHaveAttribute("src", "about:blank");
    expect(extension.providerRequests).toEqual([]);

    extension.allowProviderAssets();
    const selectedNavigation = page.waitForEvent("framenavigated", {
      predicate: (frame) => frame.url().includes("/embed/eclipse-test") &&
        frame.url().includes("eg_eclipse_goggles="),
    });
    const youtubeReveal = page.getByRole("button", {
      name: "Reveal protected media: YouTube astronomy video",
      exact: true,
    });
    await youtube.scrollIntoViewIfNeeded();
    await assertAligned(youtube, youtubeReveal);
    await youtubeReveal.click();
    await expect.poll(() => extension.providerRequests).toHaveLength(1);
    expect(new URL(extension.providerRequests[0]!).pathname).toBe("/embed/eclipse-test");
    const authorized = new URL(extension.providerRequests[0]!);
    expect(authorized.searchParams.get("autoplay")).toBe("0");
    expect(authorized.searchParams.get("eg_eclipse_goggles")).toBeTruthy();
    await selectedNavigation;
    await expect.poll(() => extension.worker.evaluate(
      () => chrome.declarativeNetRequest.getSessionRules(),
    )).toEqual([]);
    await expect(page.locator("#youtube-twin")).toHaveAttribute("src", "about:blank");
    await expect(vimeo).toHaveAttribute("src", "about:blank");

    const reprotect = page.getByRole("button", { name: "Protect again", exact: true });
    await reprotect.focus();
    await reprotect.press("Enter");
    await expect(youtube).toHaveAttribute("src", "about:blank");
    await page.evaluate(({ original, nonce }) => {
      const sources: Array<[string, string]> = [
        ["later-same-url", original],
        ["later-same-nonce", nonce],
      ];
      for (const [id, source] of sources) {
        const later = document.createElement("iframe");
        later.id = id;
        later.src = source;
        document.body.append(later);
      }
    }, { original: youtubeFixtureUrl, nonce: authorized.href });
    await page.waitForTimeout(200);
    expect(extension.providerRequests).toHaveLength(1);

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
    extension.allowProviderAssets();
    await layerWithText(page, "Recognized provider frame").click();
    await expect.poll(async () => {
      const source = new URL((await provider.getAttribute("src"))!);
      return {
        path: source.origin + source.pathname,
        autoplay: source.searchParams.get("autoplay"),
        authorized: Boolean(source.searchParams.get("eg_eclipse_goggles")),
      };
    }).toEqual({
      path: "https://www.youtube.com/embed/child-test",
      autoplay: "0",
      authorized: true,
    });
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
    await expect(page.getByRole("button", {
      name: "Reveal protected media: A moonlit lake beside dark hills",
      exact: true,
    })).toHaveCount(1);
    await expect(layer.locator("button, a, input, select, textarea, [role=button]")).toHaveCount(0);
    await page.locator("#before-media").focus();
    await page.keyboard.press("Tab");
    expect(await layer.evaluate((node) => (node.getRootNode() as ShadowRoot).activeElement === node)).toBe(true);
    await page.keyboard.press("Tab");
    await expect(page.locator("#after-first-media")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    expect(await layer.evaluate((node) => {
      const root = node.getRootNode();
      return root instanceof ShadowRoot &&
        root.activeElement === node &&
        document.activeElement === root.host;
    }), "Tab navigation did not return to the protected media layer").toBe(true);
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
