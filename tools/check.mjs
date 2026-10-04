#!/usr/bin/env node
// Static sanity checks without third-party tooling:
//  1. every module under src/ (except the DOM and worker entry points) links and evaluates in Node,
//     which catches missing exports, bad import paths and non-erasable TypeScript syntax;
//  2. relative imports carry an explicit .ts extension (required by the build rewrite);
//  3. no source file embeds large base64/hex blobs (guard against smuggled binary content).
import { readdir, readFile } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name !== "ExperimentalWarning") console.warn(w);
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const SKIP_EVAL = new Set(["main.ts", join("port", "main.ts"), join("port", "worker.ts")]);

async function* walk(dir) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const problems = [];
let modules = 0;
for await (const p of walk(SRC)) {
  if (!p.endsWith(".ts")) continue;
  const rel = relative(SRC, p);
  const code = await readFile(p, "utf8");
  for (const m of code.matchAll(/\bfrom\s*["'](\.{1,2}\/[^"']+)["']/g)) {
    if (!m[1].endsWith(".ts")) problems.push(`${rel}: relative import without .ts extension: ${m[1]}`);
  }
  if (/[A-Za-z0-9+/]{400,}={0,2}/.test(code) || /(?:\\x[0-9a-fA-F]{2}){64,}/.test(code)) problems.push(`${rel}: contains a long encoded blob`);
  if (SKIP_EVAL.has(rel)) continue;
  try {
    await import(pathToFileURL(p).href);
    modules++;
  } catch (err) {
    problems.push(`${rel}: ${err.message.split("\n")[0]}`);
  }
}
if (problems.length) {
  for (const x of problems) console.error(`CHECK_FAIL ${x}`);
  process.exit(1);
}
console.log(`CHECK=PASS modules=${modules}`);
