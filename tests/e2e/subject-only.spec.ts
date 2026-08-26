import { chromium, expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { resolve } from "node:path";

const extensionPath = resolve("dist");
const fixtureOrigin = "http://127.0.0.1:4173";

async function launchExtension(): Promise<{
  context: BrowserContext;
  page: Page;
  worker: Worker;
  providerRequests: string[];
}> {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    viewport: { width: 900, height: 720 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  const providerRequests: string[] = [];
  await context.route("https://www.youtube.com/**", async (route) => {
    providerRequests.push(route.request().url());
    await route.fulfill({
      body: "<!doctype html><html><body>Local provider fixture</body></html>",
      contentType: "text/html",
    });
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  // The extension opens Settings once on install. Let that tab arrive and close it
  // before creating the page owned by the test.
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  await Promise.all(context.pages().map((existingPage) => existingPage.close()));
  const page = await context.newPage();
  return { context, page, worker, providerRequests };
}

async function setSubjects(worker: Worker, enabled: boolean): Promise<void> {
  await worker.evaluate((config) => chrome.storage.local.set({ "blocked-subjects": config }), {
    enabled,
    keywords: ["Trump", "Donald Trump", "Donald J. Trump"],
  });
}

test("frosts only the matching subject and supports reveal and re-frost", async () => {
  const extension = await launchExtension();
  try {
    await setSubjects(extension.worker, true);
    await extension.page.goto(`${fixtureOrigin}/blocked-subjects.html`);

    const blocked = extension.page.locator("#blocked");
    const ordinary = extension.page.locator("#ordinary");
    const frost = extension.page.locator("[data-buof-root] .buof-frost");
    await expect(blocked).toHaveAttribute("data-buof-protected", "image");
    await expect(ordinary).not.toHaveAttribute("data-buof-protected", "image");
    await expect(frost).toHaveCount(1);
    await expect.poll(async () => {
      const [target, layer] = await Promise.all([blocked.boundingBox(), frost.boundingBox()]);
      if (!target || !layer) return Number.POSITIVE_INFINITY;
      return Math.max(
        Math.abs(target.x - layer.x),
        Math.abs(target.y - layer.y),
        Math.abs(target.width - layer.width),
        Math.abs(target.height - layer.height),
      );
    }).toBeLessThanOrEqual(1);

    await extension.page.getByRole("button", { name: /Reveal blocked subject:/ }).click();
    await expect(blocked).not.toHaveAttribute("data-buof-protected", "image");
    await extension.page.getByRole("button", { name: "Frost again" }).click();
    await expect(blocked).toHaveAttribute("data-buof-protected", "image");
  } finally {
    await extension.context.close();
  }
});

test("applies subject setting changes live", async () => {
  const extension = await launchExtension();
  try {
    await setSubjects(extension.worker, false);
    await extension.page.goto(`${fixtureOrigin}/blocked-subjects.html`);
    const blocked = extension.page.locator("#blocked");
    await expect(blocked).not.toHaveAttribute("data-buof-protected", "image");

    await setSubjects(extension.worker, true);
    await expect(blocked).toHaveAttribute("data-buof-protected", "image");
    await setSubjects(extension.worker, false);
    await expect(blocked).not.toHaveAttribute("data-buof-protected", "image");
  } finally {
    await extension.context.close();
  }
});

test("protects dynamic and linked matches without touching ordinary media or navigating", async () => {
  const extension = await launchExtension();
  try {
    await setSubjects(extension.worker, true);
    await extension.page.goto(`${fixtureOrigin}/blocked-subjects.html`);
    await extension.page.evaluate(() => {
      const link = document.createElement("a");
      link.href = "/should-not-open";
      const matched = document.createElement("img");
      matched.id = "dynamic-match";
      matched.alt = "Donald Trump at a rally";
      matched.style.cssText = "display:block;width:640px;height:360px";
      link.append(matched);
      const ordinary = document.createElement("img");
      ordinary.id = "dynamic-ordinary";
      ordinary.alt = "A sailboat in fog";
      ordinary.style.cssText = "display:block;width:640px;height:360px";
      document.body.append(link, ordinary);
    });

    const matched = extension.page.locator("#dynamic-match");
    await expect(matched).toHaveAttribute("data-buof-protected", "image");
    await expect(extension.page.locator("#dynamic-ordinary"))
      .not.toHaveAttribute("data-buof-protected", "image");
    const originalUrl = extension.page.url();
    await extension.page.getByRole("button", { name: /Donald Trump at a rally/ }).click();
    expect(extension.page.url()).toBe(originalUrl);
  } finally {
    await extension.context.close();
  }
});

test("gates matched videos while releasing an ordinary provider embed", async () => {
  const extension = await launchExtension();
  try {
    await setSubjects(extension.worker, true);
    await extension.page.goto(`${fixtureOrigin}/subject-videos.html`);

    const nativeVideo = extension.page.locator("#matched-native");
    const matchedProvider = extension.page.locator("#matched-provider");
    const ordinaryProvider = extension.page.locator("#ordinary-provider");
    await expect(nativeVideo).toHaveAttribute("data-buof-protected", "video");
    await expect(matchedProvider).toHaveAttribute("data-buof-protected", "video");
    await expect(ordinaryProvider).not.toHaveAttribute("data-buof-protected", "video");
    await expect.poll(() => extension.providerRequests.some((request) =>
      new URL(request).pathname === "/embed/ordinary-weather"
    )).toBe(true);
    expect(extension.providerRequests.some((request) =>
      new URL(request).pathname === "/embed/matched-subject"
    )).toBe(false);

    await extension.page.getByRole("button", { name: /Donald Trump interview/ }).click();
    await expect.poll(() => extension.providerRequests.some((request) =>
      new URL(request).pathname === "/embed/matched-subject"
    )).toBe(true);
    expect(extension.providerRequests.every((request) =>
      !new URL(request).searchParams.has("buof_grant")
    )).toBe(true);
    await expect(matchedProvider).not.toHaveAttribute("data-buof-protected", "video");
  } finally {
    await extension.context.close();
  }
});

test("shows the new settings identity without site controls", async ({}, testInfo) => {
  const extension = await launchExtension();
  try {
    const extensionId = new URL(extension.worker.url()).host;
    await extension.page.goto(`chrome-extension://${extensionId}/options/options.html`);

    await expect(extension.page).toHaveTitle("Big Ugly Orange Face Settings");
    await expect(extension.page.locator(".brand")).toContainText("Big Ugly Orange Face");
    await expect(extension.page.getByRole("heading", { name: "Subjects to frost" })).toBeVisible();
    await expect(extension.page.getByText("Sites showing images and videos")).toHaveCount(0);
    await testInfo.attach("settings", {
      body: await extension.page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  } finally {
    await extension.context.close();
  }
});
