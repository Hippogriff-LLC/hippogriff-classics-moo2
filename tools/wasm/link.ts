// Minimal static linker for WebAssembly relocatable objects (the LLVM "linking" + "reloc.*" convention).
//
// Hosts that ship clang's libraries without wasm-ld still need to turn objects into a module. This covers
// what freestanding C compiled for wasm32 produces: functions, data segments, the shared stack pointer
// and indirect function table, and the static (non-PIC) relocation kinds. Undefined functions become
// imports from module "env"; that is how the runtime reaches its JavaScript host.
//
//   node tools/wasm/link.ts -o out.wasm [--stack BYTES] [--export NAME]... a.o b.o ...
//
// Independently authored; Apache-2.0.

import { readFileSync, writeFileSync } from "node:fs";

// ------------------------------------------------------------------ binary reading
class Reader {
  readonly b: Uint8Array;
  pos: number;
  constructor(b: Uint8Array, pos = 0) {
    this.b = b;
    this.pos = pos;
  }
  u8(): number {
    return this.b[this.pos++];
  }
  u32(): number {
    let r = 0,
      shift = 0,
      byte: number;
    do {
      byte = this.b[this.pos++];
      r |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    return r >>> 0;
  }
  s32(): number {
    let r = 0,
      shift = 0,
      byte: number;
    do {
      byte = this.b[this.pos++];
      r |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    if (shift < 32 && byte & 0x40) r |= -1 << shift;
    return r | 0;
  }
  bytes(n: number): Uint8Array {
    const v = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
  name(): string {
    return new TextDecoder().decode(this.bytes(this.u32()));
  }
  // skip an init expression up to and including `end`
  initExpr(): Uint8Array {
    const start = this.pos;
    for (;;) {
      const op = this.u8();
      if (op === 0x0b) break;
      if (op === 0x41) this.s32();
      else if (op === 0x42) this.s64();
      else if (op === 0x23) this.u32();
      else if (op === 0x44) this.pos += 8;
      else if (op === 0x43) this.pos += 4;
      else throw new Error(`unsupported init expression opcode ${op}`);
    }
    return this.b.subarray(start, this.pos);
  }
  s64(): void {
    let byte: number;
    do byte = this.b[this.pos++];
    while (byte & 0x80);
  }
}

// ------------------------------------------------------------------ binary writing
class Writer {
  private chunks: number[] = [];
  private parts: Uint8Array[] = [];
  private flush(): void {
    if (this.chunks.length) {
      this.parts.push(Uint8Array.from(this.chunks));
      this.chunks = [];
    }
  }
  u8(v: number): this {
    this.chunks.push(v & 0xff);
    return this;
  }
  u32(v: number): this {
    v >>>= 0;
    do {
      let byte = v & 0x7f;
      v >>>= 7;
      if (v) byte |= 0x80;
      this.chunks.push(byte);
    } while (v);
    return this;
  }
  s32(v: number): this {
    v |= 0;
    for (;;) {
      const byte = v & 0x7f;
      v >>= 7;
      if ((v === 0 && !(byte & 0x40)) || (v === -1 && byte & 0x40)) {
        this.chunks.push(byte);
        return this;
      }
      this.chunks.push(byte | 0x80);
    }
  }
  bytes(b: Uint8Array): this {
    this.flush();
    this.parts.push(b);
    return this;
  }
  name(s: string): this {
    const b = new TextEncoder().encode(s);
    return this.u32(b.length).bytes(b);
  }
  finish(): Uint8Array {
    this.flush();
    const n = this.parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

function patchLeb(b: Uint8Array, at: number, v: number, signed: boolean): void {
  // relocatable fields are padded to five bytes
  for (let i = 0; i < 5; i++) {
    let byte = v & 0x7f;
    v = signed ? v >> 7 : v >>> 7;
    if (i < 4) byte |= 0x80;
    b[at + i] = byte;
  }
}
function patchI32(b: Uint8Array, at: number, v: number): void {
  b[at] = v & 0xff;
  b[at + 1] = (v >>> 8) & 0xff;
  b[at + 2] = (v >>> 16) & 0xff;
  b[at + 3] = (v >>> 24) & 0xff;
}

// ------------------------------------------------------------------ object model
const SYM_FUNCTION = 0,
  SYM_DATA = 1,
  SYM_GLOBAL = 2,
  SYM_SECTION = 3,
  SYM_TABLE = 5;
const F_WEAK = 1,
  F_LOCAL = 2,
  F_UNDEFINED = 0x10,
  F_EXPORTED = 0x20,
  F_EXPLICIT_NAME = 0x40;

interface Sym {
  kind: number;
  flags: number;
  name: string;
  index: number; // function/global/table index in the object's index space
  segment: number;
  offset: number;
  size: number;
}
interface Import {
  module: string;
  field: string;
  kind: number;
  type: number;
}
interface Reloc {
  type: number;
  offset: number;
  index: number;
  addend: number;
}
interface Segment {
  name: string;
  align: number;
  data: Uint8Array;
  addr: number; // assigned
}
interface Obj {
  path: string;
  types: string[]; // signature keys
  typeBytes: Uint8Array[];
  imports: Import[];
  funcImports: number;
  globalImports: number;
  funcTypes: number[];
  globals: { type: Uint8Array; init: Uint8Array }[];
  code: Uint8Array | null; // code section payload
  bodies: { start: number; end: number }[]; // within code payload, including the size prefix
  codeSection: number;
  dataSection: number;
  dataPayload: Uint8Array | null;
  segDataStart: number[]; // offset of each segment's bytes within the data payload
  segments: Segment[];
  syms: Sym[];
  relocs: Map<number, Reloc[]>; // section index -> relocations
  funcBase: number; // output index of first defined function
  globalBase: number;
}

function parseObject(path: string): Obj {
  const b = new Uint8Array(readFileSync(path));
  if (b[0] !== 0 || b[1] !== 0x61 || b[2] !== 0x73 || b[3] !== 0x6d) throw new Error(`${path}: not wasm`);
  const o: Obj = {
    path,
    types: [],
    typeBytes: [],
    imports: [],
    funcImports: 0,
    globalImports: 0,
    funcTypes: [],
    globals: [],
    code: null,
    bodies: [],
    codeSection: -1,
    dataSection: -1,
    dataPayload: null,
    segDataStart: [],
    segments: [],
    syms: [],
    relocs: new Map(),
    funcBase: 0,
    globalBase: 0,
  };
  const r = new Reader(b, 8);
  let sectionIndex = 0;
  const segInfo: { name: string; align: number }[] = [];
  while (r.pos < b.length) {
    const id = r.u8();
    const size = r.u32();
    const start = r.pos;
    const end = start + size;
    const s = new Reader(b.subarray(0, end), start);
    if (id === 1) {
      for (let n = s.u32(); n--; ) {
        const t0 = s.pos;
        if (s.u8() !== 0x60) throw new Error("bad functype");
        for (let k = 0; k < 2; k++) {
          const count = s.u32(); // params, then results; one byte per value type
          s.pos += count;
        }
        const tb = b.slice(t0, s.pos);
        o.typeBytes.push(tb);
        o.types.push(Array.from(tb).join(","));
      }
    } else if (id === 2) {
      for (let n = s.u32(); n--; ) {
        const module = s.name(),
          field = s.name(),
          kind = s.u8();
        let type = 0;
        if (kind === 0) {
          type = s.u32();
          o.funcImports++;
        } else if (kind === 1) {
          s.u8();
          const fl = s.u8();
          s.u32();
          if (fl & 1) s.u32();
        } else if (kind === 2) {
          const fl = s.u8();
          s.u32();
          if (fl & 1) s.u32();
        } else if (kind === 3) {
          s.u8();
          s.u8();
          o.globalImports++;
        } else throw new Error(`${path}: import kind ${kind}`);
        o.imports.push({ module, field, kind, type });
      }
    } else if (id === 3) {
      for (let n = s.u32(); n--; ) o.funcTypes.push(s.u32());
    } else if (id === 6) {
      for (let n = s.u32(); n--; ) {
        const type = s.bytes(2);
        o.globals.push({ type, init: s.initExpr() });
      }
    } else if (id === 10) {
      o.codeSection = sectionIndex;
      o.code = b.slice(start, end);
      const c = new Reader(o.code);
      for (let n = c.u32(); n--; ) {
        const bs = c.pos;
        const len = c.u32();
        c.pos += len;
        o.bodies.push({ start: bs, end: c.pos });
      }
    } else if (id === 11) {
      o.dataSection = sectionIndex;
      o.dataPayload = b.slice(start, end);
      const d = new Reader(o.dataPayload);
      for (let n = d.u32(); n--; ) {
        const flags = d.u32();
        if (flags !== 0) throw new Error(`${path}: data segment flags ${flags}`);
        d.initExpr();
        const len = d.u32();
        o.segDataStart.push(d.pos);
        o.segments.push({ name: "", align: 0, data: o.dataPayload.subarray(d.pos, d.pos + len), addr: 0 });
        d.pos += len;
      }
    } else if (id === 0) {
      const name = s.name();
      if (name === "linking") {
        const version = s.u32();
        if (version !== 2) throw new Error(`${path}: linking version ${version}`);
        while (s.pos < end) {
          const sub = s.u8();
          const len = s.u32();
          const subEnd = s.pos + len;
          if (sub === 5) {
            for (let n = s.u32(); n--; ) {
              const nm = s.name();
              const align = s.u32();
              s.u32();
              segInfo.push({ name: nm, align });
            }
          } else if (sub === 6) {
            if (s.u32() > 0) throw new Error(`${path}: static constructors are not supported`);
          } else if (sub === 8) {
            for (let n = s.u32(); n--; ) {
              const kind = s.u8();
              const flags = s.u32();
              const sym: Sym = { kind, flags, name: "", index: 0, segment: -1, offset: 0, size: 0 };
              if (kind === SYM_FUNCTION || kind === SYM_GLOBAL || kind === SYM_TABLE || kind === 4) {
                sym.index = s.u32();
                if (!(flags & F_UNDEFINED) || flags & F_EXPLICIT_NAME) sym.name = s.name();
              } else if (kind === SYM_DATA) {
                sym.name = s.name();
                if (!(flags & F_UNDEFINED)) {
                  sym.segment = s.u32();
                  sym.offset = s.u32();
                  sym.size = s.u32();
                }
              } else if (kind === SYM_SECTION) {
                sym.index = s.u32();
              } else throw new Error(`${path}: symbol kind ${kind}`);
              o.syms.push(sym);
            }
          }
          s.pos = subEnd;
        }
      } else if (name.startsWith("reloc.")) {
        const target = s.u32();
        const list: Reloc[] = [];
        for (let n = s.u32(); n--; ) {
          const type = s.u8();
          const offset = s.u32();
          const index = s.u32();
          const addend = [3, 4, 5, 8, 9, 11, 21].includes(type) ? s.s32() : 0;
          list.push({ type, offset, index, addend });
        }
        o.relocs.set(target, list);
      }
    }
    r.pos = end;
    sectionIndex++;
  }
  segInfo.forEach((si, i) => {
    o.segments[i].name = si.name;
    o.segments[i].align = si.align;
  });
  // undefined function symbols without explicit names take the import field name
  for (const sym of o.syms) {
    if (sym.kind === SYM_FUNCTION && sym.flags & F_UNDEFINED && !sym.name) {
      sym.name = o.imports.filter((i) => i.kind === 0)[sym.index].field;
    }
    if (sym.kind === SYM_GLOBAL && sym.flags & F_UNDEFINED && !sym.name) {
      sym.name = o.imports.filter((i) => i.kind === 3)[sym.index].field;
    }
  }
  return o;
}

// ------------------------------------------------------------------ link
interface Options {
  out: string;
  stack: number;
  exports: string[];
  inputs: string[];
}

function parseArgs(argv: string[]): Options {
  const o: Options = { out: "", stack: 8 << 20, exports: [], inputs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o") o.out = argv[++i];
    else if (a === "--stack") o.stack = Number(argv[++i]);
    else if (a === "--export") o.exports.push(argv[++i]);
    else o.inputs.push(a);
  }
  if (!o.out || !o.inputs.length) {
    console.error("usage: node tools/wasm/link.ts -o out.wasm [--stack BYTES] [--export NAME]... objects...");
    process.exit(2);
  }
  return o;
}

export function link(opts: Options): { size: number; imports: string[] } {
  const objs = opts.inputs.map(parseObject);

  // types
  const typeKeys = new Map<string, number>();
  const typeBytes: Uint8Array[] = [];
  const typeOf = (o: Obj, t: number): number => {
    const k = o.types[t];
    let i = typeKeys.get(k);
    if (i === undefined) {
      i = typeBytes.length;
      typeKeys.set(k, i);
      typeBytes.push(o.typeBytes[t]);
    }
    return i;
  };

  // global symbol resolution
  type Def = { obj: Obj; sym: Sym };
  const defs = new Map<string, Def>();
  for (const o of objs)
    for (const sym of o.syms) {
      if (sym.flags & (F_UNDEFINED | F_LOCAL) || sym.kind === SYM_SECTION) continue;
      const prev = defs.get(sym.name);
      if (prev && !(prev.sym.flags & F_WEAK) && !(sym.flags & F_WEAK))
        throw new Error(`duplicate symbol ${sym.name} in ${prev.obj.path} and ${o.path}`);
      if (!prev || prev.sym.flags & F_WEAK) defs.set(sym.name, { obj: o, sym });
    }

  // host imports: undefined functions with no definition anywhere
  const hostImports: { name: string; type: number }[] = [];
  const hostIndex = new Map<string, number>();
  for (const o of objs)
    for (const sym of o.syms) {
      if (sym.kind !== SYM_FUNCTION || !(sym.flags & F_UNDEFINED) || defs.has(sym.name)) continue;
      if (hostIndex.has(sym.name)) continue;
      const imp = o.imports.filter((i) => i.kind === 0)[sym.index];
      hostIndex.set(sym.name, hostImports.length);
      hostImports.push({ name: sym.name, type: typeOf(o, imp.type) });
    }

  // function index space: host imports, then every object's defined functions in order
  let nextFunc = hostImports.length;
  for (const o of objs) {
    o.funcBase = nextFunc;
    nextFunc += o.funcTypes.length;
  }
  // globals: 0 = __stack_pointer, then defined globals
  let nextGlobal = 1;
  for (const o of objs) {
    o.globalBase = nextGlobal;
    nextGlobal += o.globals.length;
  }

  // memory layout: [0, 1024) unused, stack, then data, then heap
  const stackTop = (1024 + opts.stack + 15) & ~15;
  let addr = stackTop;
  for (const o of objs)
    for (const seg of o.segments) {
      const al = 1 << seg.align;
      addr = (addr + al - 1) & ~(al - 1);
      seg.addr = addr;
      addr += seg.data.length;
    }
  const dataEnd = addr;
  const heapBase = (dataEnd + 15) & ~15;
  const synthetic = new Map<string, number>([
    ["__heap_base", heapBase],
    ["__data_end", dataEnd],
    ["__stack_low", 1024],
    ["__stack_high", stackTop],
  ]);

  const funcIndex = (o: Obj, symIndex: number): number => {
    const sym = o.syms[symIndex];
    if (sym.kind !== SYM_FUNCTION) throw new Error(`${o.path}: symbol ${symIndex} is not a function`);
    if (!(sym.flags & F_UNDEFINED)) {
      if (sym.flags & F_LOCAL || !defs.has(sym.name)) return o.funcBase + sym.index - o.funcImports;
      const d = defs.get(sym.name)!;
      return d.obj.funcBase + d.sym.index - d.obj.funcImports;
    }
    const d = defs.get(sym.name);
    if (d) {
      if (d.sym.kind !== SYM_FUNCTION) throw new Error(`${sym.name} is not a function`);
      return d.obj.funcBase + d.sym.index - d.obj.funcImports;
    }
    return hostIndex.get(sym.name)!;
  };
  const dataAddr = (o: Obj, symIndex: number): number => {
    const sym = o.syms[symIndex];
    if (sym.kind !== SYM_DATA) throw new Error(`${o.path}: symbol ${symIndex} is not data`);
    let obj = o,
      s = sym;
    if (sym.flags & F_UNDEFINED || !(sym.flags & F_LOCAL)) {
      const d = defs.get(sym.name);
      if (!d) {
        const v = synthetic.get(sym.name);
        if (v === undefined) throw new Error(`undefined data symbol ${sym.name} (${o.path})`);
        return v;
      }
      obj = d.obj;
      s = d.sym;
    }
    return obj.segments[s.segment].addr + s.offset;
  };
  const globalIndex = (o: Obj, symIndex: number): number => {
    const sym = o.syms[symIndex];
    if (sym.name === "__stack_pointer") return 0;
    if (!(sym.flags & F_UNDEFINED)) return o.globalBase + sym.index - o.globalImports;
    const d = defs.get(sym.name);
    if (!d) throw new Error(`undefined global ${sym.name}`);
    return d.obj.globalBase + d.sym.index - d.obj.globalImports;
  };
  const table: number[] = [];
  const tableSlot = new Map<number, number>();
  const tableIndex = (f: number): number => {
    let t = tableSlot.get(f);
    if (t === undefined) {
      t = table.length + 1; // slot 0 stays null
      table.push(f);
      tableSlot.set(f, t);
    }
    return t;
  };

  const apply = (o: Obj, buf: Uint8Array, rel: Reloc, at: number): void => {
    switch (rel.type) {
      case 0: // FUNCTION_INDEX_LEB
        patchLeb(buf, at, funcIndex(o, rel.index), false);
        break;
      case 1: // TABLE_INDEX_SLEB
        patchLeb(buf, at, tableIndex(funcIndex(o, rel.index)), true);
        break;
      case 2: // TABLE_INDEX_I32
        patchI32(buf, at, tableIndex(funcIndex(o, rel.index)));
        break;
      case 3: // MEMORY_ADDR_LEB
        patchLeb(buf, at, dataAddr(o, rel.index) + rel.addend, false);
        break;
      case 4: // MEMORY_ADDR_SLEB
        patchLeb(buf, at, dataAddr(o, rel.index) + rel.addend, true);
        break;
      case 5: // MEMORY_ADDR_I32
        patchI32(buf, at, dataAddr(o, rel.index) + rel.addend);
        break;
      case 6: // TYPE_INDEX_LEB
        patchLeb(buf, at, typeOf(o, rel.index), false);
        break;
      case 7: // GLOBAL_INDEX_LEB
        patchLeb(buf, at, globalIndex(o, rel.index), false);
        break;
      case 20: // TABLE_NUMBER_LEB
        patchLeb(buf, at, 0, false);
        break;
      case 26: // FUNCTION_INDEX_I32
        patchI32(buf, at, funcIndex(o, rel.index));
        break;
      default:
        throw new Error(`${o.path}: unsupported relocation type ${rel.type}`);
    }
  };

  // patch code and data in place (each object owns its copies)
  for (const o of objs) {
    if (o.code) for (const rel of o.relocs.get(o.codeSection) ?? []) apply(o, o.code, rel, rel.offset);
    if (o.dataPayload) for (const rel of o.relocs.get(o.dataSection) ?? []) apply(o, o.dataPayload, rel, rel.offset);
  }

  // exports
  const exportList: { name: string; func: number }[] = [];
  const wanted = new Set(opts.exports);
  for (const o of objs)
    for (const sym of o.syms)
      if (
        sym.kind === SYM_FUNCTION &&
        !(sym.flags & (F_UNDEFINED | F_LOCAL)) &&
        (sym.flags & F_EXPORTED || wanted.has(sym.name))
      ) {
        exportList.push({ name: sym.name, func: o.funcBase + sym.index - o.funcImports });
        wanted.delete(sym.name);
      }
  if (wanted.size) throw new Error(`cannot export undefined ${[...wanted].join(", ")}`);

  // ------------------------------------------------------------------ emit
  const w = new Writer();
  w.bytes(Uint8Array.of(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0));
  const section = (id: number, body: Writer): void => {
    const p = body.finish();
    w.u8(id).u32(p.length).bytes(p);
  };
  // pre-resolve every function type so the type section is complete
  const funcTypeOut: number[] = [];
  for (const o of objs) for (const t of o.funcTypes) funcTypeOut.push(typeOf(o, t));

  let s = new Writer();
  s.u32(typeBytes.length);
  for (const t of typeBytes) s.bytes(t);
  section(1, s);

  s = new Writer();
  s.u32(hostImports.length);
  for (const imp of hostImports) s.name("env").name(imp.name).u8(0).u32(imp.type);
  section(2, s);

  s = new Writer();
  s.u32(funcTypeOut.length);
  for (const t of funcTypeOut) s.u32(t);
  section(3, s);

  s = new Writer();
  s.u32(1).u8(0x70).u8(1).u32(table.length + 1).u32(table.length + 1);
  section(4, s);

  const pages = Math.ceil((heapBase + (1 << 16)) / 65536);
  s = new Writer();
  s.u32(1).u8(0).u32(pages); // grows at run time (memory.grow)
  section(5, s);

  s = new Writer();
  s.u32(1 + objs.reduce((a, o) => a + o.globals.length, 0));
  s.u8(0x7f).u8(1).u8(0x41).s32(stackTop).u8(0x0b);
  for (const o of objs) for (const g of o.globals) s.bytes(g.type).bytes(g.init);
  section(6, s);

  s = new Writer();
  s.u32(exportList.length + 2);
  s.name("memory").u8(2).u32(0);
  s.name("__indirect_function_table").u8(1).u32(0);
  for (const e of exportList) s.name(e.name).u8(0).u32(e.func);
  section(7, s);

  if (table.length) {
    s = new Writer();
    s.u32(1).u32(0).u8(0x41).s32(1).u8(0x0b).u32(table.length);
    for (const f of table) s.u32(f);
    section(9, s);
  }

  const kept = objs.flatMap((o) => o.segments).filter((g) => !g.name.startsWith(".bss") && g.data.some((x) => x));
  s = new Writer();
  s.u32(kept.length);
  section(12, s);

  s = new Writer();
  s.u32(funcTypeOut.length);
  for (const o of objs) for (const body of o.bodies) s.bytes(o.code!.subarray(body.start, body.end));
  section(10, s);

  s = new Writer();
  s.u32(kept.length);
  for (const g of kept) s.u32(0).u8(0x41).s32(g.addr).u8(0x0b).u32(g.data.length).bytes(g.data);
  section(11, s);

  const out = w.finish();
  writeFileSync(opts.out, out);
  return { size: out.length, imports: hostImports.map((i) => i.name) };
}

if (import.meta.main) {
  const opts = parseArgs(process.argv.slice(2));
  const r = link(opts);
  console.log(`wrote ${opts.out}: ${r.size} bytes; host imports: ${r.imports.join(" ")}`);
}
