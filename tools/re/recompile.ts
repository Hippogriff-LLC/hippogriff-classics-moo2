// Statically recompile a user-supplied Orion2.exe into portable C plus an initial memory image.
//
//   node tools/re/recompile.ts <Orion2.exe> <private-output-dir>
//
// The output is a mechanical translation of the original program and of its data object, so it is
// private, per-user build output. It is refused inside the repository tree.

import { readFileSync, writeFileSync, mkdirSync, realpathSync, existsSync } from "node:fs";
import { resolve, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLe } from "../../src/recomp/le.ts";
import { readWatcomDebugInfo } from "../../src/recomp/watcomdbg.ts";
import { analyze, type Sym } from "../../src/recomp/analyze.ts";
import { emitProgram } from "../../src/recomp/emit-c.ts";
import { HLE_OVERRIDES, GUEST_LAYOUT } from "../../src/recomp/layout.ts";

const [exePath, outArg] = process.argv.slice(2);
if (!exePath || !outArg) {
  console.error("usage: node tools/re/recompile.ts <Orion2.exe> <private-output-dir>");
  process.exit(2);
}
const repo = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
mkdirSync(outArg, { recursive: true });
const out = realpathSync(outArg);
if (out === repo || out.startsWith(repo + sep)) {
  console.error("refusing to write recompiled program material inside the repository");
  process.exit(2);
}

const exe = readFileSync(exePath);
const image = loadLe(exe, GUEST_LAYOUT.objectBases);
const dbg = readWatcomDebugInfo(exe);
if (!dbg) throw new Error("no Watcom debug information: this tool targets the symbol-bearing v1.31 executable");
const syms: Sym[] = dbg.globals.map((g) => ({
  addr: image.objects[g.segment - 1].base + g.offset,
  name: g.name,
  module: dbg.modules[g.module]?.name ?? "",
  code: g.segment === 1 && (g.kind & 4) !== 0,
}));
const extraPath = resolve(out, "extra-entries.txt");
const extra = existsSync(extraPath)
  ? readFileSync(extraPath, "utf8").split(/\s+/).filter(Boolean).map((x) => parseInt(x, 16))
  : [];
const t0 = Date.now();
const prog = analyze(image, syms, { extraEntries: extra });
console.log(`analyzed ${prog.funcs.size} functions in ${Date.now() - t0} ms`);
const files = emitProgram(prog, { overrides: HLE_OVERRIDES, functionsPerFile: 250 });
mkdirSync(resolve(out, "gen"), { recursive: true });
for (const f of files) writeFileSync(resolve(out, "gen", f.name), f.text);

// Initial memory image: [u32 count] then per object [u32 base][u32 size][bytes]
const parts: Buffer[] = [];
const hdr = Buffer.alloc(4);
hdr.writeUInt32LE(image.objects.length);
parts.push(hdr);
for (const o of image.objects) {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(o.base, 0);
  h.writeUInt32LE(o.virtualSize, 4);
  parts.push(h, Buffer.from(o.bytes.subarray(0, o.virtualSize)));
}
writeFileSync(resolve(out, "image.bin"), Buffer.concat(parts));
// Symbol map for the runtime's diagnostics: address, name (data and code)
writeFileSync(
  resolve(out, "symbols.txt"),
  syms
    .sort((a, b) => a.addr - b.addr)
    .map((s) => `${s.addr.toString(16)} ${s.code ? "T" : "D"} ${s.name}`)
    .join("\n") + "\n",
);
writeFileSync(
  resolve(out, "entry.txt"),
  `${image.entryEip.toString(16)} ${image.initialEsp.toString(16)}\n`,
);
console.log(`wrote ${files.length} files to ${out}`);
