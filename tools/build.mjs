#!/usr/bin/env node
// Production-style static build without third-party tooling.
// - strips TypeScript types with Node's built-in stripTypeScriptTypes
// - rewrites relative ".ts" import specifiers to ".js"
// - copies static files (html/css/svg)
// - writes dist/build-info.json
// The output is a directory of static, versionable files suitable for any static host.
import { stripTypeScriptTypes } from "node:module";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, mkdir, rm, stat } from "node:fs/promises";
import { join, relative, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name !== "ExperimentalWarning") console.warn(w);
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const OUT = join(ROOT, process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "dist");

export function rewriteSpecifiers(code) {
  // static imports/exports and dynamic import() of relative .ts modules
  return code
    .replace(/(\bfrom\s*["'])(\.{1,2}\/[^"']+)\.ts(["'])/g, "$1$2.js$3")
    .replace(/(\bimport\s*["'])(\.{1,2}\/[^"']+)\.ts(["'])/g, "$1$2.js$3")
    .replace(/(\bimport\(\s*["'])(\.{1,2}\/[^"']+)\.ts(["']\s*\))/g, "$1$2.js$3");
}

async function* walk(dir) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const STATIC_EXT = new Set([".html", ".css", ".svg", ".json", ".webmanifest", ".ico", ".png"]);

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const hash = createHash("sha256");
  let modules = 0;
  let statics = 0;
  const files = [];
  for await (const p of walk(SRC)) files.push(p);
  files.sort();
  for (const p of files) {
    const rel = relative(SRC, p);
    const ext = extname(p);
    if (ext === ".ts") {
      const src = await readFile(p, "utf8");
      let js;
      try {
        js = stripTypeScriptTypes(src, { mode: "strip" });
      } catch (err) {
        console.error(`BUILD_FAIL ${rel}: ${err.message}`);
        process.exit(1);
      }
      js = rewriteSpecifiers(js);
      const outPath = join(OUT, rel.replace(/\.ts$/, ".js"));
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, js);
      hash.update(rel).update(js);
      modules++;
    } else if (STATIC_EXT.has(ext)) {
      let buf = await readFile(p);
      // module script tags in HTML point at .ts sources during development
      if (ext === ".html") buf = Buffer.from(buf.toString("utf8").replace(/(<script[^>]*\bsrc=["'][^"']+)\.ts(["'])/g, "$1.js$2"));
      const outPath = join(OUT, rel);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, buf);
      hash.update(rel).update(buf);
      statics++;
    }
  }
  let commit = "unknown";
  try {
    commit = execFileSync("git", ["-C", ROOT, "rev-parse", "--short=12", "HEAD"], { encoding: "utf8" }).trim();
  } catch {}
  const contentHash = hash.digest("hex").slice(0, 16);
  const info = { name: "hippogriff-classics-moo2", commit, contentHash, modules, statics, builtAt: new Date().toISOString() };
  await writeFile(join(OUT, "build-info.json"), JSON.stringify(info, null, 2) + "\n");
  const s = await stat(join(OUT, "index.html")).catch(() => null);
  if (!s) {
    console.error("BUILD_FAIL missing index.html");
    process.exit(1);
  }
  console.log(`BUILD=PASS modules=${modules} statics=${statics} contentHash=${contentHash} out=${relative(ROOT, OUT)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
