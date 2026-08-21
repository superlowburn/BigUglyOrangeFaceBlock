import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("extension icon assets", () => {
  it("uses the settings-page two-lens mark at every Chrome icon size", async () => {
    const [settings, iconSource] = await Promise.all([
      readFile("src/options/options.html", "utf8"),
      readFile("public/icons/icon.svg", "utf8"),
    ]);
    const markPath = 'M16 29v-5C16 13 23 7 32 7s16 6 16 17v5c4 1 6 4 6 8s-2 7-6 8v4c0 6-7 10-16 10S16 55 16 49v-4c-4-1-6-4-6-8s2-7 6-8Z';

    expect(settings).toContain(markPath);
    expect(iconSource).toContain(markPath);

    for (const size of [16, 32, 48, 128]) {
      const png = await readFile(`public/icons/icon${size}.png`);
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
    }
  });
});
