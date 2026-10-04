// Recompiler tests on a synthetic, hand-assembled LE program (no original program bytes): the LE loader
// and its fixups, the x86 decoder, control-flow recovery (calls, recursion, a switch table, an
// address-taken function), and an end-to-end run where the emitted C is compiled together with the
// runtime and executed natively (skipped when no C compiler is available).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLe } from "../src/recomp/le.ts";
import { decode } from "../src/recomp/x86.ts";
import { analyze, type Sym } from "../src/recomp/analyze.ts";
import { emitProgram } from "../src/recomp/emit-c.ts";
import { GUEST_LAYOUT, HLE_OVERRIDES } from "../src/recomp/layout.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = 0x1000;

// ------------------------------------------------------------------ a tiny two-object assembler
type Ref = { obj: 0 | 1; label: string };

class Obj {
  readonly b: number[] = [];
  readonly labels = new Map<string, number>();
  readonly rel: { at: number; label: string }[] = [];
  readonly abs: { at: number; ref: Ref }[] = [];
  readonly base: number;
  constructor(base: number) {
    this.base = base;
  }
  get pc(): number {
    return this.b.length;
  }
  label(n: string): this {
    this.labels.set(n, this.pc);
    return this;
  }
  db(...x: number[]): this {
    for (const v of x) this.b.push(v & 0xff);
    return this;
  }
  d32(v: number): this {
    return this.db(v, v >> 8, v >> 16, v >>> 24);
  }
  rel32(label: string): this {
    this.rel.push({ at: this.pc, label });
    return this.d32(0);
  }
  abs32(ref: Ref): this {
    this.abs.push({ at: this.pc, ref });
    return this.d32(0);
  }
  align(n: number): this {
    while (this.pc % n) this.db(0xcc);
    return this;
  }
}

interface Fix {
  srcOff: number;
  obj: number; // 1-based target object
  targetOff: number;
}

/** Resolve labels and build a minimal LE file: one page per object, 32-bit offset fixups only. */
function buildLe(objs: Obj[], vsizes: number[], entry: Ref, esp: { obj: number; off: number }): Uint8Array {
  const fixes: Fix[][] = objs.map(() => []);
  const bytes = objs.map((o) => Uint8Array.from(o.b));
  objs.forEach((o, i) => {
    const dv = new DataView(bytes[i].buffer);
    for (const r of o.rel) dv.setInt32(r.at, o.labels.get(r.label)! - (r.at + 4), true);
    for (const a of o.abs) {
      const t = objs[a.ref.obj];
      const off = t.labels.get(a.ref.label);
      assert.ok(off !== undefined, `label ${a.ref.label}`);
      dv.setUint32(a.at, t.base + off, true);
      fixes[i].push({ srcOff: a.at, obj: a.ref.obj + 1, targetOff: off });
    }
    assert.ok(bytes[i].length <= PAGE);
  });
  const recs: number[][] = fixes.map((fs) =>
    fs.flatMap((f) => [0x07, 0x10, f.srcOff & 0xff, f.srcOff >> 8, f.obj, ...[0, 8, 16, 24].map((s) => (f.targetOff >>> s) & 0xff)]),
  );
  const n = objs.length;
  const le = 0x40;
  const objTab = 0x100;
  const pageMap = objTab + 24 * n;
  const fixPage = pageMap + 4 * n;
  const fixRec = fixPage + 4 * (n + 1);
  const recLen = recs.reduce((s, r) => s + r.length, 0);
  const dataPages = Math.ceil((le + fixRec + recLen) / 0x200) * 0x200;
  const file = new Uint8Array(dataPages + PAGE * (n - 1) + bytes[n - 1].length);
  const v = new DataView(file.buffer);
  file.set([0x4d, 0x5a]);
  v.setUint32(0x3c, le, true);
  file.set([0x4c, 0x45, 0, 0], le);
  const h = (o: number, x: number) => v.setUint32(le + o, x, true);
  h(0x14, n);
  h(0x18, entry.obj + 1);
  h(0x1c, objs[entry.obj].labels.get(entry.label)!);
  h(0x20, esp.obj + 1);
  h(0x24, esp.off);
  h(0x28, PAGE);
  h(0x2c, bytes[n - 1].length);
  h(0x40, objTab);
  h(0x44, n);
  h(0x48, pageMap);
  h(0x68, fixPage);
  h(0x6c, fixRec);
  h(0x80, dataPages);
  let r = 0;
  for (let i = 0; i < n; i++) {
    const o = le + objTab + 24 * i;
    v.setUint32(o, vsizes[i], true);
    v.setUint32(o + 4, objs[i].base, true);
    v.setUint32(o + 8, i === 0 ? 0x2005 : 0x2003, true);
    v.setUint32(o + 12, i + 1, true);
    v.setUint32(o + 16, 1, true);
    file.set([0, 0, i + 1, 0], le + pageMap + 4 * i);
    v.setUint32(le + fixPage + 4 * i, r, true);
    file.set(recs[i], le + fixRec + r);
    r += recs[i].length;
    file.set(bytes[i], dataPages + PAGE * i);
  }
  v.setUint32(le + fixPage + 4 * n, r, true);
  return file;
}

// ------------------------------------------------------------------ the synthetic program
const D = (label: string): Ref => ({ obj: 1, label });
const K = (label: string): Ref => ({ obj: 0, label });

function program() {
  const code = new Obj(0x10000);
  const data = new Obj(0x178000);
  const MSG = "recompiled hello\r\n";
  data.label("res");
  for (let i = 0; i < 16; i++) data.d32(0);
  data.label("fp").abs32(K("triple")).align(16);
  data.label("msg").db(...[...MSG].map((c) => c.charCodeAt(0))).align(16);
  data.label("buf").db(...new Array(32).fill(0));
  for (let i = 0; i < 16; i++) data.labels.set(`res${i}`, i * 4);
  data.labels.set("buf_end", data.labels.get("buf")! + 0x10);
  data.labels.set("buf_last", data.labels.get("buf")! + 0x1c);

  const c = code;
  c.label("_start");
  // recursion: fib(12)
  c.db(0xb8).d32(12).db(0xe8).rel32("fib").db(0xa3).abs32(D("res0"));
  // loop with jcc: sum 1..100
  c.db(0x31, 0xc0, 0xb9).d32(100).label("l1").db(0x01, 0xc8, 0x49, 0x0f, 0x85).rel32("l1").db(0xa3).abs32(D("res1"));
  // switch through a code-object jump table
  c.db(0x31, 0xd2, 0x31, 0xc9).label("sw").db(0xff, 0x24, 0x8d).abs32(K("tbl"));
  c.label("c0").db(0x83, 0xc2, 1, 0xe9).rel32("nx");
  c.label("c1").db(0x83, 0xc2, 10, 0xe9).rel32("nx");
  c.label("c2").db(0x83, 0xc2, 100, 0xe9).rel32("nx");
  c.label("c3").db(0x81, 0xc2).d32(1000);
  c.label("nx").db(0x41, 0x83, 0xf9, 4, 0x0f, 0x82).rel32("sw").db(0x89, 0x15).abs32(D("res2"));
  // indirect call through a function pointer held in data
  c.db(0xb8).d32(7).db(0xff, 0x15).abs32(D("fp")).db(0xa3).abs32(D("res3"));
  // carry chain: 0xffffffff + 1 with adc into edx
  c.db(0xb8).d32(-1).db(0x31, 0xd2, 0x83, 0xc0, 1, 0x83, 0xd2, 0).db(0x89, 0x15).abs32(D("res4")).db(0xa3).abs32(D("res5"));
  // unsigned and signed division
  c.db(0xb8).d32(123456).db(0xb9).d32(1000).db(0x31, 0xd2, 0xf7, 0xf1).db(0xa3).abs32(D("res6")).db(0x89, 0x15).abs32(D("res7"));
  c.db(0xb8).d32(-7).db(0x99, 0xb9).d32(2).db(0xf7, 0xf9).db(0xa3).abs32(D("res8")).db(0x89, 0x15).abs32(D("res9"));
  // shift out a carry, materialise it with sbb
  c.db(0xb8).d32(0x80000001).db(0xd1, 0xe0, 0x19, 0xdb).db(0x89, 0x1d).abs32(D("res10")).db(0xa3).abs32(D("res11"));
  // string instructions: rep stosb then rep movsd (ES starts on the PSP as under DOS/4GW; load it from DS)
  c.db(0x1e, 0x07, 0xfc, 0xbf).abs32(D("buf")).db(0xb9).d32(16).db(0xb0, 0x5a, 0xf3, 0xaa);
  c.db(0xbe).abs32(D("buf")).db(0xbf).abs32(D("buf_end")).db(0xb9).d32(4).db(0xf3, 0xa5);
  c.db(0xa1).abs32(D("buf_last")).db(0xa3).abs32(D("res12"));
  // DOS: write to stdout, then exit(42)
  c.db(0xb8).d32(0x4000).db(0xbb).d32(1).db(0xb9).d32(MSG.length).db(0xba).abs32(D("msg")).db(0xcd, 0x21);
  c.db(0xb8).d32(0x4c2a).db(0xcd, 0x21);
  c.align(4).label("tbl").abs32(K("c0")).abs32(K("c1")).abs32(K("c2")).abs32(K("c3"));
  c.align(16).label("fib");
  c.db(0x83, 0xf8, 2, 0x0f, 0x8c).rel32("fib_ret");
  c.db(0x53, 0x50, 0x48, 0xe8).rel32("fib").db(0x89, 0xc3, 0x58, 0x83, 0xe8, 2, 0xe8).rel32("fib").db(0x01, 0xd8, 0x5b);
  c.label("fib_ret").db(0xc3);
  c.align(16).label("triple").db(0x8d, 0x04, 0x40, 0xc3);

  const file = buildLe([code, data], [code.pc, 0x2000], K("_start"), { obj: 1, off: 0x2000 });
  const image = loadLe(file, GUEST_LAYOUT.objectBases);
  const at = (o: Obj, l: string) => image.objects[o === code ? 0 : 1].base + o.labels.get(l)!;
  const syms: Sym[] = ["_start", "fib", "triple"].map((name) => ({ addr: at(code, name), name, module: "synthetic", code: true }));
  syms.push({ addr: at(data, "res"), name: "results", module: "synthetic", code: false });
  return { code, data, image, syms, at, MSG };
}

test("LE loader relocates objects and applies 32-bit offset fixups", () => {
  const { image, at, code, data } = program();
  assert.equal(image.objects.length, 2);
  assert.deepEqual(image.objects.map((o) => o.base), [...GUEST_LAYOUT.objectBases]);
  assert.equal(image.entryEip, at(code, "_start"));
  assert.equal(image.initialEsp, GUEST_LAYOUT.objectBases[1] + 0x2000);
  // the function pointer in data now holds the relocated address of `triple`
  const fp = data.labels.get("fp")!;
  const dv = new DataView(image.objects[1].bytes.buffer, image.objects[1].bytes.byteOffset);
  assert.equal(dv.getUint32(fp, true), at(code, "triple"));
  assert.ok(image.fixups.some((f) => f.kind === 7 && f.target === at(code, "c3")));
});

test("x86 decoder: lengths, operands and branch targets", () => {
  const { image, at, code } = program();
  const obj = image.objects[0];
  const mem = { u8: (a: number) => obj.bytes[a - obj.base] };
  const first = decode(mem, at(code, "_start"));
  assert.equal(first.op, "mov");
  assert.equal(first.len, 5);
  const call = decode(mem, at(code, "_start") + 5);
  assert.equal(call.op, "call");
  assert.equal(call.target, at(code, "fib"));
  const sw = decode(mem, at(code, "sw"));
  assert.equal(sw.op, "jmpi");
  assert.equal(sw.len, 7);
  const lea = decode(mem, at(code, "triple"));
  assert.equal(lea.op, "lea");
  assert.equal(decode(mem, at(code, "triple") + lea.len).op, "ret");
});

test("analysis recovers functions, the switch table and the address-taken function", () => {
  const { image, syms, at, code } = program();
  const p = analyze(image, syms);
  assert.deepEqual([...p.funcs.keys()].sort((a, b) => a - b), ["_start", "fib", "triple"].map((n) => at(code, n)));
  const start = p.funcs.get(at(code, "_start"))!;
  assert.equal(start.error, undefined);
  assert.deepEqual(start.switches.get(at(code, "sw")), ["c0", "c1", "c2", "c3"].map((n) => at(code, n)));
  assert.ok(p.addressTaken.has(at(code, "triple")));
  // jump-table slots are not mistaken for function pointers
  assert.ok(!p.funcs.has(at(code, "c1")));
});

function haveCc(): string | null {
  for (const cc of [process.env.CC, "gcc", "cc", "clang"]) {
    if (cc && spawnSync(cc, ["--version"], { stdio: "ignore" }).status === 0) return cc;
  }
  return null;
}

test("emitted C compiles with the runtime and reproduces the program's results", { timeout: 180_000 }, (t) => {
  const cc = haveCc();
  if (!cc) {
    t.skip("no C compiler");
    return;
  }
  const { image, syms, at, data, MSG } = program();
  const files = emitProgram(analyze(image, syms), { overrides: HLE_OVERRIDES, functionsPerFile: 2 });
  const dir = mkdtempSync(join(tmpdir(), "hippogriff-recomp-test-"));
  try {
    mkdirSync(join(dir, "gen"));
    for (const f of files) writeFileSync(join(dir, "gen", f.name), f.text);
    const parts: Buffer[] = [Buffer.from(Uint32Array.of(image.objects.length).buffer)];
    for (const o of image.objects) parts.push(Buffer.from(Uint32Array.of(o.base, o.virtualSize).buffer), Buffer.from(o.bytes.subarray(0, o.virtualSize)));
    writeFileSync(join(dir, "image.bin"), Buffer.concat(parts));
    writeFileSync(join(dir, "entry.txt"), `${image.entryEip.toString(16)} ${image.initialEsp.toString(16)}\n`);
    const gen = readdirSync(join(dir, "gen")).filter((f) => f.endsWith(".c")).map((f) => join(dir, "gen", f));
    const rt = ["rt.c", "dos.c", "pc.c", "audio.c"].map((f) => join(ROOT, "runtime", f));
    const exe = join(dir, "host_test");
    execFileSync(cc, ["-O1", "-w", "-fno-strict-aliasing", `-I${join(ROOT, "runtime")}`, `-I${join(dir, "gen")}`, "-o", exe, ...gen, ...rt, join(ROOT, "tests/fixtures/host_test.c"), "-lm"], { stdio: "pipe" });
    const run = spawnSync(exe, [dir, at(data, "res").toString(16)], { encoding: "utf8", timeout: 30_000 });
    assert.equal(run.status, 42, run.stdout + run.stderr);
    assert.match(run.stdout, new RegExp(`\\[guest\\] ${MSG.trim()}`));
    const mem = run.stdout.match(/^mem (.*)$/m)![1].split(" ").map((x) => parseInt(x, 16));
    assert.deepEqual(mem.slice(0, 13), [144, 5050, 1111, 21, 1, 0, 123, 456, 0xfffffffd, 0xffffffff, 0xffffffff, 2, 0x5a5a5a5a]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
