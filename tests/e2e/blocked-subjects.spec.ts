import { chromium, expect, test } from "@playwright/test";
import { resolve } from "node:path";

const extensionPath = resolve("dist");
const origin = "http://127.0.0.1:4173";

test("applies popup-equivalent site and subject changes live without reloading", async () => {
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
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await worker.evaluate(async ({ siteOrigin }) => chrome.storage.local.set({
      [`site-policy:${siteOrigin}`]: "protected",
      "blocked-subjects": {
        enabled: true,
        keywords: ["Donald Trump", "Donald J. Trump", "President Trump", "Trump"],
      },
    }), { siteOrigin: origin });
    await expect.poll(() => context.pages().some((candidate) =>
      candidate.url().includes("/options/options.html"))).toBe(true);
    for (const candidate of context.pages()) {
      if (candidate.url().includes("/options/options.html")) await candidate.close();
    }
    const page = await context.newPage();
    await page.goto(`${origin}/blocked-subjects.html`);
    const fixtureUrl = page.url();
    const blockedReveal = page.getByRole("button", { name: /Reveal blocked subject:/u });
    const ordinaryReveal = page.getByRole("button", { name: /Reveal protected media:/u });
    await expect(blockedReveal).toHaveCount(1);
    await expect(ordinaryReveal).toHaveCount(1);

    // Popup unit coverage proves the real switch sends this exact storage-backed
    // transition and rolls back on failure. This loaded-extension assertion owns
    // the no-refresh content integration without relying on toolbar automation.
    await worker.evaluate(async ({ siteOrigin }) => chrome.storage.local.set({
      [`site-policy:${siteOrigin}`]: "trusted",
    }), { siteOrigin: origin });
    await expect(page.locator("#ordinary")).not.toHaveAttribute(
      "data-eclipse-goggles-protected",
      "image",
    );
    await expect(page.locator("#blocked")).toHaveAttribute(
      "data-eclipse-goggles-protected",
      "image",
    );
    await expect(blockedReveal).toHaveCount(1);
    await expect(ordinaryReveal).toHaveCount(0);
    expect(page.url()).toBe(fixtureUrl);

    const openedOptions = context.waitForEvent("page");
    await worker.evaluate(() => chrome.runtime.openOptionsPage());
    const options = await openedOptions;
    const subjectToggle = options.locator("#blocked-subjects-enabled");
    await expect(subjectToggle).toBeChecked();
    await subjectToggle.uncheck();
    await expect(options.locator("#blocked-subjects-status")).toHaveText("Saved locally");
    await expect(blockedReveal).toHaveCount(0);
    expect(page.url()).toBe(fixtureUrl);

    await subjectToggle.check();
    await expect(blockedReveal).toHaveCount(1);
    expect(page.url()).toBe(fixtureUrl);

    await options.close();
    await worker.evaluate(async ({ siteOrigin }) => chrome.storage.local.set({
      [`site-policy:${siteOrigin}`]: "protected",
    }), { siteOrigin: origin });
    await expect(page.locator("#ordinary")).toHaveAttribute(
      "data-eclipse-goggles-protected",
      "image",
    );
    await expect(blockedReveal).toHaveCount(1);
    await expect(ordinaryReveal).toHaveCount(1);
    expect(page.url()).toBe(fixtureUrl);
  } finally {
    await context.close();
  }
});

test("keeps a blocked subject frosted on an otherwise Trusted site", async () => {
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
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await worker.evaluate(async ({ siteOrigin }) => chrome.storage.local.set({
      [`site-policy:${siteOrigin}`]: "trusted",
      "blocked-subjects": {
        enabled: true,
        keywords: ["Donald Trump", "Donald J. Trump", "President Trump", "Trump"],
      },
    }), { siteOrigin: origin });
    await expect.poll(() => context.pages().some((candidate) =>
      candidate.url().includes("/options/options.html"))).toBe(true);
    for (const candidate of context.pages()) {
      if (candidate.url().includes("/options/options.html")) await candidate.close();
    }
    const page = await context.newPage();
    await page.goto(`${origin}/blocked-subjects.html`);

    await expect(page.locator("#blocked")).toHaveAttribute(
      "data-eclipse-goggles-protected",
      "image",
    );
    await expect(page.locator("#ordinary")).not.toHaveAttribute(
      "data-eclipse-goggles-protected",
      "image",
    );
    await expect(page.getByRole("button", { name: /Reveal blocked subject:/u })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Goggles site options" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Goggles reveal options" })).toHaveCount(0);

    const opened = context.waitForEvent("page");
    await worker.evaluate(() => chrome.runtime.openOptionsPage());
    const options = await opened;
    await expect(options.locator("#blocked-subjects-heading")).toBeVisible();
    await expect(options.locator("#blocked-subjects-enabled")).toBeChecked();
    await expect(options.locator("#blocked-subject-keywords")).toHaveValue(/Donald J\. Trump/u);
  } finally {
    await context.close();
  }
});
