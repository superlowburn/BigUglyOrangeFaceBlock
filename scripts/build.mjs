import { cp, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

const development = process.env.NODE_ENV === "development";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/popup", { recursive: true });
await mkdir("dist/options", { recursive: true });
await mkdir("dist/icons", { recursive: true });

await Promise.all([
  ["src/background/service-worker.ts", "dist/service-worker.js"],
  ["src/content/index.ts", "dist/content.js"],
  ["src/content/shadow-bridge.ts", "dist/shadow-bridge.js"],
  ["src/popup/popup.ts", "dist/popup/popup.js"],
  ["src/options/options.ts", "dist/options/options.js"],
].map(([entryPoints, outfile]) => build({
  entryPoints: [entryPoints],
  outfile,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  sourcemap: true,
  define: { __DEV__: JSON.stringify(development) },
})));

await Promise.all([
  cp("public/manifest.json", "dist/manifest.json"),
  cp("public/provider-rules.json", "dist/provider-rules.json"),
  cp("public/provider-blocked.html", "dist/provider-blocked.html"),
  cp("src/popup/popup.html", "dist/popup/popup.html"),
  cp("src/popup/popup.css", "dist/popup/popup.css"),
  cp("src/options/options.html", "dist/options/options.html"),
  cp("src/options/options.css", "dist/options/options.css"),
  cp("src/options/demo-media.svg", "dist/options/demo-media.svg"),
  cp("public/icons", "dist/icons", { recursive: true }),
]);
