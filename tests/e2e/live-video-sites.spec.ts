import { chromium, expect, test, type Frame, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const runLiveQa = process.env.GOGGLES_LIVE_VIDEO_QA === "1";
const extensionPath = resolve("dist");
const screenshotDir = resolve(".gstack/qa-reports/screenshots/subject-first");

const sites = [
  {
    name: "Reddit",
    slug: "reddit",
    url: "https://www.reddit.com/r/MTB/comments/1ug8hoy/loamerrr/",
  },
  { name: "CNN", slug: "cnn", url: "https://www.cnn.com/videos" },
  { name: "The New York Times", slug: "nyt", url: "https://www.nytimes.com/video" },
  { name: "Fox News", slug: "fox", url: "https://www.foxnews.com/video/6340564197112" },
  {
    name: "The Washington Post",
    slug: "washington-post",
    url: "https://www.washingtonpost.com/video/travel/what-does-a-100-hotel-in-new-york-city-get-you/2026/08/07/0dc493a8-0c91-4f10-a869-f6fd20d7ff9e_video.html",
  },
  { name: "The Wall Street Journal", slug: "wsj", url: "https://www.wsj.com/video" },
] as const;

type ProtectedVideo = {
  frame: Frame;
  target: Locator;
  kind: "native" | "provider";
};

test.describe("live-site video frosting", () => {
  test.skip(!runLiveQa, "Set GOGGLES_LIVE_VIDEO_QA=1 to run public-site acceptance tests.");
  test.describe.configure({ timeout: 90_000 });

  for (const site of sites) {
    test(`${site.name}: one-click video reveal and re-frost`, async () => {
      await mkdir(screenshotDir, { recursive: true });
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
      const extensionErrors: string[] = [];

      try {
        await (context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker"));
        const page = context.pages()[0] ?? await context.newPage();
        page.on("pageerror", (error) => {
          if (/goggles|chrome-extension/iu.test(error.message)) extensionErrors.push(error.message);
        });
        page.on("console", (message) => {
          if (message.type() === "error" && /goggles|chrome-extension/iu.test(message.text())) {
            extensionErrors.push(message.text());
          }
        });

        await navigate(page, site.url);
        await settleAndScroll(page);
        let protectedVideo = await findProtectedVideo(page);
        if (!protectedVideo && site.slug === "nyt" && await openFirstVideoStory(page)) {
          await settleAndScroll(page);
          protectedVideo = await findProtectedVideo(page);
        }

        await page.screenshot({
          path: resolve(screenshotDir, `live-${site.slug}-before.png`),
          fullPage: false,
          timeout: 5_000,
        });

        if (!protectedVideo) {
          const diagnostic = await diagnoseMissingVideo(page);
          throw new Error(`${site.name} did not expose a frostable video. ${diagnostic}`);
        }

        const { frame, target, kind } = protectedVideo;
        await target.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await expect(target).toHaveAttribute("data-eclipse-goggles-protected", "video");
        const issues: string[] = [];
        const beforeFrosts = await countOverlappingLayers(frame, target, ".eg-layer.eg-frost");
        if (beforeFrosts !== 1) {
          const overlaps = await describeOverlappingProtectedTargets(frame, target);
          issues.push(`expected 1 frost layer before reveal; found ${beforeFrosts}: ${JSON.stringify(overlaps)}`);
        }

        if (kind === "native") {
          const state = await mediaState(target);
          if (!state.paused || !state.muted) issues.push(`native video was not secured before reveal: ${JSON.stringify(state)}`);
        }

        const topLevelUrl = page.url();
        const revealSurface = await revealSurfaceForTarget(frame, target);
        let clickFailure: string | null = null;
        let clickBlockers: unknown[] = [];
        let clickRootDiagnostics: unknown[] = [];
        if (!revealSurface) {
          issues.push("protected video had no aligned reveal surface");
        } else {
          await revealSurface.evaluate((button) => {
            button.addEventListener("click", (event) => {
              button.setAttribute("data-live-click-trusted", String(event.isTrusted));
            }, { capture: true, once: true });
          });
          try {
            await revealSurface.click({ timeout: 5_000 });
          } catch (error) {
            clickFailure = error instanceof Error ? error.message : String(error);
            clickBlockers = await protectedTargetsAtPoint(frame, revealSurface);
            clickRootDiagnostics = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-eclipse-goggles-root]")]
              .filter((root) => root.closest("aside"))
              .map((root) => {
                const layer = root.shadowRoot?.querySelector<HTMLElement>(".eg-layer") ?? null;
                const rect = root.getBoundingClientRect();
                const layerRect = layer?.getBoundingClientRect();
                return {
                  pointerEvents: getComputedStyle(root).pointerEvents,
                  rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                  layerClass: layer?.className ?? null,
                  layerRect: layerRect && {
                    x: layerRect.x,
                    y: layerRect.y,
                    width: layerRect.width,
                    height: layerRect.height,
                  },
                };
              }));
          }
        }
        const revealTimeline = [];
        let elapsed = 0;
        for (const delay of [0, 50, 150, 800]) {
          await page.waitForTimeout(delay);
          elapsed += delay;
          revealTimeline.push({
            elapsed,
            protected: await target.getAttribute("data-eclipse-goggles-protected").catch(() => "detached"),
            revealSurface: Boolean(await revealSurfaceForTarget(frame, target).catch(() => null)),
            protectAgain: Boolean(await protectAgainForTarget(frame, target).catch(() => null)),
            clickTrusted: await revealSurface?.getAttribute("data-live-click-trusted").catch(() => null),
          });
        }
        const stillProtected = await target.getAttribute("data-eclipse-goggles-protected").catch(() => "detached");
        if (stillProtected !== null) {
          issues.push(`one click did not reveal the selected video: ${JSON.stringify({ revealTimeline, clickFailure, clickBlockers, clickRootDiagnostics })}`);
        }
        if (page.url() !== topLevelUrl) issues.push(`reveal activated the underlying destination: ${page.url()}`);
        const afterFrosts = await countOverlappingLayers(frame, target, ".eg-layer.eg-frost").catch(() => -1);
        if (afterFrosts !== 0) issues.push(`one click left ${afterFrosts} frost layer(s) over the video`);

        if (kind === "native" && stillProtected === null) {
          const state = await mediaState(target);
          if (!state.paused || !state.muted) issues.push(`native video started or unmuted on reveal: ${JSON.stringify(state)}`);
        }

        await page.screenshot({
          path: resolve(screenshotDir, `live-${site.slug}-after-one-click.png`),
          fullPage: false,
          timeout: 5_000,
        });

        if (stillProtected === null && afterFrosts === 0) {
          const protectAgain = await protectAgainForTarget(frame, target);
          if (!protectAgain) {
            issues.push("revealed video had no aligned Frost again control");
          } else {
            await expect(protectAgain).toBeVisible();
            await protectAgain.click({ force: true, timeout: 5_000 });
            await page.waitForTimeout(500);
            const refrosted = await target.getAttribute("data-eclipse-goggles-protected");
            if (refrosted !== "video") issues.push("Frost again did not re-frost the video");
            const refrostCount = await countOverlappingLayers(frame, target, ".eg-layer.eg-frost");
            if (refrostCount !== beforeFrosts) {
              issues.push(`re-frost changed the layer count from ${beforeFrosts} to ${refrostCount}`);
            }
          }
        }

        await page.screenshot({
          path: resolve(screenshotDir, `live-${site.slug}-refrosted.png`),
          fullPage: false,
          timeout: 5_000,
        });
        if (extensionErrors.length) issues.push(`extension errors: ${extensionErrors.join(" | ")}`);
        expect(issues, `${site.name} video-frosting acceptance failures`).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});

async function settleAndScroll(page: Page): Promise<void> {
  await page.waitForTimeout(4_000);
  for (const position of [0.25, 0.5, 0.75, 1]) {
    await page.evaluate((ratio) => {
      window.scrollTo({ top: document.documentElement.scrollHeight * ratio, behavior: "instant" });
    }, position);
    await page.waitForTimeout(1_000);
    if (await findProtectedVideo(page)) return;
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(1_000);
}

async function navigate(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("net::ERR_ABORTED")) throw error;
    await page.waitForTimeout(3_000);
    if (page.url() === "about:blank") throw error;
  }
}

async function findProtectedVideo(page: Page): Promise<ProtectedVideo | null> {
  for (const frame of page.frames()) {
    const candidates = frame.locator('[data-eclipse-goggles-protected="video"]');
    for (let index = 0; index < await candidates.count(); index += 1) {
      const target = candidates.nth(index);
      const box = await target.boundingBox().catch(() => null);
      if (!box || box.width < 160 || box.height < 90) continue;
      await target.evaluate((node) => node.setAttribute("data-goggles-live-video-target", "selected"));
      return {
        frame,
        target: frame.locator('[data-goggles-live-video-target="selected"]'),
        kind: await target.evaluate((node) => node instanceof HTMLVideoElement)
          ? "native"
          : "provider",
      };
    }
  }
  return null;
}

async function protectAgainForTarget(frame: Frame, target: Locator): Promise<Locator | null> {
  const targetBox = await target.boundingBox();
  if (!targetBox) return null;
  const buttons = frame.getByRole("button", { name: "Frost again", exact: true });
  for (let index = 0; index < await buttons.count(); index += 1) {
    const button = buttons.nth(index);
    const box = await button.boundingBox().catch(() => null);
    if (!box) continue;
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    if (
      center.x >= targetBox.x - 16 &&
      center.x <= targetBox.x + targetBox.width + 16 &&
      center.y >= targetBox.y - 16 &&
      center.y <= targetBox.y + targetBox.height + 16
    ) return button;
  }
  return null;
}

async function revealSurfaceForTarget(frame: Frame, target: Locator): Promise<Locator | null> {
  const targetBox = await target.boundingBox();
  if (!targetBox) return null;
  const buttons = frame.getByRole("button", { name: /Reveal protected media:/u });
  for (let index = 0; index < await buttons.count(); index += 1) {
    const button = buttons.nth(index);
    const box = await button.boundingBox().catch(() => null);
    if (box && overlapRatio(targetBox, box) >= 0.9) return button;
  }
  return null;
}

async function openFirstVideoStory(page: Page): Promise<boolean> {
  const href = await page.locator("a[href]").evaluateAll((anchors) => {
    for (const anchor of anchors) {
      const rawHref = anchor.getAttribute("href");
      if (!rawHref) continue;
      const candidate = new URL(rawHref, location.href);
      if (candidate.hostname.endsWith("nytimes.com") && /^\/video\/.+/u.test(candidate.pathname)) {
        return candidate.href;
      }
    }
    return null;
  });
  if (!href) return false;
  await page.goto(href, { waitUntil: "domcontentloaded", timeout: 45_000 });
  return true;
}

async function countOverlappingLayers(frame: Frame, target: Locator, selector: string): Promise<number> {
  const targetBox = await target.boundingBox();
  if (!targetBox) return 0;
  const layers = frame.locator(`[data-eclipse-goggles-root] ${selector}`);
  let overlaps = 0;
  for (let index = 0; index < await layers.count(); index += 1) {
    const layerBox = await layers.nth(index).boundingBox().catch(() => null);
    if (layerBox && overlapRatio(targetBox, layerBox) >= 0.9) overlaps += 1;
  }
  return overlaps;
}

async function describeOverlappingProtectedTargets(frame: Frame, target: Locator): Promise<unknown[]> {
  const targetBox = await target.boundingBox();
  if (!targetBox) return [];
  const candidates = frame.locator("[data-eclipse-goggles-protected]");
  const details = [];
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    const box = await candidate.boundingBox().catch(() => null);
    if (!box || overlapRatio(targetBox, box) < 0.8) continue;
    details.push(await candidate.evaluate((node) => ({
      tag: node.tagName,
      kind: node.getAttribute("data-eclipse-goggles-protected"),
      ariaLabel: node.getAttribute("aria-label"),
      alt: node.getAttribute("alt"),
      className: (node.getAttribute("class") ?? "").slice(0, 160),
      parentTag: node.parentElement?.tagName ?? null,
      parentClass: (node.parentElement?.getAttribute("class") ?? "").slice(0, 160),
      backgroundImage: getComputedStyle(node).backgroundImage.slice(0, 220),
      nearestVideoAncestor: (() => {
        let current: Element | null = node;
        for (let depth = 0; current && depth < 20; depth += 1) {
          if (current.querySelector("video")) {
            return {
              depth,
              tag: current.tagName,
              className: (current.getAttribute("class") ?? "").slice(0, 160),
            };
          }
          current = current.parentElement;
        }
        return null;
      })(),
    })));
  }
  return details;
}

async function protectedTargetsAtPoint(frame: Frame, surface: Locator): Promise<unknown[]> {
  const box = await surface.boundingBox();
  if (!box) return [];
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const candidates = frame.locator("[data-eclipse-goggles-protected]");
  const details = [];
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    const candidateBox = await candidate.boundingBox().catch(() => null);
    if (
      !candidateBox ||
      point.x < candidateBox.x || point.x > candidateBox.x + candidateBox.width ||
      point.y < candidateBox.y || point.y > candidateBox.y + candidateBox.height
    ) continue;
    details.push(await candidate.evaluate((node) => ({
      tag: node.tagName,
      kind: node.getAttribute("data-eclipse-goggles-protected"),
      alt: node.getAttribute("alt"),
      className: (node.getAttribute("class") ?? "").slice(0, 160),
    })));
  }
  return details;
}

function overlapRatio(
  target: { x: number; y: number; width: number; height: number },
  layer: { x: number; y: number; width: number; height: number },
): number {
  const width = Math.max(0, Math.min(target.x + target.width, layer.x + layer.width) - Math.max(target.x, layer.x));
  const height = Math.max(0, Math.min(target.y + target.height, layer.y + layer.height) - Math.max(target.y, layer.y));
  return (width * height) / (target.width * target.height);
}

async function mediaState(target: Locator): Promise<{ paused: boolean; muted: boolean }> {
  return target.evaluate((node) => {
    const video = node as HTMLVideoElement;
    return { paused: video.paused, muted: video.muted };
  });
}

async function diagnoseMissingVideo(page: Page): Promise<string> {
  const details = [];
  for (const frame of page.frames()) {
    const frameDetails = await frame.evaluate(() => ({
      nativeVideos: document.querySelectorAll("video").length,
      protectedVideos: document.querySelectorAll('[data-eclipse-goggles-protected="video"]').length,
      providerFrames: [...document.querySelectorAll("iframe")].filter((candidate) => {
        const source = candidate.getAttribute("src") ?? "";
        return /(?:youtube(?:-nocookie)?\.com\/embed\/|player\.vimeo\.com\/video\/)/iu.test(source);
      }).length,
      text: document.body?.innerText.slice(0, 2_000) ?? "",
    })).catch(() => null);
    if (frameDetails) details.push(frameDetails);
  }
  const text = details.map((detail) => detail.text).join(" ").toLowerCase();
  const blocker = [
    "verify you are human",
    "verification required",
    "confirm that you are human",
    "slide right to secure your access",
    "access denied",
    "captcha",
    "enable javascript",
    "subscribe to continue",
    "sign in to continue",
  ].find((phrase) => text.includes(phrase));
  const nativeVideos = details.reduce((sum, detail) => sum + detail.nativeVideos, 0);
  const protectedVideos = details.reduce((sum, detail) => sum + detail.protectedVideos, 0);
  const providerFrames = details.reduce((sum, detail) => sum + detail.providerFrames, 0);
  return [
    `final URL: ${page.url()}.`,
    `DOM totals: ${nativeVideos} native video(s), ${providerFrames} recognized provider iframe(s), ${protectedVideos} protected video(s).`,
    blocker ? `Likely blocker: \"${blocker}\".` : "No explicit access-wall text detected.",
  ].join(" ");
}
