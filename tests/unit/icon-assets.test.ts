import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("extension icon assets", () => {
  it("uses one orange block and red cross logo at every Chrome icon size", async () => {
    const [settings, iconSource] = await Promise.all([
      readFile("src/options/options.html", "utf8"),
      readFile("public/icons/icon.svg", "utf8"),
    ]);
    expect(settings).toContain('src="../icons/icon.svg"');
    expect(iconSource).toContain('fill="#f28c28"');
    expect(iconSource.match(/stroke="#b32025"/gu)).toHaveLength(2);

    for (const size of [16, 32, 48, 128]) {
      const png = await readFile(`public/icons/icon${size}.png`);
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
    }
  });
});
