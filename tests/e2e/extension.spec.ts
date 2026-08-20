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
const projectRoot = resolve(".");
const fixtureOrigin = "http://127.0.0.1:4173";
const protectedSelector = "[data-eclipse-goggles-protected]";
const youtubeFixtureUrl = "https://www.youtube.com/embed/eclipse-test?autoplay=1";
const vimeoFixtureUrl = "https://player.vimeo.com/video/123456789?autoplay=1";
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
  options: {
    deviceScaleFactor?: number;
    providerFixtureUrls?: readonly string[];
    providerResponseDelayMs?: number;
    unpackedPath?: string;
  } = {},
): Promise<LaunchedExtension> {
  const unpackedPath = options.unpackedPath ?? extensionPath;
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    viewport: acceptanceWindow,
    ...(options.deviceScaleFactor === undefined ? {} : { deviceScaleFactor: options.deviceScaleFactor }),
    args: [
      `--window-size=${acceptanceWindow.width},${acceptanceWindow.height}`,
      `--disable-extensions-except=${unpackedPath}`,
      `--load-extension=${unpackedPath}`,
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
  await context.route(/^https:\/\//, async (route) => {
    const url = route.request().url();
    if (isApprovedProviderFixture(url, providerFixtureUrls)) {
      providerRequests.push(url);
      if (options.providerResponseDelayMs) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, options.providerResponseDelayMs));
      }
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

function revealThisWithText(scope: Page | Frame, text: string): Locator {
  return layerWithText(scope, text).getByRole("button", { name: /Reveal protected media:/ });
}

async function revealAllWithText(scope: Page | Frame, text: string): Promise<Locator> {
  const layer = layerWithText(scope, text);
  const goggles = layer.getByRole("button", { name: "Goggles reveal options" });
  await expect(goggles).toBeVisible();
  await goggles.click({ timeout: 5_000 });
  await expect(layer.locator(".eg-menu")).toBeVisible();
  return layer.getByRole("button", {
    name: "Reveal all protected media on this page",
  });
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

async function scrollDockIntoView(target: Locator, layer: Locator): Promise<void> {
  await target.evaluate((node) => node.scrollIntoView({ block: "end" }));
  await assertAligned(target, layer);
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

test("loads the project root as an unpacked extension after building", async () => {
  const extension = await launchExtension({ unpackedPath: projectRoot });
  try {
    await extension.page.goto(`${fixtureOrigin}/article.html`);
    await expect(extension.page.locator("#first")).toHaveAttribute(
      "data-eclipse-goggles-protected",
      "image",
    );
  } finally {
    await closeExtension(extension);
  }
});

test("scales thumbnail controls, frost, and description without losing alignment", async () => {
  const extension = await launchExtension();
  const { page } = extension;
  try {
    await page.goto(`${fixtureOrigin}/responsive-media.html`);
    const target = page.locator("#target");
    await expect(target).toHaveAttribute("data-eclipse-goggles-protected", "image");
    const layer = layers(page).first();
    await assertAligned(target, layer);
    await expect(layer).toHaveClass(/eg-compact/u);
    await expect(layer.locator(".eg-caption")).toHaveClass(/eg-caption-collapsed/u);
    await expect(layer.locator(".eg-description-toggle")).toHaveText("ALT");

    await expect.poll(() => layer.evaluate((node) => {
      const goggles = node.querySelector(".eg-goggles")!;
      return {
        blur: getComputedStyle(node).backdropFilter,
        control: Math.round(goggles.getBoundingClientRect().width),
      };
    })).toEqual({ blur: "blur(12px)", control: 30 });

    await layer.locator(".eg-description-toggle").click();
    await expect(layer.locator(".eg-description")).toHaveText(/…$/u);
    await expect(layer.locator(".eg-description-more")).toHaveText("more");
    await layer.locator(".eg-description-more").click();
    await expect(layer.locator(".eg-description")).toHaveText(/for expansion$/u);

    await target.evaluate((node) => {
      Object.assign((node as HTMLElement).style, { width: "320px", height: "240px" });
    });
    await expect(layer).not.toHaveClass(/eg-compact/u);
    await expect.poll(() => layer.evaluate((node) => ({
      blur: getComputedStyle(node).backdropFilter,
      control: Math.round(node.querySelector(".eg-goggles")!.getBoundingClientRect().width),
    }))).toEqual({ blur: "blur(18px)", control: 36 });
    await assertAligned(target, layer);
  } finally {
    await closeExtension(extension);
  }
});

test("ships the real icon and first-run settings page", async () => {
  const extension = await launchExtension();
  try {
    await expect.poll(() => extension.context.pages().map((page) => page.url()))
      .toContainEqual(expect.stringContaining("/options/options.html"));
    const optionsPage = extension.context.pages().find((page) => page.url().includes("/options/options.html"))!;
    await expect(optionsPage.getByRole("heading", { name: "See it when you’re ready." })).toBeVisible();
    await expect(optionsPage.getByRole("button", { name: "Click to reveal" })).toBeVisible();
    const manifest = await extension.worker.evaluate(() => chrome.runtime.getManifest());
    expect(manifest.icons).toEqual({
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png",
    });
    await optionsPage.getByRole("button", { name: /A gentler web for kids/u }).click();
    await expect.poll(() => extension.worker.evaluate(async () =>
      (await chrome.storage.local.get("default-site-mode"))["default-site-mode"],
    )).toBe("strict");
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

    await scrollDockIntoView(page.locator("#first"), layerWithText(page, "A moonlit lake"));
    await revealThisWithText(page, "A moonlit lake").click();
    await expect(page.locator("#first")).not.toHaveAttribute("data-eclipse-goggles-protected", "image");
    await expect(page.locator("#second")).toHaveAttribute("data-eclipse-goggles-protected", "image");

    await page.locator("#second").evaluate((node) => node.scrollIntoView({ block: "start" }));
    await assertAligned(page.locator("#second"), layerWithText(page, "A red kite"));
    await (await revealAllWithText(page, "A red kite")).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#second")).not.toHaveAttribute("data-eclipse-goggles-protected", "image");
    await expect(page.locator(protectedSelector)).toHaveCount(0);
  } finally {
    await closeExtension(extension);
  }
});

test("keeps reveal controls outside linked images and button-wrapped pictures", async () => {
  const extension = await launchExtension();
  const { page } = extension;
  try {
    await page.goto(`${fixtureOrigin}/article.html`);
    await page.evaluate(() => {
      const source = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='360'%3E%3C/svg%3E";
      const link = document.createElement("a");
      link.id = "linked-wrapper";
      link.href = "/must-not-navigate";
      const linkedImage = document.createElement("img");
      linkedImage.id = "linked-image";
      linkedImage.alt = "A linked mountain image";
      linkedImage.src = source;
      linkedImage.className = "content";
      link.append(linkedImage);
      const pictureButton = document.createElement("button");
      pictureButton.id = "picture-button";
      const picture = document.createElement("picture");
      const pictureImage = document.createElement("img");
      pictureImage.id = "button-picture-image";
      pictureImage.alt = "A button wrapped picture";
      pictureImage.src = source;
      pictureImage.className = "content";
      picture.append(pictureImage);
      pictureButton.append(picture);
      (window as typeof window & { ancestorActivations: number }).ancestorActivations = 0;
      link.addEventListener("click", () => {
        (window as typeof window & { ancestorActivations: number }).ancestorActivations += 1;
      });
      pictureButton.addEventListener("click", () => {
        (window as typeof window & { ancestorActivations: number }).ancestorActivations += 1;
      });
      document.body.append(link, pictureButton);
    });
    const linked = page.locator("#linked-image");
    const pictured = page.locator("#button-picture-image");
    await expect(linked).toHaveAttribute("data-eclipse-goggles-protected", "image");
    await expect(pictured).toHaveAttribute("data-eclipse-goggles-protected", "image");
    expect(await page.evaluate(() => {
      const link = document.querySelector("#linked-wrapper")!;
      const button = document.querySelector("#picture-button")!;
      return {
        linkAdjacent: link.nextElementSibling?.hasAttribute("data-eclipse-goggles-root"),
        buttonAdjacent: button.nextElementSibling?.hasAttribute("data-eclipse-goggles-root"),
        linkNested: Boolean(link.querySelector("[data-eclipse-goggles-root]")),
        buttonNested: Boolean(button.querySelector("[data-eclipse-goggles-root]")),
      };
    })).toEqual({
      linkAdjacent: true,
      buttonAdjacent: true,
      linkNested: false,
      buttonNested: false,
    });

    const linkedReveal = layerWithText(page, "A linked mountain image");
    await scrollDockIntoView(linked, linkedReveal);
    await revealThisWithText(page, "A linked mountain image").click();
    const pictureReveal = layerWithText(page, "A button wrapped picture");
    await scrollDockIntoView(pictured, pictureReveal);
    await revealThisWithText(page, "A button wrapped picture").click();
    expect(await page.evaluate(() =>
      (window as typeof window & { ancestorActivations: number }).ancestorActivations
    )).toBe(0);
    expect(page.url()).toBe(`${fixtureOrigin}/article.html`);
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
    await page.evaluate(() => document.querySelector("#layout-spacer")?.remove());
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

    await page.evaluate(() => {
      const host = document.createElement("aside");
      host.id = "late-shadow-host";
      document.body.append(host);
      setTimeout(() => {
        const image = document.createElement("img");
        image.id = "late-shadow-image";
        image.alt = "An image in a late open shadow root";
        Object.assign(image.style, { display: "block", width: "640px", height: "360px" });
        image.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='360'%3E%3C/svg%3E";
        host.attachShadow({ mode: "open" }).append(image);
      }, 100);
    });
    await expect(page.locator("#late-shadow-host").locator("#late-shadow-image"))
      .toHaveAttribute("data-eclipse-goggles-protected", "image");
  } finally {
    await closeExtension(extension);
  }
});

test("protects dynamic media and keeps a site control available in Trusted mode", async () => {
  const extension = await launchExtension();
  const { page, worker } = extension;
  try {
    await page.goto(`${fixtureOrigin}/dynamic-feed.html`);
    await expect(page.locator("#appended-image")).toHaveAttribute("data-eclipse-goggles-protected", "image");

    await page.evaluate(() => (window as typeof window & { replaceRoute(): void }).replaceRoute());
    await expect(page.locator("#route-image")).toHaveAttribute("data-eclipse-goggles-protected", "image");

    await setMode(worker, "trusted");
    await expect(page.locator(protectedSelector)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Goggles site options" })).toHaveCount(1);

    await page.getByRole("button", { name: "Goggles site options" }).click();
    await page.getByRole("button", { name: "Frost images on this site again" }).click();
    await expect(page.locator("#route-image")).toHaveAttribute(
      "data-eclipse-goggles-protected",
      "image",
    );
    await expect(page.getByRole("button", { name: "Goggles site options" })).toHaveCount(0);
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
    await page.goForward();
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
    await scrollDockIntoView(page.locator("#strict-image"), layerWithText(page, "A lighthouse"));
    await revealThisWithText(page, "A lighthouse").click();
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

    await scrollDockIntoView(video, layerWithText(page, "A looping color field"));
    await revealThisWithText(page, "A looping color field").click();
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
  const extension = await launchExtension({
    providerFixtureUrls: videoProviderUrls,
    providerResponseDelayMs: 300,
  });
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
    await scrollDockIntoView(youtube, layers(page).filter({ has: youtubeReveal }));
    await youtubeReveal.click();
    await expect.poll(async () => ({
      requests: extension.providerRequests.length,
      rules: (await extension.worker.evaluate(
        () => chrome.declarativeNetRequest.getSessionRules(),
      )).length,
      protected: await youtube.getAttribute("data-eclipse-goggles-protected"),
    })).toEqual({ requests: 1, rules: 1, protected: null });
    expect(new URL(extension.providerRequests[0]!).pathname).toBe("/embed/eclipse-test");
    const authorized = new URL(extension.providerRequests[0]!);
    expect(authorized.searchParams.get("autoplay")).toBe("0");
    expect(authorized.searchParams.get("eg_eclipse_goggles")).toBeTruthy();
    const selectedFrame = await selectedNavigation;
    await expect(selectedFrame.locator("[data-eclipse-goggles-root]")).toHaveCount(0);
    expect(await youtube.getAttribute("src")).toBe(authorized.href);
    await expect.poll(() => extension.worker.evaluate(
      () => chrome.declarativeNetRequest.getSessionRules(),
    )).toHaveLength(1);
    await expect(page.locator("#youtube-twin")).toHaveAttribute("src", "about:blank");
    await expect(vimeo).toHaveAttribute("src", "about:blank");

    const reprotect = page.getByRole("button", { name: "Protect again", exact: true });
    await reprotect.focus();
    await reprotect.press("Enter");
    await expect(youtube).toHaveAttribute("src", "about:blank");
    await expect.poll(() => extension.worker.evaluate(
      () => chrome.declarativeNetRequest.getSessionRules(),
    )).toEqual([]);
    await page.evaluate((original) => {
      const later = document.createElement("iframe");
      later.id = "later-same-url";
      later.src = original;
      document.body.append(later);
    }, youtubeFixtureUrl);
    await page.waitForTimeout(200);
    expect(extension.providerRequests).toHaveLength(1);

  } finally {
    await closeExtension(extension);
  }
});

test("Trusted provider frame reloads its exact original source once without looping", async () => {
  const extension = await launchExtension({ providerFixtureUrls: [youtubeFixtureUrl] });
  const { page, worker } = extension;
  try {
    await setMode(worker, "trusted");
    extension.allowProviderAssets();
    await page.goto(`${fixtureOrigin}/article.html`);
    await page.evaluate((source) => {
      const frame = document.createElement("iframe");
      frame.id = "trusted-provider";
      frame.src = source;
      document.body.append(frame);
    }, youtubeFixtureUrl);
    const trustedProvider = page.locator("#trusted-provider");
    await expect(trustedProvider).toHaveAttribute("src", /eg_eclipse_goggles=/u);
    const firstSource = await trustedProvider.getAttribute("src");
    await page.waitForTimeout(500);

    expect(await trustedProvider.getAttribute("src")).toBe(firstSource);
    await trustedProvider.evaluate((frame, source) => {
      frame.setAttribute("src", source);
    }, youtubeFixtureUrl);
    await expect.poll(() => trustedProvider.getAttribute("src")).not.toBe(firstSource);
    await expect(trustedProvider).toHaveAttribute("src", /eg_eclipse_goggles=/u);
    const secondSource = await trustedProvider.getAttribute("src");
    await page.waitForTimeout(500);

    expect(secondSource).not.toBe(firstSource);
    expect(await trustedProvider.getAttribute("src")).toBe(secondSource);
  } finally {
    await closeExtension(extension);
  }
});

test("protects native video in a same-origin child while gating a provider sibling", async () => {
  const extension = await launchExtension({ providerFixtureUrls: videoProviderUrls });
  const { page } = extension;
  try {
    await page.goto(`${fixtureOrigin}/frame-host.html`);
    const nested = page.frameLocator("#same-origin");
    await expect(nested.locator("#native-video")).toHaveAttribute("data-eclipse-goggles-protected", "video");

    const provider = page.locator("#provider");
    await expect(provider).toHaveAttribute("src", "about:blank");
    expect(extension.providerRequests).toEqual([]);
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

test("has accessible goggles navigation, specified caption contrast, and only approved public attributes", async () => {
  const extension = await launchExtension();
  const { page } = extension;
  try {
    await page.goto(`${fixtureOrigin}/article.html`);
    const layer = layerWithText(page, "A moonlit lake");
    await expect(page.getByRole("button", {
      name: "Reveal protected media: A moonlit lake beside dark hills",
      exact: true,
    })).toHaveCount(1);
    await expect(layer.locator("button")).toHaveCount(7);
    const revealThis = layer.getByRole("button", {
      name: "Reveal protected media: A moonlit lake beside dark hills",
      exact: true,
    });
    const goggles = layer.getByRole("button", { name: "Goggles reveal options" });
    const descriptionToggle = layer.locator(".eg-description-toggle");
    const revealMenuItem = layer.locator(".eg-menu-reveal");
    const revealAll = layer.getByRole("button", {
      name: "Reveal all protected media on this page",
      exact: true,
    });
    const allowSite = layer.getByRole("button", {
      name: "Always show visual media on this site",
      exact: true,
    });
    const settings = layer.getByRole("button", { name: "Open Goggles settings" });
    await page.locator("#before-media").focus();
    await page.keyboard.press("Tab");
    expect(await revealThis.evaluate((node) => (node.getRootNode() as ShadowRoot).activeElement === node)).toBe(true);
    await page.keyboard.press("Tab");
    expect(await descriptionToggle.evaluate((node) => (node.getRootNode() as ShadowRoot).activeElement === node)).toBe(true);
    await page.keyboard.press("Enter");
    await expect(descriptionToggle).toHaveAttribute("aria-label", "Show description");
    await expect(layer.locator(".eg-caption")).toHaveClass(/eg-caption-collapsed/u);
    await page.keyboard.press("Enter");
    await expect(descriptionToggle).toHaveAttribute("aria-label", "Hide description");
    await page.keyboard.press("Tab");
    expect(await goggles.evaluate((node) => (node.getRootNode() as ShadowRoot).activeElement === node)).toBe(true);
    await page.keyboard.press("Enter");
    await expect(layer.locator(".eg-menu")).toBeVisible();
    await page.keyboard.press("Tab");
    expect(await revealMenuItem.evaluate((node) => (node.getRootNode() as ShadowRoot).activeElement === node)).toBe(true);
    await page.keyboard.press("Tab");
    expect(await revealAll.evaluate((node) => (node.getRootNode() as ShadowRoot).activeElement === node)).toBe(true);
    await page.keyboard.press("Tab");
    expect(await allowSite.evaluate((node) => (node.getRootNode() as ShadowRoot).activeElement === node)).toBe(true);
    await page.keyboard.press("Tab");
    expect(await settings.evaluate((node) => (node.getRootNode() as ShadowRoot).activeElement === node)).toBe(true);
    await page.keyboard.press("Tab");
    await expect(page.locator("#after-first-media")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    expect(await settings.evaluate((node) => {
      const root = node.getRootNode();
      return root instanceof ShadowRoot &&
        root.activeElement === node &&
        document.activeElement === root.host;
    }), "Tab navigation did not return to Goggles settings").toBe(true);
    const presentation = await layer.evaluate((node) => {
      const focusedStyle = getComputedStyle(node.querySelector(".eg-menu-brand")!);
      const captionStyle = getComputedStyle(node.querySelector(".eg-caption")!);
      return {
        outlineColor: focusedStyle.outlineColor,
        outlineWidth: focusedStyle.outlineWidth,
        color: captionStyle.color,
        background: captionStyle.backgroundColor,
        gogglesWidth: Math.round(node.querySelector(".eg-goggles")!.getBoundingClientRect().width),
        gogglesHeight: Math.round(node.querySelector(".eg-goggles")!.getBoundingClientRect().height),
      };
    });
    expect(presentation).toEqual({
      outlineColor: "rgb(255, 255, 255)",
      outlineWidth: "2px",
      color: "rgb(255, 255, 255)",
      background: "rgba(31, 33, 35, 0.76)",
      gogglesWidth: 44,
      gogglesHeight: 44,
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
