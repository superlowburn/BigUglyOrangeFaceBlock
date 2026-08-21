import { chromium, expect, test } from "@playwright/test";
import { resolve } from "node:path";

const extensionPath = resolve("dist");
const origin = "http://127.0.0.1:4173";

test("keeps a blocked subject frosted on an otherwise Trusted site", async () => {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    viewport: { width: 900, height: 700 },
    args: [
      "--window-size=900,700",
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
    await expect(page.getByRole("button", { name: "Goggles site options" })).toHaveCount(1);
    await page.getByRole("button", { name: "Goggles reveal options" }).click();
    await expect(page.getByRole("button", { name: "Always show visual media on this site" }))
      .toHaveCount(0);

    const opened = context.waitForEvent("page");
    await page.getByRole("button", { name: "Open Custom Goggles settings" }).click();
    const options = await opened;
    await expect(options.getByRole("heading", { name: "Blocked subjects" })).toBeVisible();
    await expect(options.locator("#blocked-subjects-enabled")).toBeChecked();
    await expect(options.locator("#blocked-subject-keywords")).toHaveValue(/Donald J\. Trump/u);
  } finally {
    await context.close();
  }
});
