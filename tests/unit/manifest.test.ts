import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("extension manifest", () => {
  const manifest = JSON.parse(readFileSync("public/manifest.json", "utf8"));

  it("loads the content script at document_start in every frame", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.content_scripts).toEqual([
      expect.objectContaining({
        matches: ["http://*/*", "https://*/*"],
        js: ["shadow-bridge.js"],
        run_at: "document_start",
        world: "MAIN",
        all_frames: true,
        match_about_blank: true,
        match_origin_as_fallback: true,
      }),
      expect.objectContaining({
      matches: ["http://*/*", "https://*/*"],
      js: ["content.js"],
      run_at: "document_start",
      all_frames: true,
      match_about_blank: true,
      match_origin_as_fallback: true,
      }),
    ]);
  });

  it("requests only the agreed permissions", () => {
    expect(manifest.permissions.sort()).toEqual([
      "activeTab",
      "declarativeNetRequestWithHostAccess",
      "storage",
      "webNavigation",
    ].sort());
    expect(manifest.host_permissions).toEqual([
      "https://www.youtube.com/*",
      "https://www.youtube-nocookie.com/*",
      "https://player.vimeo.com/*",
    ]);
  });

  it("loads the browser-level provider pre-request block rules", () => {
    const rules = JSON.parse(readFileSync("public/provider-rules.json", "utf8"));
    expect(manifest.declarative_net_request.rule_resources).toEqual([{
      id: "provider_pre_request_gate",
      enabled: true,
      path: "provider-rules.json",
    }]);
    expect(rules).toEqual([
      {
        id: 1,
        priority: 1,
        action: { type: "redirect", redirect: { extensionPath: "/provider-blocked.html" } },
        condition: {
          regexFilter: "^https://www\\.youtube\\.com/embed/[^/?#]+(?:[?#].*)?$",
          resourceTypes: ["sub_frame"],
        },
      },
      {
        id: 2,
        priority: 1,
        action: { type: "redirect", redirect: { extensionPath: "/provider-blocked.html" } },
        condition: {
          regexFilter: "^https://www\\.youtube-nocookie\\.com/embed/[^/?#]+(?:[?#].*)?$",
          resourceTypes: ["sub_frame"],
        },
      },
      {
        id: 3,
        priority: 1,
        action: { type: "redirect", redirect: { extensionPath: "/provider-blocked.html" } },
        condition: {
          regexFilter: "^https://player\\.vimeo\\.com/video/[^/?#]+(?:[?#].*)?$",
          resourceTypes: ["sub_frame"],
        },
      },
    ]);
  });
});
