// VGA palette handling.
// Palettes in the fonts archive are stored as 256 x 4 bytes: [flag, r, g, b] with 6-bit components,
// followed by lookup tables that this implementation does not need (observed; see docs/research/formats/LBX.md).

export type Palette = Uint8Array; // 256 * 4 RGBA bytes

export function vga6to8(v: number): number {
  return ((v & 63) * 255 / 63) | 0;
}

export function decodePalette4(data: Uint8Array, offset = 0, count = 256): Palette {
  const pal = new Uint8Array(256 * 4);
  for (let i = 0; i < count; i++) {
    const p = offset + i * 4;
    pal[i * 4] = vga6to8(data[p + 1]);
    pal[i * 4 + 1] = vga6to8(data[p + 2]);
    pal[i * 4 + 2] = vga6to8(data[p + 3]);
    pal[i * 4 + 3] = 255;
  }
  return pal;
}

/** Simple grey ramp palette used when no original palette has been imported (tests / fallback). */
export function greyPalette(): Palette {
  const pal = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    pal[i * 4] = pal[i * 4 + 1] = pal[i * 4 + 2] = i;
    pal[i * 4 + 3] = 255;
  }
  return pal;
}
