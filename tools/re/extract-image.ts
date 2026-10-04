#!/usr/bin/env node
// Research helper: load an original Orion2.exe (LE + Watcom debug info) and write the relocated object
// images, the fixup list and the symbol table into a PRIVATE scratch directory outside the repository.
// The outputs are derived from proprietary program bytes and must never be committed.
//
//   node tools/re/extract-image.ts <path/to/Orion2.exe> <scratch-dir>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadLe } from "../../src/recomp/le.ts";
import { readWatcomDebugInfo } from "../../src/recomp/watcomdbg.ts";

const [exe, outDir] = process.argv.slice(2);
if (!exe || !outDir) {
  console.error("usage: extract-image.ts <Orion2.exe> <scratch-dir>");
  process.exit(2);
}
const repo = resolve(import.meta.dirname, "../..");
if (resolve(outDir).startsWith(repo + "/")) {
  console.error("refusing to write derived proprietary material inside the repository");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const file = new Uint8Array(readFileSync(exe));
const img = loadLe(file);
const dbg = readWatcomDebugInfo(file);
for (const o of img.objects) writeFileSync(join(outDir, `obj${o.index}.bin`), o.bytes.subarray(0, o.virtualSize));
writeFileSync(
  join(outDir, "fixups.tsv"),
  img.fixups.map((f) => `${f.source.toString(16)}\t${f.target.toString(16)}`).join("\n") + "\n",
);
const lines = [`# addr\tseg\tkind\tmodule\tname`];
if (dbg) {
  for (const g of dbg.globals) {
    const base = img.objects[g.segment - 1].base;
    lines.push(`${(base + g.offset).toString(16)}\t${g.segment}\t${g.kind}\t${dbg.modules[g.module]?.name ?? "?"}\t${g.name}`);
  }
  writeFileSync(
    join(outDir, "ranges.tsv"),
    dbg.ranges
      .map((r) => `${(img.objects[r.segment - 1].base + r.offset).toString(16)}\t${r.size.toString(16)}\t${dbg.modules[r.module]?.name ?? "?"}`)
      .join("\n") + "\n",
  );
}
writeFileSync(join(outDir, "symbols.tsv"), lines.join("\n") + "\n");
writeFileSync(
  join(outDir, "image.json"),
  JSON.stringify({ entry: img.entryEip, esp: img.initialEsp, objects: img.objects.map((o) => ({ index: o.index, base: o.base, size: o.virtualSize, flags: o.flags })) }, null, 1),
);
console.log(`objects=${img.objects.length} fixups=${img.fixups.length} symbols=${dbg?.globals.length ?? 0}`);
