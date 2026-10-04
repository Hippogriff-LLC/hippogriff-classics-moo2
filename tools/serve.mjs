#!/usr/bin/env node
// Local static/dev server. Loopback (or an explicit non-wildcard address) only.
//
//   node tools/serve.mjs --mode dev                 serve src/ with on-the-fly TS type stripping
//   node tools/serve.mjs --mode dist                serve the production build in dist/
//   --host 127.0.0.1 --port 3180                    defaults: 127.0.0.1 and the Unity1 canonical port
//   --dev-install <dir>                             DEVELOPMENT ONLY: expose a local original installation
//                                                   directory to the in-browser importer at /__dev_install/.
//                                                   Files are streamed to the browser on request; nothing is
//                                                   copied into the repository or the build output.
//   --dev-build <dir>                               DEVELOPMENT ONLY: expose a private build of the recompiled
//                                                   program (moo2.wasm, image.bin, entry.txt from
//                                                   runtime/wasm.mk) at /__dev_build/. It is derived from the
//                                                   user's own Orion2.exe and must live outside the repository.
//
// Every response carries COOP/COEP so the page is cross-origin isolated: the port's worker needs
// SharedArrayBuffer. Static hosts serving dist/ must send the same two headers.
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join, resolve, extname, sep, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";
import { execFileSync } from "node:child_process";

process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name !== "ExperimentalWarning") console.warn(w);
});

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};

const mode = opt("mode", "dev");
const host = opt("host", process.env.HOST || "127.0.0.1");
let port = Number(opt("port", process.env.PORT || 0));
if (!port) {
  try {
    port = Number(execFileSync("csjs-dev-port", ["get", "hippogriff-classics-moo2", "web"], { encoding: "utf8" }).trim());
  } catch {
    port = 3180;
  }
}
if (["0.0.0.0", "::", "[::]", "", "*"].includes(host)) {
  console.error(`REFUSED: wildcard bind address '${host}' is not permitted; use 127.0.0.1 or a specific interface address.`);
  process.exit(2);
}
const devInstallArg = opt("dev-install", process.env.HIPPOGRIFF_DEV_INSTALL || "");
const devInstall = devInstallArg ? resolve(devInstallArg) : null;
const devBuildArg = opt("dev-build", process.env.HIPPOGRIFF_DEV_BUILD || "");
const devBuild = devBuildArg ? resolve(devBuildArg) : null;
const BUILD_FILES = ["moo2.wasm", "image.bin", "entry.txt"];
if ((devInstall || devBuild) && mode !== "dev") {
  console.error("REFUSED: --dev-install and --dev-build are only available in --mode dev");
  process.exit(2);
}
if (devBuild && within(ROOT, devBuild)) {
  console.error("REFUSED: --dev-build must be outside the repository (the build is derived from the user's executable)");
  process.exit(2);
}
const base = mode === "dist" ? join(ROOT, "dist") : join(ROOT, "src");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function within(root, p) {
  const r = resolve(root);
  const q = resolve(p);
  return q === r || q.startsWith(r + sep);
}

async function listInstall() {
  const out = [];
  for (const ent of await readdir(devInstall, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    const s = await stat(join(devInstall, ent.name));
    out.push({ name: ent.name, size: s.size });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let path = decodeURIComponent(url.pathname);
    const headers = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
    };
    if (path.startsWith("/__dev_build/")) {
      const name = path.slice("/__dev_build/".length);
      if (!devBuild) {
        res.writeHead(name === "index.json" ? 204 : 404, headers).end();
        return;
      }
      if (name === "index.json") {
        const files = [];
        for (const f of BUILD_FILES) if (await stat(join(devBuild, f)).catch(() => null)) files.push(f);
        res.writeHead(200, { ...headers, "Content-Type": MIME[".json"] }).end(JSON.stringify({ files }));
        return;
      }
      if (!BUILD_FILES.includes(name)) {
        res.writeHead(404, headers).end("not found");
        return;
      }
      const fp = join(devBuild, name);
      const s = await stat(fp).catch(() => null);
      if (!s?.isFile()) {
        res.writeHead(404, headers).end("not found");
        return;
      }
      const type = name.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
      res.writeHead(200, { ...headers, "Content-Type": type, "Content-Length": s.size });
      createReadStream(fp).pipe(res);
      return;
    }
    if (path.startsWith("/__dev_install/")) {
      if (!devInstall) {
        // 204 rather than 404 so the dev client's availability probe stays quiet in the console
        res.writeHead(path === "/__dev_install/index.json" ? 204 : 404, headers).end();
        return;
      }
      if (path === "/__dev_install/index.json") {
        const files = await listInstall();
        res.writeHead(200, { ...headers, "Content-Type": MIME[".json"] }).end(JSON.stringify({ files }));
        return;
      }
      const name = basename(path.slice("/__dev_install/files/".length));
      const fp = join(devInstall, name);
      if (!path.startsWith("/__dev_install/files/") || !within(devInstall, fp)) {
        res.writeHead(400, headers).end("bad path");
        return;
      }
      const s = await stat(fp).catch(() => null);
      if (!s || !s.isFile()) {
        res.writeHead(404, headers).end("not found");
        return;
      }
      // ranged reads let the port's worker stream the installation instead of loading all of it
      const range = /^bytes=(\d+)-(\d+)?$/.exec(req.headers.range ?? "");
      if (range) {
        const start = Number(range[1]);
        const end = Math.min(range[2] === undefined ? s.size - 1 : Number(range[2]), s.size - 1);
        if (start > end) {
          res.writeHead(416, { ...headers, "Content-Range": `bytes */${s.size}` }).end();
          return;
        }
        res.writeHead(206, {
          ...headers,
          "Content-Type": "application/octet-stream",
          "Content-Length": end - start + 1,
          "Content-Range": `bytes ${start}-${end}/${s.size}`,
        });
        createReadStream(fp, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { ...headers, "Content-Type": "application/octet-stream", "Content-Length": s.size, "Accept-Ranges": "bytes" });
      createReadStream(fp).pipe(res);
      return;
    }
    if (path.endsWith("/")) path += "index.html";
    const fp = join(base, path);
    if (!within(base, fp)) {
      res.writeHead(400, headers).end("bad path");
      return;
    }
    const s = await stat(fp).catch(() => null);
    if (!s || !s.isFile()) {
      res.writeHead(404, { ...headers, "Content-Type": "text/plain" }).end("not found");
      return;
    }
    const ext = extname(fp);
    if (ext === ".ts" && mode === "dev") {
      const src = await readFile(fp, "utf8");
      let js;
      try {
        js = stripTypeScriptTypes(src, { mode: "strip" });
      } catch (err) {
        res.writeHead(500, { ...headers, "Content-Type": "text/plain" }).end(`type strip failed: ${err.message}`);
        return;
      }
      res.writeHead(200, { ...headers, "Content-Type": MIME[".ts"] }).end(js);
      return;
    }
    res.writeHead(200, { ...headers, "Content-Type": MIME[ext] || "application/octet-stream" });
    createReadStream(fp).pipe(res);
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
});

server.listen(port, host, () => {
  console.log(`SERVE mode=${mode} url=http://${host.includes(":") ? `[${host}]` : host}:${port}/ devInstall=${devInstall ? "enabled" : "disabled"} devBuild=${devBuild ? "enabled" : "disabled"}`);
});
