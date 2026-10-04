// Linear Executable (LE) loader for DOS/4GW-style 32-bit flat-model programs.
//
// Parses the MZ stub chain, the LE header, the object table, the page map and the fixup tables, and
// produces a flat image of every object at its preferred linear base with internal fixups applied.
// Independently authored from the public LE/LX format description; it contains no program data.

export interface LeObject {
  readonly index: number; // 1-based, as used by fixup records and debug info
  readonly base: number; // preferred linear base address
  readonly virtualSize: number;
  readonly flags: number;
  readonly bytes: Uint8Array; // virtualSize bytes; uninitialised tail is zero
}

export interface LeFixup {
  readonly source: number; // linear address of the patched field
  readonly kind: number; // LE source type (low nibble): 7 = 32-bit offset, 8 = 32-bit self-relative, ...
  readonly target: number; // linear address the field refers to
}

export interface LeImage {
  readonly leOffset: number;
  readonly entryObject: number;
  readonly entryEip: number; // linear address
  readonly stackObject: number;
  readonly initialEsp: number; // linear address
  readonly objects: readonly LeObject[];
  readonly fixups: readonly LeFixup[];
}

export class LeError extends Error {}

function findLe(d: Uint8Array, v: DataView): { mz: number; le: number } {
  // DOS/4GW binds a real-mode MZ stub (which may itself contain further MZ images) in front of the
  // LE header. Walk every MZ signature whose e_lfanew points at an "LE" signature.
  for (let o = 0; o + 0x40 < d.length; o++) {
    if (d[o] !== 0x4d || d[o + 1] !== 0x5a) continue;
    const lf = v.getUint32(o + 0x3c, true);
    const p = o + lf;
    if (lf > 0 && p + 0xb0 < d.length && d[p] === 0x4c && d[p + 1] === 0x45 && d[p + 2] === 0 && d[p + 3] === 0) return { mz: o, le: p };
  }
  throw new LeError("no LE header found");
}

// `bases` optionally overrides the preferred linear base of each object (index 0 = object 1). All fixups are
// then applied against the new bases, which lets a host place the program away from the low 1 MB that a
// DOS extender normally reserves for real-mode memory, the VGA window and the BIOS.
export function loadLe(file: Uint8Array, bases?: readonly number[]): LeImage {
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength);
  // The data-pages offset is relative to the MZ image that owns the LE header, not to the file start.
  const { mz, le } = findLe(file, v);
  const u32 = (o: number) => v.getUint32(le + o, true);
  const pageSize = u32(0x28);
  const lastPageBytes = u32(0x2c);
  const pageCount = u32(0x14);
  const objTab = le + u32(0x40);
  const objCount = u32(0x44);
  const pageMap = le + u32(0x48);
  const fixPageTab = le + u32(0x68);
  const fixRecTab = le + u32(0x6c);
  const dataPages = mz + u32(0x80);

  const objects: LeObject[] = [];
  // page index (1-based) -> object/offset, needed to translate fixup page numbers
  const pageOwner: { obj: number; offset: number }[] = [];
  for (let i = 0; i < objCount; i++) {
    const o = objTab + i * 24;
    const virtualSize = v.getUint32(o, true);
    const base = bases?.[i] ?? v.getUint32(o + 4, true);
    const flags = v.getUint32(o + 8, true);
    const firstPage = v.getUint32(o + 12, true);
    const nPages = v.getUint32(o + 16, true);
    const bytes = new Uint8Array(Math.max(virtualSize, nPages * pageSize));
    for (let p = 0; p < nPages; p++) {
      const pageIndex = firstPage + p; // 1-based
      // LE page map entry: 3-byte big-endian-ish page number + flags byte
      const pm = pageMap + (pageIndex - 1) * 4;
      const pageNum = (file[pm] << 16) | (file[pm + 1] << 8) | file[pm + 2];
      const pageFlags = file[pm + 3];
      if (pageFlags !== 0) throw new LeError(`unsupported page flags ${pageFlags} on page ${pageIndex}`);
      const size = pageIndex === pageCount ? lastPageBytes : pageSize;
      const src = dataPages + (pageNum - 1) * pageSize;
      bytes.set(file.subarray(src, src + size), p * pageSize);
      pageOwner[pageIndex] = { obj: i, offset: p * pageSize };
    }
    objects.push({ index: i + 1, base, virtualSize, flags, bytes });
  }

  const fixups: LeFixup[] = [];
  for (let pageIndex = 1; pageIndex <= pageCount; pageIndex++) {
    const start = fixRecTab + v.getUint32(fixPageTab + (pageIndex - 1) * 4, true);
    const end = fixRecTab + v.getUint32(fixPageTab + pageIndex * 4, true);
    const owner = pageOwner[pageIndex];
    let p = start;
    while (p < end) {
      const srcType = file[p++];
      const tflags = file[p++];
      const kind = srcType & 0x0f;
      const hasList = (srcType & 0x20) !== 0;
      let srcOffsets: number[] = [];
      let listCount = 0;
      if (hasList) listCount = file[p++];
      else {
        srcOffsets = [v.getInt16(p, true)];
        p += 2;
      }
      if ((tflags & 0x03) !== 0) throw new LeError(`unsupported fixup target type ${tflags & 3}`);
      let obj: number;
      if (tflags & 0x40) {
        obj = v.getUint16(p, true);
        p += 2;
      } else obj = file[p++];
      let targetOffset = 0;
      if (kind !== 0x02) {
        if (tflags & 0x10) {
          targetOffset = v.getUint32(p, true);
          p += 4;
        } else {
          targetOffset = v.getUint16(p, true);
          p += 2;
        }
      }
      if (hasList) {
        for (let k = 0; k < listCount; k++) {
          srcOffsets.push(v.getInt16(p, true));
          p += 2;
        }
      }
      const tobj = objects[obj - 1];
      if (!tobj) throw new LeError(`fixup to unknown object ${obj}`);
      const target = tobj.base + targetOffset;
      for (const so of srcOffsets) {
        const sobj = objects[owner.obj];
        const local = owner.offset + so;
        const source = sobj.base + local;
        fixups.push({ source, kind, target });
        const bv = new DataView(sobj.bytes.buffer, sobj.bytes.byteOffset, sobj.bytes.byteLength);
        if (local < 0 || local + 4 > sobj.bytes.length) continue; // field straddles object start (cannot happen in practice)
        if (kind === 0x07) bv.setUint32(local, target >>> 0, true);
        else if (kind === 0x08) bv.setUint32(local, (target - (source + 4)) >>> 0, true);
        else if (kind === 0x05) bv.setUint16(local, target & 0xffff, true);
        else if (kind === 0x02) {
          /* selector: flat model, left as-is */
        } else throw new LeError(`unsupported fixup source type ${kind}`);
      }
    }
  }

  const eipObj = u32(0x18);
  const espObj = u32(0x20);
  return {
    leOffset: le,
    entryObject: eipObj,
    entryEip: objects[eipObj - 1].base + u32(0x1c),
    stackObject: espObj,
    initialEsp: objects[espObj - 1].base + u32(0x24),
    objects,
    fixups,
  };
}
