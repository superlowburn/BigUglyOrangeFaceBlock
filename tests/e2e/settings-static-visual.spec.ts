import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("captures the closed desktop and open mobile matching-word editor", async ({ page }, testInfo) => {
  await page.setContent(await readFile("src/options/options.html", "utf8"));
  await page.addStyleTag({ path: "src/options/options.css" });

  const editor = page.locator(".keyword-editor");
  await page.setViewportSize({ width: 900, height: 650 });
  await expect(editor).not.toHaveAttribute("open", "");
  await testInfo.attach("settings-keywords-closed-desktop", {
    body: await editor.screenshot(),
    contentType: "image/png",
  });

  await page.setViewportSize({ width: 375, height: 812 });
  await editor.locator("summary").click();
  await editor.locator("textarea").fill("Donald Trump\nDonald J. Trump\nPresident Trump\nTrump");
  await expect(editor).toHaveAttribute("open", "");
  await testInfo.attach("settings-keywords-open-mobile", {
    body: await editor.screenshot(),
    contentType: "image/png",
  });
});
