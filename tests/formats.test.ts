// Format decoder tests. All fixtures are synthetic and generated here; no original game bytes are used.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLbx, parseLbx, LbxError, LBX_SIGNATURE } from "../src/formats/lbx.ts";
import { decodeAllFrames, decodeFrame, encodeImage, frameToRgba, readImageHeader, isProbablyImage } from "../src/formats/image.ts";
import { decodePalette4, greyPalette, vga6to8 } from "../src/formats/palette.ts";
import { decodeDosString, decodeNulList, decodeRecordTable, encodeRecordTable, looksLikeRecordTable } from "../src/formats/text.ts";

test("LBX container round-trips synthetic entries", () => {
  const entries = [new Uint8Array([1, 2, 3]), new Uint8Array(0), new Uint8Array([9, 8, 7, 6, 5])];
  const bytes = buildLbx(entries);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint16(0, true), 3);
  assert.equal(view.getUint16(2, true), LBX_SIGNATURE);
  const a = parseLbx("TEST.LBX", bytes);
  assert.equal(a.count, 3);
  assert.deepEqual([...a.entry(0)], [1, 2, 3]);
  assert.equal(a.entrySize(1), 0);
  assert.deepEqual([...a.entry(2)], [9, 8, 7, 6, 5]);
  assert.throws(() => a.entry(3));
});

test("LBX parser rejects bad signatures and truncated data", () => {
  const bytes = buildLbx([new Uint8Array([1])]);
  const bad = bytes.slice();
  bad[2] = 0;
  assert.throws(() => parseLbx("BAD.LBX", bad), LbxError);
  assert.throws(() => parseLbx("SHORT.LBX", bytes.slice(0, 6)), LbxError);
});

test("image encoder/decoder round-trip including transparency and multiple frames", () => {
  const w = 7;
  const h = 5;
  const f0 = new Int16Array(w * h).fill(-1);
  const f1 = new Int16Array(w * h).fill(-1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x + y) % 3 === 0) f0[y * w + x] = (x * 13 + y) % 256;
  f1[0] = 200;
  f1[w * h - 1] = 17;
  const img = encodeImage(w, h, [f0, f1], 3);
  assert.ok(isProbablyImage(img));
  const hdr = readImageHeader(img);
  assert.equal(hdr.width, w);
  assert.equal(hdr.height, h);
  assert.equal(hdr.frameCount, 2);
  assert.deepEqual([...decodeFrame(img, 0).pixels], [...f0]);
  const frames = decodeAllFrames(img);
  assert.equal(frames.length, 2);
  // frames are cumulative unless they clear the canvas; the encoder writes full frames
  assert.equal(frames[1].pixels[0], 200);
  assert.equal(frames[1].pixels[w * h - 1], 17);
});

test("palette decoding expands 6-bit VGA values", () => {
  assert.equal(vga6to8(0), 0);
  assert.equal(vga6to8(63), 255);
  const raw = new Uint8Array(256 * 4);
  raw[4 * 5 + 1] = 63;
  raw[4 * 5 + 2] = 32;
  raw[4 * 5 + 3] = 0;
  const pal = decodePalette4(raw);
  assert.equal(pal[5 * 4], 255);
  assert.equal(pal[5 * 4 + 1], vga6to8(32));
  assert.equal(pal[5 * 4 + 3], 255);
  const rgba = frameToRgba({ width: 2, height: 1, pixels: new Int16Array([5, -1]) }, pal);
  assert.deepEqual([...rgba.slice(0, 4)], [255, vga6to8(32), 0, 255]);
  assert.equal(rgba[7], 0, "transparent pixel has zero alpha");
  assert.equal(greyPalette().length, 1024);
});

test("text tables decode fixed records and NUL lists", () => {
  const table = encodeRecordTable(["Alpha", "Beta", "Gamma"], 12);
  assert.ok(looksLikeRecordTable(table));
  assert.deepEqual(decodeRecordTable(table), ["Alpha", "Beta", "Gamma"]);
  const list = new TextEncoder().encode("one\0two\0\0three\0");
  assert.deepEqual(decodeNulList(list).filter(Boolean), ["one", "two", "three"]);
  assert.equal(decodeDosString(new Uint8Array([72, 105, 0, 88])), "Hi");
});
