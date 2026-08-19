import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("extension manifest", () => {
  const manifest = JSON.parse(readFileSync("public/manifest.json", "utf8"));

  it("loads the content script at document_start in every frame", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.content_scripts[0]).toMatchObject({
      matches: ["http://*/*", "https://*/*"],
      js: ["content.js"],
      run_at: "document_start",
      all_frames: true,
      match_about_blank: true,
      match_origin_as_fallback: true,
    });
  });

  it("requests only the agreed permissions", () => {
    expect(manifest.permissions.sort()).toEqual(["activeTab", "storage"].sort());
    expect(manifest.host_permissions).toEqual(["http://*/*", "https://*/*"]);
  });
});
