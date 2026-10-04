# LBX container and resource formats (observations)

Independently authored notes describing the byte layouts that `src/formats/` decodes. They were written
from structural inspection of an operator-supplied v1.31 installation held outside Git (see
`provenance/README.md`). The notes contain no game data. Field names are the project's own.

All integers are little-endian.

## Archive container (`src/formats/lbx.ts`)

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | u16 | entry count `n` |
| 2 | u16 | signature, always `0xFEAD` |
| 4 | u32 | reserved; 0 in every archive inspected |
| 8 | u32 × (n + 1) | absolute byte offsets; entry `i` spans `[off[i], off[i+1])` |

In the observed files the header area is padded to `0x800`, and the last offset equals the file size.
The decoder rejects files with a bad signature, offsets that are not monotonic, or offsets past the end of
the file. It does not assume a fixed padding. Entries are returned as zero-copy `Uint8Array` views.

## Images (`src/formats/image.ts`)

An entry is treated as an image when its 12-byte header is plausible:

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | u16 | width |
| 2 | u16 | height |
| 4 | u16 | reserved (0) |
| 6 | u16 | frame count `f` |
| 8 | u16 | frame delay |
| 10 | u16 | flags; `0x1000` = embedded palette present |
| 12 | u32 × (f + 1) | frame offsets relative to the entry start |

If the palette flag is set, the offsets are followed by `u16 first, u16 count` and `count` four-byte colour
records `[flag, r, g, b]` with 6-bit components. They override colours `first … first+count-1` of the base
palette.

Each frame is a run-length stream of `u16` words:

```
u16 mode      1 = start from a cleared canvas, 0 = draw over the previous frame
u16 y         first row
repeat:
  u16 count, u16 value
  count == 0 and value == 1000  -> end of frame
  count == 0 otherwise          -> skip `value` rows, x = 0
  count > 0                     -> x += value, then `count` palette-index bytes (padded to even length)
```

Pixels that are never written stay transparent. Frames are cumulative, so frame `k` is decoded by
replaying frames `0…k`. `encodeImage` implements the inverse. Tests use it to build synthetic fixtures, so
no original bytes are needed.

## Palettes (`src/formats/palette.ts`)

Palettes in `FONTS.LBX` begin with 256 four-byte records `[flag, r, g, b]` with 6-bit components (scaled
with `v << 2 | v >> 4`). Lookup tables that the client does not use follow them. Palette index 0 is treated
as transparent when converting to RGBA.

## Text tables (`src/formats/text.ts`)

Two layouts were observed for name lists:

* **Fixed-record table:** `u16 recordCount, u16 recordSize`, then `recordCount × recordSize` bytes. Each
  record starts with a NUL-terminated string; the rest of the record is ignored.
* **NUL-separated list:** consecutive NUL-terminated strings.

Strings are decoded as DOS code page bytes. Control characters other than tab and newline become spaces.

## What is *not* decoded

Sound (`*.LBX` audio entries), music, fonts as glyph bitmaps, original help text, saved games and the
executable are not decoded, and the client does not need them. Game rules are project-authored rather than
extracted from the executable (see `docs/research/RULES.md`).
