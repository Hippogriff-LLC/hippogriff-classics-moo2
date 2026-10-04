// Research tool: structural inventory of a local installation directory.
// Prints only structural metadata (entry counts, image dimensions, decode success) — never content.
//   node tools/research/lbx-inventory.ts <installation-dir> [--detail NAME.LBX]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLbx } from "../../src/formats/lbx.ts";
import { isProbablyImage, readImageHeader, decodeFrame } from "../../src/formats/image.ts";
import { looksLikeRecordTable } from "../../src/formats/text.ts";

const dir = process.argv[2];
if (!dir) throw new Error("usage: lbx-inventory.ts <dir> [--detail NAME]");
const detail = process.argv.includes("--detail") ? process.argv[process.argv.indexOf("--detail") + 1] : null;
let archives = 0, entries = 0, images = 0, decoded = 0, tables = 0, failures = 0;
for (const name of readdirSync(dir).sort()) {
  if (!/\.lbx$/i.test(name)) continue;
  if (detail && name.toUpperCase() !== detail.toUpperCase()) continue;
  const bytes = new Uint8Array(readFileSync(join(dir, name)));
  let lbx;
  try { lbx = parseLbx(name, bytes); } catch {
    console.log(`${name.padEnd(14)} NOT-LBX-CONTAINER magic=${Array.from(bytes.subarray(0, 4), (b) => b.toString(16).padStart(2, "0")).join("")}`);
    continue;
  }
  archives++;
  let img = 0, tab = 0, other = 0;
  for (let i = 0; i < lbx.count; i++) {
    const e = lbx.entry(i);
    entries++;
    if (isProbablyImage(e)) {
      img++; images++;
      try { decodeFrame(e, 0); decoded++; } catch { failures++; }
      if (detail) { const h = readImageHeader(e); console.log(`  ${i}: image ${h.width}x${h.height} frames=${h.frameCount} flags=0x${h.flags.toString(16)} pal=${h.paletteFirst}+${h.paletteCount}`); }
    } else if (looksLikeRecordTable(e)) { tab++; tables++; if (detail) console.log(`  ${i}: record-table ${e.length}B`); }
    else { other++; if (detail) console.log(`  ${i}: other ${e.length}B`); }
  }
  if (!detail) console.log(`${name.padEnd(14)} entries=${String(lbx.count).padStart(4)} images=${img} tables=${tab} other=${other}`);
}
console.log(`SUMMARY archives=${archives} entries=${entries} images=${images} decodedFrame0=${decoded} tables=${tables} imageDecodeFailures=${failures}`);
