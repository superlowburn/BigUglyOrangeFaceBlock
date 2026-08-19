import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const port = 4173;
const fixtureRoot = fileURLToPath(new URL("./fixtures/", import.meta.url));
const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

createServer(async (request, response) => {
  const rawPath = request.url?.split("?", 1)[0] ?? "/";
  let pathname;
  try {
    pathname = decodeURIComponent(rawPath);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }

  if (pathname.split("/").includes("..")) {
    response.writeHead(400).end("Bad request");
    return;
  }

  const relativePath = pathname === "/" ? "article.html" : pathname.replace(/^\/+/, "");
  const filePath = resolve(fixtureRoot, relativePath);
  if (!filePath.startsWith(`${resolve(fixtureRoot)}${sep}`)) {
    response.writeHead(400).end("Bad request");
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not a file");
    response.writeHead(200, {
      "content-type": types.get(extname(filePath)) ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(port, host);
