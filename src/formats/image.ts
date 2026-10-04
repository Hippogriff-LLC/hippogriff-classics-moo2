// LBX image (sprite/animation) decoder.
// Format notes: docs/research/formats/LBX.md (independently authored).
//
// Header (12 bytes):  u16 width, u16 height, u16 reserved, u16 frameCount, u16 frameDelay, u16 flags
// u32 frameOffsets[frameCount + 1]   relative to the start of the entry
// if (flags & 0x1000): embedded palette block: u16 firstColor, u16 colorCount, colorCount x [flag,r,g,b]
// Frame stream:
//   u16 mode   (1 = start from a cleared canvas, 0 = draw over the previous frame)
//   u16 y      starting row
//   repeat:
//     u16 count, u16 value
//     count == 0: value == 1000 -> end of frame; otherwise advance `value` rows and reset x to 0
//     count  > 0: x += value; then `count` palette-index bytes, padded to an even length

import type { Palette } from "./palette.ts";

export const IMG_FLAG_PALETTE = 0x1000;

export interface LbxImageHeader {
  width: number;
  height: number;
  frameCount: number;
  frameDelay: number;
  flags: number;
  frameOffsets: number[];
  paletteFirst: number;
  paletteCount: number;
  paletteOffset: number; // byte offset of first palette colour record, -1 if none
}

export interface IndexedFrame {
  width: number;
  height: number;
  /** palette indices; -1 = transparent */
  pixels: Int16Array;
}

export class ImageError extends Error {}

export function readImageHeader(e: Uint8Array): LbxImageHeader {
  if (e.length < 16) throw new ImageError("image entry too short");
  const v = new DataView(e.buffer, e.byteOffset, e.byteLength);
  const width = v.getUint16(0, true);
  const height = v.getUint16(2, true);
  const frameCount = v.getUint16(6, true);
  const frameDelay = v.getUint16(8, true);
  const flags = v.getUint16(10, true);
  if (width === 0 || height === 0 || width > 2048 || height > 2048) throw new ImageError(`implausible size ${width}x${height}`);
  if (frameCount === 0 || frameCount > 512) throw new ImageError(`implausible frame count ${frameCount}`);
  const frameOffsets: number[] = [];
  for (let i = 0; i <= frameCount; i++) {
    const off = v.getUint32(12 + 4 * i, true);
    if (off > e.length) throw new ImageError(`frame offset ${i} out of range`);
    frameOffsets.push(off);
  }
  let paletteFirst = 0;
  let paletteCount = 0;
  let paletteOffset = -1;
  if (flags & IMG_FLAG_PALETTE) {
    const p = 12 + 4 * (frameCount + 1);
    paletteFirst = v.getUint16(p, true);
    paletteCount = v.getUint16(p + 2, true);
    paletteOffset = p + 4;
    if (paletteFirst + paletteCount > 256) throw new ImageError("embedded palette out of range");
  }
  return { width, height, frameCount, frameDelay, flags, frameOffsets, paletteFirst, paletteCount, paletteOffset };
}

export function isProbablyImage(e: Uint8Array): boolean {
  try {
    const h = readImageHeader(e);
    return h.frameOffsets[0] >= 12 + 4 * (h.frameCount + 1) && h.frameOffsets[h.frameCount] <= e.length;
  } catch {
    return false;
  }
}

/** Apply an image's embedded palette (if any) on top of a base palette. */
export function applyEmbeddedPalette(e: Uint8Array, base: Palette): Palette {
  const h = readImageHeader(e);
  if (h.paletteOffset < 0) return base;
  const pal = new Uint8Array(base);
  for (let i = 0; i < h.paletteCount; i++) {
    const p = h.paletteOffset + i * 4;
    const c = (h.paletteFirst + i) * 4;
    pal[c] = ((e[p + 1] & 63) * 255 / 63) | 0;
    pal[c + 1] = ((e[p + 2] & 63) * 255 / 63) | 0;
    pal[c + 2] = ((e[p + 3] & 63) * 255 / 63) | 0;
    pal[c + 3] = 255;
  }
  return pal;
}

function decodeFrameInto(e: Uint8Array, start: number, end: number, w: number, h: number, buf: Int16Array): void {
  const v = new DataView(e.buffer, e.byteOffset, e.byteLength);
  let p = start;
  if (p + 4 > end) return;
  const mode = v.getUint16(p, true);
  let y = v.getUint16(p + 2, true);
  p += 4;
  if (mode === 1) buf.fill(-1);
  let x = 0;
  while (p + 4 <= end) {
    const count = v.getUint16(p, true);
    const value = v.getUint16(p + 2, true);
    p += 4;
    if (count === 0) {
      if (value === 1000) break;
      y += value;
      x = 0;
      continue;
    }
    x += value;
    if (p + count > end) throw new ImageError("pixel run exceeds frame data");
    if (y >= 0 && y < h) {
      const row = y * w;
      for (let k = 0; k < count; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < w) buf[row + xx] = e[p + k];
      }
    }
    x += count;
    p += count + (count & 1);
  }
}

/** Decode frames [0..frame] cumulatively and return frame `frame`. */
export function decodeFrame(e: Uint8Array, frame = 0): IndexedFrame {
  const h = readImageHeader(e);
  if (frame < 0 || frame >= h.frameCount) throw new ImageError(`frame ${frame} out of range`);
  const pixels = new Int16Array(h.width * h.height).fill(-1);
  for (let f = 0; f <= frame; f++) decodeFrameInto(e, h.frameOffsets[f], h.frameOffsets[f + 1], h.width, h.height, pixels);
  return { width: h.width, height: h.height, pixels };
}

/** Decode all frames (cumulative). */
export function decodeAllFrames(e: Uint8Array): IndexedFrame[] {
  const h = readImageHeader(e);
  const out: IndexedFrame[] = [];
  const pixels = new Int16Array(h.width * h.height).fill(-1);
  for (let f = 0; f < h.frameCount; f++) {
    decodeFrameInto(e, h.frameOffsets[f], h.frameOffsets[f + 1], h.width, h.height, pixels);
    out.push({ width: h.width, height: h.height, pixels: new Int16Array(pixels) });
  }
  return out;
}

/** Convert an indexed frame to RGBA bytes. */
export function frameToRgba(frame: IndexedFrame, pal: Palette, opaqueBackground?: [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(frame.width * frame.height * 4);
  for (let i = 0; i < frame.pixels.length; i++) {
    const c = frame.pixels[i];
    const o = i * 4;
    if (c < 0) {
      if (opaqueBackground) {
        out[o] = opaqueBackground[0];
        out[o + 1] = opaqueBackground[1];
        out[o + 2] = opaqueBackground[2];
        out[o + 3] = 255;
      }
      continue;
    }
    out[o] = pal[c * 4];
    out[o + 1] = pal[c * 4 + 1];
    out[o + 2] = pal[c * 4 + 2];
    out[o + 3] = 255;
  }
  return out;
}

/** Encode frames using the same RLE scheme (synthetic fixtures and mod tooling). Frame pixels: -1 transparent. */
export function encodeImage(width: number, height: number, frames: Int16Array[], delay = 0): Uint8Array {
  const chunks: number[][] = [];
  for (const px of frames) {
    const bytes: number[] = [];
    const u16 = (n: number) => bytes.push(n & 255, (n >> 8) & 255);
    u16(1);
    u16(0);
    let pendingRows = 0;
    for (let y = 0; y < height; y++) {
      let x = 0;
      let lastEnd = 0;
      while (x < width) {
        if (px[y * width + x] < 0) {
          x++;
          continue;
        }
        let run = 0;
        while (x + run < width && px[y * width + x + run] >= 0) run++;
        if (pendingRows > 0) {
          u16(0);
          u16(pendingRows);
          pendingRows = 0;
        }
        u16(run);
        u16(x - lastEnd);
        for (let k = 0; k < run; k++) bytes.push(px[y * width + x + k] & 255);
        if (run & 1) bytes.push(0);
        x += run;
        lastEnd = x;
      }
      pendingRows += 1;
    }
    u16(0);
    u16(1000);
    chunks.push(bytes);
  }
  const headerLen = 12 + 4 * (frames.length + 1);
  const total = headerLen + chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint16(0, width, true);
  v.setUint16(2, height, true);
  v.setUint16(4, 0, true);
  v.setUint16(6, frames.length, true);
  v.setUint16(8, delay, true);
  v.setUint16(10, 0, true);
  let off = headerLen;
  for (let i = 0; i < chunks.length; i++) {
    v.setUint32(12 + 4 * i, off, true);
    out.set(chunks[i], off);
    off += chunks[i].length;
  }
  v.setUint32(12 + 4 * chunks.length, off, true);
  return out;
}
