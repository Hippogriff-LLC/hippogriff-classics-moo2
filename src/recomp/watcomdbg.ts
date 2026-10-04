// Reader for Watcom debugging information (format version 3, "master header" signature 0x8386)
// appended to the end of an executable by the Watcom linker.
//
// Layout (independently described from the public Open Watcom debug-format documentation):
//   [lang table][segment table][section 0]...[section N][master header (14 bytes)]
//   section header: u32 mod_offset, u32 gbl_offset, u32 addr_offset, u32 section_size, u16 section_id
//   mod_info:  u16 language, demand_info locals/types/lines (u32 offset, u16 count), pstring name
//   gbl_info:  u32 offset, u16 segment, u16 module, u8 kind, pstring name
//   addr info: { u32 offset, u16 segment, u16 n, n x { u32 size, u16 module } }

export interface DbgModule {
  readonly index: number;
  readonly name: string;
  readonly language: number;
  readonly locals: { offset: number; count: number };
  readonly types: { offset: number; count: number };
  readonly lines: { offset: number; count: number };
}

export interface DbgGlobal {
  readonly name: string;
  readonly segment: number; // 1-based LE object number
  readonly offset: number; // offset within the object
  readonly module: number;
  readonly kind: number; // bit0 = static (module-local); bit1 = data (else code); bit2 = code
}

export interface DbgAddrRange {
  readonly segment: number;
  readonly offset: number;
  readonly size: number;
  readonly module: number;
}

export interface WatcomDebugInfo {
  readonly sectionStart: number; // absolute file offset of section 0
  readonly languages: string[];
  readonly modules: DbgModule[];
  readonly globals: DbgGlobal[];
  readonly ranges: DbgAddrRange[];
}

export function readWatcomDebugInfo(file: Uint8Array): WatcomDebugInfo | null {
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const n = file.length;
  if (n < 14 || v.getUint16(n - 14, true) !== 0x8386) return null;
  const exeMajor = file[n - 12];
  if (exeMajor !== 3) throw new Error(`unsupported Watcom debug version ${exeMajor}`);
  const langSize = v.getUint16(n - 8, true);
  const segSize = v.getUint16(n - 6, true);
  const debugSize = v.getUint32(n - 4, true);
  const start = n - debugSize;
  const languages = new TextDecoder("latin1")
    .decode(file.subarray(start, start + langSize))
    .split("\0")
    .filter(Boolean);
  const S = start + langSize + segSize;
  const modOff = v.getUint32(S, true);
  const gblOff = v.getUint32(S + 4, true);
  const addrOff = v.getUint32(S + 8, true);
  const size = v.getUint32(S + 12, true);
  const pstr = (p: number) => new TextDecoder("latin1").decode(file.subarray(p + 1, p + 1 + file[p]));

  const modules: DbgModule[] = [];
  for (let p = S + modOff; p < S + gblOff; ) {
    const language = v.getUint16(p, true);
    const dem = (q: number) => ({ offset: v.getUint32(q, true), count: v.getUint16(q + 4, true) });
    const name = pstr(p + 20);
    modules.push({ index: modules.length, name, language, locals: dem(p + 2), types: dem(p + 8), lines: dem(p + 14) });
    p += 21 + file[p + 20];
  }
  const globals: DbgGlobal[] = [];
  for (let p = S + gblOff; p < S + addrOff; ) {
    const offset = v.getUint32(p, true);
    const segment = v.getUint16(p + 4, true);
    const module = v.getUint16(p + 6, true);
    const kind = file[p + 8];
    const name = pstr(p + 9);
    globals.push({ name, segment, offset, module, kind });
    p += 10 + file[p + 9];
  }
  const ranges: DbgAddrRange[] = [];
  for (let p = S + addrOff; p < S + size; ) {
    let offset = v.getUint32(p, true);
    const segment = v.getUint16(p + 4, true);
    const count = v.getUint16(p + 6, true);
    p += 8;
    for (let i = 0; i < count; i++) {
      const sz = v.getUint32(p, true);
      const module = v.getUint16(p + 4, true);
      ranges.push({ segment, offset, size: sz, module });
      offset += sz;
      p += 6;
    }
  }
  return { sectionStart: S, languages, modules, globals, ranges };
}
