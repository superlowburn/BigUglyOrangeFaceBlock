import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("extension icon assets", () => {
  it("uses the settings-page two-lens mark at every Chrome icon size", async () => {
    const [settings, iconSource] = await Promise.all([
      readFile("src/options/options.html", "utf8"),
      readFile("public/icons/icon.svg", "utf8"),
    ]);
    const markPath = 'M4 10 11 4h15l3 7v11l-5 6H11l-7-7V10Zm56 0-7-6H38l-3 7v11l5 6h13l7-7V10Z';

    expect(settings).toContain(markPath);
    expect(iconSource).toContain(markPath);

    for (const size of [16, 32, 48, 128]) {
      const png = await readFile(`public/icons/icon${size}.png`);
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
    }
  });
});
