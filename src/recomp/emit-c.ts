// Static translation of recovered x86 functions into portable C.
//
// Model: every recovered function becomes `void F_<addr>(void)`. Guest registers and the lazy flag state
// live in C locals inside a function and are synchronised with the global CPU structure `C` around calls,
// returns and runtime services. Guest memory is a flat byte array addressed through the runtime macros
// RD8/RD16/RD32 and WR8/WR16/WR32. `call` pushes the genuine guest return address so that code which
// inspects the stack sees what it expects; `ret` pops it and returns from the C function. Backward
// branches poll the runtime so timer/keyboard/mouse interrupts can be delivered inside busy-wait loops.
//
// The output is a mechanical translation of the original program and is therefore private, per-user
// build output: it must never be committed or redistributed. This emitter itself contains no program data.

import type { Func, Program } from "./analyze.ts";
import type { Insn, Operand, MemOp, Size } from "./x86.ts";

export interface HleOverride {
  /** C function implemented by the runtime; it performs the whole call including popping the return address. */
  readonly impl: string;
}

export interface EmitOptions {
  readonly overrides: ReadonlyMap<string, HleOverride>; // by symbol name
  readonly functionsPerFile: number;
}

export interface EmittedFile {
  readonly name: string;
  readonly text: string;
}

const R32 = ["eax", "ecx", "edx", "ebx", "esp", "ebp", "esi", "edi"];
const hex = (n: number) => "0x" + (n >>> 0).toString(16);
const fname = (a: number) => "F_" + (a >>> 0).toString(16);
const mask = (s: Size) => (s === 1 ? "0xffu" : s === 2 ? "0xffffu" : "0xffffffffu");
const SZ = (s: Size) => (s === 1 ? 0 : s === 2 ? 1 : 2);
// flag kinds, mirrored in the runtime header
const FK = { ADD: 0, SUB: 1, LOGIC: 2, INC: 3, DEC: 4, SHL: 5, SHR: 6, SAR: 7, MUL: 8, ADC: 9, SBB: 10, EFL: 11 } as const;
const fk = (k: number, s: Size) => (k << 2) | SZ(s);

class FuncEmitter {
  private out: string[] = [];
  private readonly f: Func;
  private readonly p: Program;
  private readonly entries: ReadonlySet<number>;
  private tmp = 0;
  /** The function itself loads DS, so default-segment data accesses must honour the DS base. */
  private readonly dsLoaded: boolean;
  usesFpu = false;

  constructor(p: Program, f: Func, entries: ReadonlySet<number>) {
    this.p = p;
    this.f = f;
    this.entries = entries;
    // The program runs flat (DS base 0) except in startup code that temporarily points DS at the PSP or
    // environment selectors; those routines load DS themselves.
    this.dsLoaded = [...f.insns.values()].some(
      (i) => i.op === "lds" || ((i.op === "movtoseg" || i.op === "pop") && i.ops[0]?.t === "seg" && i.ops[0].r === 3),
    );
  }

  private l(s: string) {
    this.out.push(s);
  }
  private t() {
    return `t${this.tmp++}`;
  }

  addr(m: MemOp): string {
    const parts: string[] = [];
    if (m.base >= 0) parts.push(R32[m.base]);
    if (m.index >= 0) parts.push(m.scale === 1 ? R32[m.index] : `${R32[m.index]}*${m.scale}u`);
    if (m.disp !== 0 || parts.length === 0) parts.push(hex(m.disp) + "u");
    let e = parts.join("+");
    if (m.seg === 4 || m.seg === 5 || m.seg === 0 || m.seg === 3) e = `${e}+C.segbase[${m.seg}]`;
    else if (m.seg < 0 && this.dsLoaded && m.base !== 4 && m.base !== 5) e = `${e}+C.segbase[3]`;
    return `(uint32_t)(${e})`;
  }

  rd(o: Operand, size?: Size): string {
    switch (o.t) {
      case "reg": {
        const s = size ?? o.size;
        if (s === 4) return R32[o.r];
        if (s === 2) return `(${R32[o.r]}&0xffffu)`;
        return o.r < 4 ? `(${R32[o.r]}&0xffu)` : `((${R32[o.r - 4]}>>8)&0xffu)`;
      }
      case "mem": {
        const s = size ?? o.size;
        return `RD${s * 8}(${this.addr(o)})`;
      }
      case "imm": {
        const s = size ?? o.size;
        return hex(s === 4 ? o.v : s === 2 ? o.v & 0xffff : o.v & 0xff) + "u";
      }
      case "seg":
        return `C.seg[${o.r}]`;
      case "st":
        throw new Error("fpu operand in integer context");
    }
  }

  wr(o: Operand, v: string, size?: Size): string {
    switch (o.t) {
      case "reg": {
        const s = size ?? o.size;
        if (s === 4) return `${R32[o.r]}=${v};`;
        if (s === 2) return `${R32[o.r]}=(${R32[o.r]}&0xffff0000u)|((${v})&0xffffu);`;
        if (o.r < 4) return `${R32[o.r]}=(${R32[o.r]}&0xffffff00u)|((${v})&0xffu);`;
        return `${R32[o.r - 4]}=(${R32[o.r - 4]}&0xffff00ffu)|(((${v})&0xffu)<<8);`;
      }
      case "mem": {
        const s = size ?? o.size;
        return `WR${s * 8}(${this.addr(o)},${v});`;
      }
      default:
        throw new Error(`cannot write operand ${o.t}`);
    }
  }

  // Read-modify-write helper: evaluates the address once for memory operands.
  rmw(o: Operand, size: Size, body: (cur: string, set: (v: string) => string) => string[]) {
    if (o.t === "mem") {
      const a = this.t();
      this.l(`{uint32_t ${a}=${this.addr(o)};`);
      const cur = `RD${size * 8}(${a})`;
      for (const s of body(cur, (v) => `WR${size * 8}(${a},${v});`)) this.l(s);
      this.l("}");
    } else {
      this.l("{");
      for (const s of body(this.rd(o, size), (v) => this.wr(o, v, size))) this.l(s);
      this.l("}");
    }
  }

  jumpTo(target: number, insnAddr: number): string {
    if (this.f.insns.has(target)) {
      const back = target <= insnAddr ? "POLL;" : "";
      return `{${back}goto L_${target.toString(16)};}`;
    }
    return `{SO;${this.callee(target)}();return;}`;
  }

  callee(target: number): string {
    return this.entries.has(target) ? fname(target) : `rt_missing_${(target >>> 0).toString(16)}`;
  }

  emit(): string {
    const f = this.f;
    const addrs = [...f.insns.keys()].sort((a, b) => a - b);
    this.l(`/* ${f.name} [${f.module}] */`);
    this.l(`void ${fname(f.entry)}(void){`);
    this.l("SI_DECL;");
    if (f.insns.get(f.entry) === undefined) {
      // a code pointer into non-code bytes (e.g. constants in the code object): never executed
      this.l(`rt_trap(${hex(f.entry)},"undecodable entry");`);
    }
    // entry may not be the lowest address: jump to it first
    else if (addrs[0] !== f.entry) this.l(`goto L_${f.entry.toString(16)};`);
    for (let k = 0; k < addrs.length; k++) {
      const a = addrs[k];
      const i = f.insns.get(a)!;
      if (f.labels.has(a) || a === f.entry) this.l(`L_${a.toString(16)}:;`);
      this.insn(i);
      const next = a + i.len;
      if (!isTerminal(i) && !f.insns.has(next)) {
        // fallthrough leaves the recovered body
        if (f.error && !this.entries.has(next)) this.l(`rt_trap(${hex(next)},"decode failure");`);
        else this.l(`SO;${this.callee(next)}();return;`);
      } else if (!isTerminal(i)) {
        // overlapping decodes: continue at the real next instruction
        if (addrs[k + 1] !== next) {
          this.l(`goto L_${next.toString(16)};`);
          f.labels.add(next);
        }
      }
    }
    this.l("}");
    return this.out.join("\n");
  }

  setFlags(kind: number, size: Size, r: string, a: string, b: string) {
    this.l(`fk=${fk(kind, size)};fr=${r};fa=${a};fb=${b};`);
  }

  cond(cc: number): string {
    return `CC(${cc})`;
  }

  insn(i: Insn) {
    const o = i.ops;
    const s = i.osize;
    const next = i.addr + i.len;
    switch (i.op) {
      case "nop":
      case "fwait":
        return;
      case "mov":
        this.l(this.wr(o[0], this.rd(o[1], o[0].t === "reg" || o[0].t === "mem" ? (o[0] as { size: Size }).size : s)));
        return;
      case "movzx":
        this.l(this.wr(o[0], this.rd(o[1])));
        return;
      case "movsx": {
        const src = o[1] as { size: Size };
        const e = src.size === 1 ? `(uint32_t)(int32_t)(int8_t)${this.rd(o[1])}` : `(uint32_t)(int32_t)(int16_t)${this.rd(o[1])}`;
        this.l(this.wr(o[0], e));
        return;
      }
      case "lea":
        this.l(this.wr(o[0], this.addr(o[1] as MemOp).replace(/\+C\.segbase\[\d\]/, "")));
        return;
      case "add":
      case "sub":
      case "and":
      case "or":
      case "xor":
      case "adc":
      case "sbb":
      case "cmp": {
        const sz = (o[0] as { size: Size }).size;
        const opc = i.op;
        // xor r,r / sub r,r: constant zero
        if ((opc === "xor" || opc === "sub") && o[0].t === "reg" && o[1].t === "reg" && o[0].r === o[1].r && o[0].size === o[1].size) {
          this.l(this.wr(o[0], "0u"));
          this.setFlags(opc === "xor" ? FK.LOGIC : FK.SUB, sz, "0u", "0u", "0u");
          return;
        }
        this.rmw(o[0], sz, (cur, set) => {
          const res: string[] = [`uint32_t a=${cur},b=${this.rd(o[1], sz)},r;`];
          const m = mask(sz);
          switch (opc) {
            case "add":
              res.push(`r=(a+b)&${m};`, set("r"), `fk=${fk(FK.ADD, sz)};fr=r;fa=a;fb=b;`);
              break;
            case "sub":
              res.push(`r=(a-b)&${m};`, set("r"), `fk=${fk(FK.SUB, sz)};fr=r;fa=a;fb=b;`);
              break;
            case "cmp":
              res.push(`r=(a-b)&${m};`, `fk=${fk(FK.SUB, sz)};fr=r;fa=a;fb=b;`);
              break;
            case "and":
            case "or":
            case "xor":
              res.push(`r=a${opc === "and" ? "&" : opc === "or" ? "|" : "^"}b;`, set("r"), `fk=${fk(FK.LOGIC, sz)};fr=r;fa=a;fb=b;`);
              break;
            case "adc":
              res.push(`uint32_t c=GETCF;r=(a+b+c)&${m};`, set("r"), `fk=${fk(FK.ADC, sz)};fr=r;fa=a;fb=b;fc=c;`);
              break;
            case "sbb":
              res.push(`uint32_t c=GETCF;r=(a-b-c)&${m};`, set("r"), `fk=${fk(FK.SBB, sz)};fr=r;fa=a;fb=b;fc=c;`);
              break;
          }
          return res;
        });
        return;
      }
      case "test": {
        const sz = (o[0] as { size: Size }).size;
        this.l(`{uint32_t r=${this.rd(o[0], sz)}&${this.rd(o[1], sz)};fk=${fk(FK.LOGIC, sz)};fr=r;fa=r;fb=0;}`);
        return;
      }
      case "inc":
      case "dec": {
        const sz = (o[0] as { size: Size }).size;
        this.rmw(o[0], sz, (cur, set) => [
          `uint32_t c=GETCF,a=${cur},r=(a${i.op === "inc" ? "+" : "-"}1u)&${mask(sz)};`,
          set("r"),
          `fk=${fk(i.op === "inc" ? FK.INC : FK.DEC, sz)};fr=r;fa=a;fb=1;fc=c;`,
        ]);
        return;
      }
      case "neg": {
        const sz = (o[0] as { size: Size }).size;
        this.rmw(o[0], sz, (cur, set) => [`uint32_t b=${cur},r=(0u-b)&${mask(sz)};`, set("r"), `fk=${fk(FK.SUB, sz)};fr=r;fa=0;fb=b;`]);
        return;
      }
      case "not": {
        const sz = (o[0] as { size: Size }).size;
        this.rmw(o[0], sz, (cur, set) => [set(`(~${cur})&${mask(sz)}`)]);
        return;
      }
      case "shl":
      case "shr":
      case "sar":
      case "rol":
      case "ror":
      case "rcl":
      case "rcr": {
        const sz = (o[0] as { size: Size }).size;
        const cnt = o[1].t === "imm" ? `${o[1].v & 31}u` : `(ecx&31u)`;
        if (o[1].t === "imm" && (o[1].v & 31) === 0) return;
        this.rmw(o[0], sz, (cur, set) => [`uint32_t n=${cnt};`, `if(n){uint32_t v=${cur},r;`, `r=${i.op.toUpperCase()}${sz * 8}(v,n);`, set("r"), "}"]);
        return;
      }
      case "shld":
      case "shrd": {
        const cnt = o[2].t === "imm" ? `${o[2].v & 31}u` : `(ecx&31u)`;
        const sz = (o[0] as { size: Size }).size;
        this.rmw(o[0], sz, (cur, set) => [
          `uint32_t n=${cnt};`,
          `if(n){uint32_t v=${cur},r;r=${i.op.toUpperCase()}${sz * 8}(v,${this.rd(o[1], sz)},n);`,
          set("r"),
          "}",
        ]);
        return;
      }
      case "imul2":
      case "imul3": {
        const a = i.op === "imul2" ? this.rd(o[0]) : this.rd(o[1]);
        const b = i.op === "imul2" ? this.rd(o[1]) : this.rd(o[2]);
        const sz = (o[0] as { size: Size }).size;
        const st = sz === 4 ? "int32_t" : "int16_t";
        this.l(`{int64_t p=(int64_t)(${st})${a}*(int64_t)(${st})${b};uint32_t r=(uint32_t)p&${mask(sz)};`);
        this.l(this.wr(o[0], "r"));
        this.l(`fk=${fk(FK.MUL, sz)};fr=r;fa=0;fb=0;fc=(p!=(int64_t)(${st})r);}`);
        return;
      }
      case "mul":
      case "imul1":
      case "div":
      case "idiv": {
        const sz = (o[0] as { size: Size }).size;
        this.l(`{uint32_t s=${this.rd(o[0], sz)};${i.op.toUpperCase()}${sz * 8}(s);}`);
        return;
      }
      case "cwde":
        this.l("eax=(uint32_t)(int32_t)(int16_t)(eax&0xffffu);");
        return;
      case "cbw":
        this.l("eax=(eax&0xffff0000u)|((uint32_t)(int16_t)(int8_t)(eax&0xffu)&0xffffu);");
        return;
      case "cdq":
        this.l("edx=(eax&0x80000000u)?0xffffffffu:0u;");
        return;
      case "cwd":
        this.l("edx=(edx&0xffff0000u)|((eax&0x8000u)?0xffffu:0u);");
        return;
      case "xchg": {
        if (o[0].t === "reg" && o[1].t === "reg" && o[0].r === o[1].r) return;
        const sz = (o[0] as { size: Size }).size;
        this.rmw(o[0], sz, (cur, set) => [`uint32_t a=${cur},b=${this.rd(o[1], sz)};`, set("b"), this.wr(o[1], "a", sz)]);
        return;
      }
      case "xadd": {
        const sz = (o[0] as { size: Size }).size;
        this.rmw(o[0], sz, (cur, set) => [
          `uint32_t a=${cur},b=${this.rd(o[1], sz)},r=(a+b)&${mask(sz)};`,
          this.wr(o[1], "a", sz),
          set("r"),
          `fk=${fk(FK.ADD, sz)};fr=r;fa=a;fb=b;`,
        ]);
        return;
      }
      case "cmpxchg": {
        const sz = (o[0] as { size: Size }).size;
        this.rmw(o[0], sz, (cur, set) => [
          `uint32_t d=${cur},a=${this.rd({ t: "reg", size: sz, r: 0 })},r=(a-d)&${mask(sz)};`,
          `fk=${fk(FK.SUB, sz)};fr=r;fa=a;fb=d;`,
          `if(!r){${set(this.rd(o[1], sz))}}else{${this.wr({ t: "reg", size: sz, r: 0 }, "d")}}`,
        ]);
        return;
      }
      case "bswap":
        this.l(`${R32[(o[0] as { r: number }).r]}=__builtin_bswap32(${R32[(o[0] as { r: number }).r]});`);
        return;
      case "bt":
      case "bts":
      case "btr":
      case "btc": {
        const sz = (o[0] as { size: Size }).size;
        const bits = sz * 8;
        let target = o[0];
        let bitExpr: string;
        if (o[1].t === "imm") bitExpr = `${o[1].v & (bits - 1)}u`;
        else if (o[0].t === "mem") {
          // register bit offset addresses memory beyond the operand
          const m = o[0];
          const t = this.t();
          this.l(`{int32_t ${t}=(int32_t)${this.rd(o[1], sz)};`);
          const adj = `(uint32_t)((${t}>>${sz === 4 ? 5 : 4})*${sz})`;
          target = { ...m, disp: 0, base: -1, index: -1 } as MemOp;
          const base = this.addr(m);
          const a2 = this.t();
          this.l(`uint32_t ${a2}=${base}+${adj};`);
          bitExpr = `((uint32_t)${t}&${bits - 1}u)`;
          const op = i.op;
          this.l(`{uint32_t v=RD${bits}(${a2}),c=(v>>${bitExpr})&1u;MATFLAGS;fr=(fr&~1u)|c;`);
          if (op === "bts") this.l(`WR${bits}(${a2},v|(1u<<${bitExpr}));`);
          if (op === "btr") this.l(`WR${bits}(${a2},v&~(1u<<${bitExpr}));`);
          if (op === "btc") this.l(`WR${bits}(${a2},v^(1u<<${bitExpr}));`);
          this.l("}}");
          return;
        } else bitExpr = `(${this.rd(o[1], sz)}&${bits - 1}u)`;
        this.rmw(target, sz, (cur, set) => {
          const r = [`uint32_t v=${cur},n=${bitExpr},c=(v>>n)&1u;MATFLAGS;fr=(fr&~1u)|c;`];
          if (i.op === "bts") r.push(set("v|(1u<<n)"));
          if (i.op === "btr") r.push(set("v&~(1u<<n)"));
          if (i.op === "btc") r.push(set("v^(1u<<n)"));
          return r;
        });
        return;
      }
      case "bsf":
      case "bsr": {
        const sz = (o[0] as { size: Size }).size;
        this.l(`{uint32_t v=${this.rd(o[1], sz)};MATFLAGS;if(!v){fr|=0x40u;}else{fr&=~0x40u;`);
        this.l(this.wr(o[0], i.op === "bsf" ? "(uint32_t)__builtin_ctz(v)" : "(uint32_t)(31-__builtin_clz(v))"));
        this.l("}}");
        return;
      }
      case "setcc":
        this.l(this.wr(o[0], `(${this.cond(i.cc)}?1u:0u)`));
        return;
      case "cmovcc":
        this.l(`if(${this.cond(i.cc)}){${this.wr(o[0], this.rd(o[1]))}}`);
        return;
      case "jcc":
        this.l(`if(${this.cond(i.cc)})${this.jumpTo(i.target, i.addr)}`);
        return;
      case "loop":
      case "loope":
      case "loopne": {
        const extra = i.op === "loope" ? "&&CC(4)" : i.op === "loopne" ? "&&CC(5)" : "";
        this.l(`ecx--;if(ecx${extra})${this.jumpTo(i.target, i.addr)}`);
        return;
      }
      case "jecxz":
        this.l(`if(!ecx)${this.jumpTo(i.target, i.addr)}`);
        return;
      case "jmp":
        this.l(this.jumpTo(i.target, i.addr));
        return;
      case "jmpi": {
        const sw = this.f.switches.get(i.addr);
        const m = o[0];
        if (sw && m.t === "mem") {
          this.l(`switch(RD32(${this.addr(m)})){`);
          for (const t of new Set(sw)) this.l(`case ${hex(t)}u:goto L_${t.toString(16)};`);
          this.l(`default:SO;rt_call(RD32(${this.addr(m)}));return;}`);
        } else this.l(`{uint32_t t=${this.rd(o[0], 4)};SO;rt_call(t);return;}`);
        return;
      }
      case "call":
        this.l(`esp-=4;WR32(esp,${hex(next)}u);SO;${this.callee(i.target)}();RET_CHECK(${hex(next)}u);SIN;`);
        return;
      case "calli":
        this.l(`{uint32_t t=${this.rd(o[0], 4)};esp-=4;WR32(esp,${hex(next)}u);SO;rt_call(t);RET_CHECK(${hex(next)}u);SIN;}`);
        return;
      case "ret": {
        const n = o.length ? o[0].t === "imm" ? o[0].v : 0 : 0;
        this.l(`C.ret_to=RD32(esp);esp+=${4 + n}u;SO;return;`);
        return;
      }
      case "iret":
        this.l("{uint32_t ef=RD32(esp+8);C.ret_to=RD32(esp);esp+=12;SETEFL(ef);SO;return;}");
        return;
      case "retf": {
        const n = o.length ? (o[0] as { v: number }).v : 0;
        this.l(`C.ret_to=RD32(esp);esp+=${8 + n}u;SO;return;`);
        return;
      }
      case "push": {
        const v = o[0];
        if (v.t === "reg" && v.r === 4) {
          this.l("{uint32_t v=esp;esp-=4;WR32(esp,v);}");
          return;
        }
        if (v.t === "seg") {
          this.l(`esp-=4;WR16(esp,C.seg[${v.r}]);`);
          return;
        }
        const sz: Size = s === 2 ? 2 : 4;
        if (v.t === "mem") this.l(`{uint32_t v=${this.rd(v, sz)};esp-=${sz};WR${sz * 8}(esp,v);}`);
        else this.l(`{uint32_t v=${this.rd(v, sz)};esp-=${sz};WR${sz * 8}(esp,v);}`);
        return;
      }
      case "pop": {
        const v = o[0];
        if (v.t === "seg") {
          this.l(`{uint32_t v=RD16(esp);esp+=4;SO;rt_setseg(${v.r},v);}`);
          return;
        }
        const sz: Size = s === 2 ? 2 : 4;
        if (v.t === "reg" && v.r === 4) {
          this.l("esp=RD32(esp);");
          return;
        }
        // x86 computes the destination address after incrementing esp
        this.l(`{uint32_t v=RD${sz * 8}(esp);esp+=${sz};${this.wr(v, "v", sz)}}`);
        return;
      }
      case "pusha":
        this.l("{uint32_t s0=esp;esp-=32;WR32(esp+28,eax);WR32(esp+24,ecx);WR32(esp+20,edx);WR32(esp+16,ebx);WR32(esp+12,s0);WR32(esp+8,ebp);WR32(esp+4,esi);WR32(esp,edi);}");
        return;
      case "popa":
        this.l("edi=RD32(esp);esi=RD32(esp+4);ebp=RD32(esp+8);ebx=RD32(esp+16);edx=RD32(esp+20);ecx=RD32(esp+24);eax=RD32(esp+28);esp+=32;");
        return;
      case "pushf":
        this.l("{uint32_t v=EFLAGS;esp-=4;WR32(esp,v);}");
        return;
      case "popf":
        this.l("{uint32_t v=RD32(esp);esp+=4;SETEFL(v);}");
        return;
      case "lahf":
        this.l("{uint32_t v=EFLAGS;eax=(eax&0xffff00ffu)|((v&0xd5u)<<8)|0x200u;}");
        return;
      case "sahf":
        this.l("{uint32_t v=EFLAGS;SETEFL((v&~0xd5u)|((eax>>8)&0xd5u));}");
        return;
      case "clc":
        this.l("MATFLAGS;fr&=~1u;");
        return;
      case "stc":
        this.l("MATFLAGS;fr|=1u;");
        return;
      case "cmc":
        this.l("MATFLAGS;fr^=1u;");
        return;
      case "cld":
        this.l("C.df=0;");
        return;
      case "std":
        this.l("C.df=1;");
        return;
      case "cli":
        this.l("C.iflag=0;");
        return;
      case "sti":
        this.l("C.iflag=1;POLL;");
        return;
      case "enter": {
        const n = (o[0] as { v: number }).v;
        this.l(`esp-=4;WR32(esp,ebp);ebp=esp;esp-=${n}u;`);
        return;
      }
      case "leave":
        this.l("esp=ebp;ebp=RD32(esp);esp+=4;");
        return;
      case "movs":
      case "stos":
      case "lods":
      case "scas":
      case "cmps":
      case "ins":
      case "outs": {
        const r = i.rep === 0 ? "" : i.rep === 1 ? "REP" : "REPNE";
        if (i.op === "ins" || i.op === "outs") {
          this.l(`SO;rt_${i.op}(${s},${i.rep});SIN;`);
          return;
        }
        this.l(`${r}${i.op.toUpperCase()}${s * 8};`);
        return;
      }
      case "movfromseg":
        this.l(this.wr(o[0], `(uint32_t)C.seg[${(o[1] as { r: number }).r}]`));
        return;
      case "movtoseg":
        this.l(`{uint32_t v=${this.rd(o[1], 2)};SO;rt_setseg(${(o[0] as { r: number }).r},v);}`);
        return;
      case "les":
      case "lds":
      case "lss":
      case "lfs":
      case "lgs": {
        const seg = { les: 0, lds: 3, lss: 2, lfs: 4, lgs: 5 }[i.op];
        const m = o[1] as MemOp;
        this.l(`{uint32_t a=${this.addr(m)},off=RD32(a),sel=RD16(a+4);${this.wr(o[0], "off")}SO;rt_setseg(${seg},sel);}`);
        return;
      }
      case "int":
        this.l(`SO;rt_int(${(o[0] as { v: number }).v},${hex(next)}u);SIN;`);
        return;
      case "into":
        this.l("if(CC(0)){SO;rt_int(4,0);SIN;}");
        return;
      case "in": {
        const port = o.length ? `${(o[0] as { v: number }).v}u` : "(edx&0xffffu)";
        this.l(`{uint32_t v=rt_in(${port},${s});${this.wr({ t: "reg", size: s, r: 0 }, "v")}}`);
        return;
      }
      case "out": {
        const port = o.length ? `${(o[0] as { v: number }).v}u` : "(edx&0xffffu)";
        this.l(`rt_out(${port},${s},${this.rd({ t: "reg", size: s, r: 0 })});`);
        return;
      }
      case "hlt":
        this.l(`SO;rt_trap(${hex(i.addr)},"hlt");return;`);
        return;
      case "xlat":
        this.l("eax=(eax&0xffffff00u)|RD8(ebx+(eax&0xffu));");
        return;
      case "cpuid":
      case "rdtsc":
      case "lar":
      case "lsl":
      case "sysop":
      case "bound":
      case "callf":
      case "jmpf":
        if (o[0]?.t === "mem") {
          // far pointer through memory (m16:32); used to chain to a previous interrupt handler
          const a = this.addr(o[0]);
          if (i.op === "callf")
            this.l(`{uint32_t a=${a},off=RD32(a);esp-=8;WR32(esp+4,C.seg[1]);WR32(esp,${hex(next)}u);SO;rt_far_invoke(off,${hex(next)}u);SIN;}`);
          else this.l(`{uint32_t off=RD32(${a});SO;rt_call(off);return;}`);
          return;
        }
        this.l(`SO;rt_special(${hex(i.addr)},"${i.op}");SIN;`);
        if (i.op === "jmpf") this.l("return;");
        return;
      case "movcr":
      case "daa":
      case "das":
      case "aaa":
      case "aas":
      case "aam":
      case "aad":
        // rare system/BCD instructions: handled (or trapped) by the runtime with full register state
        this.l(`SO;rt_special(${hex(i.addr)},"${i.op}");SIN;`);
        if (i.op === "jmpf") this.l("return;");
        return;
    }
    if (i.op.startsWith("f")) {
      this.fpu(i);
      return;
    }
    this.l(`SO;rt_trap(${hex(i.addr)},"unhandled ${i.op}");return;`);
  }

  fpu(i: Insn) {
    this.usesFpu = true;
    const o = i.ops;
    const m = o.find((x) => x.t === "mem") as MemOp | undefined;
    const sts = o.filter((x) => x.t === "st").map((x) => (x as { i: number }).i);
    const a = m ? this.addr(m) : "0u";
    const sz = m ? m.size : 0;
    if (i.op === "fnstswax") {
      this.l("eax=(eax&0xffff0000u)|FPU_SW();");
      return;
    }
    // generic dispatch to the runtime x87 model: op name, memory address/size, st operands
    this.l(`FPU(${JSON.stringify(i.op)},${a},${sz},${sts[0] ?? -1},${sts[1] ?? -1});`);
  }
}

function isTerminal(i: Insn): boolean {
  return ["jmp", "jmpi", "ret", "retf", "iret", "jmpf", "hlt"].includes(i.op);
}

export function emitProgram(p: Program, opts: EmitOptions): EmittedFile[] {
  const entries = new Set(p.funcs.keys());
  const files: EmittedFile[] = [];
  const funcs = [...p.funcs.values()].sort((a, b) => a.entry - b.entry);
  const decls = funcs.map((f) => `void ${fname(f.entry)}(void);`);
  const missing = new Set<number>();
  files.push({ name: "funcs.h", text: `#pragma once\n${decls.join("\n")}\n` });
  let chunk: string[] = [];
  let n = 0;
  const flush = () => {
    if (!chunk.length) return;
    files.push({ name: `code_${String(n).padStart(3, "0")}.c`, text: `#include "rt.h"\n#include "funcs.h"\n${chunk.join("\n\n")}\n` });
    n++;
    chunk = [];
  };
  for (const f of funcs) {
    const ov = opts.overrides.get(f.name);
    let text: string;
    if (ov) text = `/* ${f.name}: native implementation */\nvoid ${fname(f.entry)}(void){${ov.impl}();}`;
    else {
      const e = new FuncEmitter(p, f, entries);
      text = e.emit();
      for (const mm of text.matchAll(/rt_missing_([0-9a-f]+)/g)) missing.add(parseInt(mm[1], 16));
    }
    chunk.push(text);
    if (chunk.length >= opts.functionsPerFile) flush();
  }
  flush();
  const disp: string[] = ['#include "rt.h"', '#include "funcs.h"'];
  for (const a of missing) disp.push(`void rt_missing_${a.toString(16)}(void){rt_trap(${hex(a)},"missing function");}`);
  disp.push("void rt_call(uint32_t a){switch(a){");
  for (const f of funcs) disp.push(`case ${hex(f.entry)}u:${fname(f.entry)}();return;`);
  disp.push("default:rt_bad_call(a);}}");
  disp.push("const uint32_t rt_func_addrs[]={" + funcs.map((f) => hex(f.entry) + "u").join(",") + "};");
  disp.push(`const unsigned rt_func_count=${funcs.length};`);
  disp.push("const char*const rt_func_names[]={" + funcs.map((f) => JSON.stringify(f.name)).join(",") + "};");
  files.push({ name: "dispatch.c", text: disp.join("\n") + "\n" });
  if (missing.size) {
    const h = files[0];
    files[0] = { name: h.name, text: h.text + [...missing].map((a) => `void rt_missing_${a.toString(16)}(void);`).join("\n") + "\n" };
  }
  return files;
}
