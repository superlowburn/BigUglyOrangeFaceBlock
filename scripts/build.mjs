import { cp, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

const development = process.env.NODE_ENV === "development";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/popup", { recursive: true });

await Promise.all([
  ["src/background/service-worker.ts", "dist/service-worker.js"],
  ["src/content/index.ts", "dist/content.js"],
  ["src/popup/popup.ts", "dist/popup/popup.js"],
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
]);
