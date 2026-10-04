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
if (devInstall && mode !== "dev") {
  console.error("REFUSED: --dev-install is only available in --mode dev");
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
    };
    if (path.startsWith("/__dev_install/")) {
      if (!devInstall) {
        res.writeHead(404, headers).end("dev install not enabled");
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
      res.writeHead(200, { ...headers, "Content-Type": "application/octet-stream", "Content-Length": s.size });
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
  console.log(`SERVE mode=${mode} url=http://${host.includes(":") ? `[${host}]` : host}:${port}/ devInstall=${devInstall ? "enabled" : "disabled"}`);
});
