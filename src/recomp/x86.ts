// IA-32 instruction decoder for 32-bit flat-model code (as emitted by Watcom C/C++ 10.x and hand-written
// 386 assembly). It decodes instructions into a structured form used by the static recompiler.
// Independently written from the public Intel architecture manuals.

export type Size = 1 | 2 | 4 | 8 | 10;

export interface RegOp {
  readonly t: "reg";
  readonly size: Size;
  readonly r: number; // 0..7; for size 1: 0-3 = al,cl,dl,bl; 4-7 = ah,ch,dh,bh
}
export interface MemOp {
  readonly t: "mem";
  readonly size: Size;
  readonly base: number; // -1 = none
  readonly index: number; // -1 = none
  readonly scale: number;
  readonly disp: number; // signed 32-bit
  readonly seg: number; // -1 = default, else 0=es,1=cs,2=ss,3=ds,4=fs,5=gs
  readonly dispAt: number; // address of the displacement field (for fixup lookups), -1 if none
}
export interface ImmOp {
  readonly t: "imm";
  readonly size: Size;
  readonly v: number; // sign-extended to operand size, stored unsigned 32-bit
  readonly at: number; // address of the immediate field
}
export interface SegOp {
  readonly t: "seg";
  readonly r: number; // 0=es,1=cs,2=ss,3=ds,4=fs,5=gs
}
export interface FpuOp {
  readonly t: "st";
  readonly i: number; // st(i)
}
export type Operand = RegOp | MemOp | ImmOp | SegOp | FpuOp;

export interface Insn {
  readonly addr: number;
  readonly len: number;
  readonly op: string; // mnemonic, e.g. "add", "jcc", "movzx"
  readonly cc: number; // condition code for jcc/setcc/cmovcc (0..15), else -1
  readonly ops: Operand[];
  readonly osize: Size; // effective operand size for the instruction (1, 2 or 4)
  readonly rep: 0 | 1 | 2; // 0 none, 1 = rep/repe (F3), 2 = repne (F2)
  readonly target: number; // branch target for relative jumps/calls, else -1
  readonly far: boolean;
}

export class DecodeError extends Error {
  readonly addr: number;
  constructor(addr: number, msg: string) {
    super(`decode error at ${addr.toString(16)}: ${msg}`);
    this.addr = addr;
  }
}

export const CC_NAMES = ["o", "no", "b", "ae", "e", "ne", "be", "a", "s", "ns", "p", "np", "l", "ge", "le", "g"];
const ALU = ["add", "or", "adc", "sbb", "and", "sub", "xor", "cmp"];
const SHIFT = ["rol", "ror", "rcl", "rcr", "shl", "shr", "sal", "sar"];

export interface CodeReader {
  u8(addr: number): number;
}

export function decode(mem: CodeReader, addr: number): Insn {
  let p = addr;
  let osize: Size = 4;
  let asize = 4;
  let seg = -1;
  let rep: 0 | 1 | 2 = 0;
  const u8 = () => mem.u8(p++);
  const s8 = () => (u8() << 24) >> 24;
  const u16 = () => {
    const v = mem.u8(p) | (mem.u8(p + 1) << 8);
    p += 2;
    return v;
  };
  const u32 = () => {
    const v = (mem.u8(p) | (mem.u8(p + 1) << 8) | (mem.u8(p + 2) << 16) | (mem.u8(p + 3) << 24)) >>> 0;
    p += 4;
    return v;
  };
  // prefixes
  for (;;) {
    const b = mem.u8(p);
    if (b === 0x66) osize = 2;
    else if (b === 0x67) asize = 2;
    else if (b === 0xf3) rep = 1;
    else if (b === 0xf2) rep = 2;
    else if (b === 0xf0) {
      /* lock: ignored */
    } else if (b === 0x26) seg = 0;
    else if (b === 0x2e) seg = 1;
    else if (b === 0x36) seg = 2;
    else if (b === 0x3e) seg = 3;
    else if (b === 0x64) seg = 4;
    else if (b === 0x65) seg = 5;
    else break;
    p++;
    if (p - addr > 14) throw new DecodeError(addr, "too many prefixes");
  }
  if (asize !== 4) throw new DecodeError(addr, "16-bit addressing not supported");

  let modrm = -1;
  const getModrm = () => {
    if (modrm < 0) modrm = u8();
    return modrm;
  };
  const reg = (size: Size, r: number): RegOp => ({ t: "reg", size, r });
  const rm = (size: Size): Operand => {
    const m = getModrm();
    const mod = m >> 6;
    const r = m & 7;
    if (mod === 3) return reg(size, r);
    let base = -1;
    let index = -1;
    let scale = 1;
    let disp = 0;
    let dispAt = -1;
    if (r === 4) {
      const sib = u8();
      scale = 1 << (sib >> 6);
      index = (sib >> 3) & 7;
      if (index === 4) index = -1;
      base = sib & 7;
      if (base === 5 && mod === 0) {
        base = -1;
        dispAt = p;
        disp = u32() | 0;
      }
    } else if (r === 5 && mod === 0) {
      dispAt = p;
      disp = u32() | 0;
    } else base = r;
    if (mod === 1) {
      dispAt = p;
      disp = s8();
    } else if (mod === 2) {
      dispAt = p;
      disp = u32() | 0;
    }
    return { t: "mem", size, base, index, scale, disp, seg, dispAt };
  };
  const regField = () => (getModrm() >> 3) & 7;
  const imm = (size: Size): ImmOp => {
    const at = p;
    const v = size === 1 ? u8() : size === 2 ? u16() : u32();
    return { t: "imm", size, v, at };
  };
  const simm8 = (size: Size): ImmOp => {
    const at = p;
    const v = s8();
    const m = size === 4 ? v >>> 0 : size === 2 ? v & 0xffff : v & 0xff;
    return { t: "imm", size, v: m, at };
  };
  const moffs = (size: Size): MemOp => {
    const dispAt = p;
    return { t: "mem", size, base: -1, index: -1, scale: 1, disp: u32() | 0, seg, dispAt };
  };

  let op = "";
  let cc = -1;
  let ops: Operand[] = [];
  let target = -1;
  let far = false;
  let isize: Size = osize;
  const b = u8();

  if (b < 0x40 && (b & 7) < 6) {
    op = ALU[b >> 3];
    const k = b & 7;
    if (k === 0) ((isize = 1), (ops = [rm(1), reg(1, regField())]));
    else if (k === 1) ops = [rm(osize), reg(osize, regField())];
    else if (k === 2) ((isize = 1), (ops = [reg(1, regField()), rm(1)]));
    else if (k === 3) ops = [reg(osize, regField()), rm(osize)];
    else if (k === 4) ((isize = 1), (ops = [reg(1, 0), imm(1)]));
    else ops = [reg(osize, 0), imm(osize)];
  } else if (b === 0x06 || b === 0x0e || b === 0x16 || b === 0x1e) {
    op = "push";
    ops = [{ t: "seg", r: b >> 3 }];
  } else if (b === 0x07 || b === 0x17 || b === 0x1f) {
    op = "pop";
    ops = [{ t: "seg", r: b >> 3 }];
  } else if (b === 0x27) op = "daa";
  else if (b === 0x2f) op = "das";
  else if (b === 0x37) op = "aaa";
  else if (b === 0x3f) op = "aas";
  else if (b >= 0x40 && b < 0x48) ((op = "inc"), (ops = [reg(osize, b & 7)]));
  else if (b >= 0x48 && b < 0x50) ((op = "dec"), (ops = [reg(osize, b & 7)]));
  else if (b >= 0x50 && b < 0x58) ((op = "push"), (ops = [reg(osize, b & 7)]));
  else if (b >= 0x58 && b < 0x60) ((op = "pop"), (ops = [reg(osize, b & 7)]));
  else if (b === 0x60) op = "pusha";
  else if (b === 0x61) op = "popa";
  else if (b === 0x62) ((op = "bound"), (ops = [reg(osize, regField()), rm(osize)]));
  else if (b === 0x68) ((op = "push"), (ops = [imm(osize)]));
  else if (b === 0x69) {
    op = "imul3";
    const r = reg(osize, regField());
    const s = rm(osize);
    ops = [r, s, imm(osize)];
  } else if (b === 0x6a) ((op = "push"), (ops = [simm8(osize)]));
  else if (b === 0x6b) {
    op = "imul3";
    const r = reg(osize, regField());
    const s = rm(osize);
    ops = [r, s, simm8(osize)];
  } else if (b >= 0x6c && b <= 0x6f) {
    op = b < 0x6e ? "ins" : "outs";
    isize = b & 1 ? osize : 1;
  } else if (b >= 0x70 && b < 0x80) {
    op = "jcc";
    cc = b & 15;
    const d = s8();
    target = (p + d) >>> 0;
  } else if (b >= 0x80 && b <= 0x83) {
    const sz: Size = b === 0x80 || b === 0x82 ? 1 : osize;
    isize = sz;
    const dst = rm(sz);
    op = ALU[regField()];
    ops = [dst, b === 0x83 ? simm8(sz) : imm(sz)];
  } else if (b === 0x84 || b === 0x85) {
    op = "test";
    isize = b === 0x84 ? 1 : osize;
    ops = [rm(isize), reg(isize, regField())];
  } else if (b === 0x86 || b === 0x87) {
    op = "xchg";
    isize = b === 0x86 ? 1 : osize;
    ops = [rm(isize), reg(isize, regField())];
  } else if (b >= 0x88 && b <= 0x8b) {
    op = "mov";
    isize = b & 1 ? osize : 1;
    if (b & 2) ops = [reg(isize, regField()), rm(isize)];
    else ops = [rm(isize), reg(isize, regField())];
  } else if (b === 0x8c) {
    op = "movfromseg";
    isize = 2;
    const d = rm(getModrm() >> 6 === 3 ? osize : 2);
    ops = [d, { t: "seg", r: regField() }];
  } else if (b === 0x8d) {
    op = "lea";
    ops = [reg(osize, regField()), rm(osize)];
  } else if (b === 0x8e) {
    op = "movtoseg";
    isize = 2;
    const s = rm(2);
    ops = [{ t: "seg", r: regField() }, s];
  } else if (b === 0x8f) ((op = "pop"), (ops = [rm(osize)]));
  else if (b === 0x90) op = "nop";
  else if (b > 0x90 && b < 0x98) ((op = "xchg"), (ops = [reg(osize, 0), reg(osize, b & 7)]));
  else if (b === 0x98) op = osize === 2 ? "cbw" : "cwde";
  else if (b === 0x99) op = osize === 2 ? "cwd" : "cdq";
  else if (b === 0x9a) {
    op = "callf";
    far = true;
    const at = p;
    const off = osize === 2 ? u16() : u32();
    const sel = u16();
    ops = [{ t: "imm", size: 4, v: off, at }, { t: "imm", size: 2, v: sel, at: p - 2 }];
  } else if (b === 0x9b) op = "fwait";
  else if (b === 0x9c) op = "pushf";
  else if (b === 0x9d) op = "popf";
  else if (b === 0x9e) op = "sahf";
  else if (b === 0x9f) op = "lahf";
  else if (b >= 0xa0 && b <= 0xa3) {
    op = "mov";
    isize = b & 1 ? osize : 1;
    if (b & 2) ops = [moffs(isize), reg(isize, 0)];
    else ops = [reg(isize, 0), moffs(isize)];
  } else if (b >= 0xa4 && b <= 0xa7) {
    op = b < 0xa6 ? "movs" : "cmps";
    isize = b & 1 ? osize : 1;
  } else if (b === 0xa8) ((op = "test"), (isize = 1), (ops = [reg(1, 0), imm(1)]));
  else if (b === 0xa9) ((op = "test"), (ops = [reg(osize, 0), imm(osize)]));
  else if (b >= 0xaa && b <= 0xaf) {
    op = b < 0xac ? "stos" : b < 0xae ? "lods" : "scas";
    isize = b & 1 ? osize : 1;
  } else if (b >= 0xb0 && b < 0xb8) ((op = "mov"), (isize = 1), (ops = [reg(1, b & 7), imm(1)]));
  else if (b >= 0xb8 && b < 0xc0) ((op = "mov"), (ops = [reg(osize, b & 7), imm(osize)]));
  else if (b === 0xc0 || b === 0xc1 || (b >= 0xd0 && b <= 0xd3)) {
    isize = b & 1 ? osize : 1;
    const d = rm(isize);
    op = SHIFT[regField()];
    if (op === "sal") op = "shl";
    if (b <= 0xc1) ops = [d, imm(1)];
    else if (b <= 0xd1) ops = [d, { t: "imm", size: 1, v: 1, at: -1 }];
    else ops = [d, reg(1, 1)];
  } else if (b === 0xc2) ((op = "ret"), (ops = [imm(2)]));
  else if (b === 0xc3) op = "ret";
  else if (b === 0xc4 || b === 0xc5) {
    op = b === 0xc4 ? "les" : "lds";
    ops = [reg(osize, regField()), rm(6 as Size)];
  } else if (b === 0xc6 || b === 0xc7) {
    op = "mov";
    isize = b & 1 ? osize : 1;
    const d = rm(isize);
    ops = [d, imm(isize)];
  } else if (b === 0xc8) {
    op = "enter";
    const a = imm(2);
    const c = imm(1);
    ops = [a, c];
  } else if (b === 0xc9) op = "leave";
  else if (b === 0xca) ((op = "retf"), (far = true), (ops = [imm(2)]));
  else if (b === 0xcb) ((op = "retf"), (far = true));
  else if (b === 0xcc) ((op = "int"), (ops = [{ t: "imm", size: 1, v: 3, at: -1 }]));
  else if (b === 0xcd) ((op = "int"), (ops = [imm(1)]));
  else if (b === 0xce) op = "into";
  else if (b === 0xcf) op = "iret";
  else if (b === 0xd4) ((op = "aam"), (ops = [imm(1)]));
  else if (b === 0xd5) ((op = "aad"), (ops = [imm(1)]));
  else if (b === 0xd7) op = "xlat";
  else if (b >= 0xd8 && b <= 0xdf) return decodeFpu(mem, addr, p, b, seg, osize);
  else if (b >= 0xe0 && b <= 0xe3) {
    op = ["loopne", "loope", "loop", "jecxz"][b - 0xe0];
    const d = s8();
    target = (p + d) >>> 0;
  } else if (b === 0xe4 || b === 0xe5) ((op = "in"), (isize = b & 1 ? osize : 1), (ops = [imm(1)]));
  else if (b === 0xe6 || b === 0xe7) ((op = "out"), (isize = b & 1 ? osize : 1), (ops = [imm(1)]));
  else if (b === 0xe8) {
    op = "call";
    const d = u32() | 0;
    target = (p + d) >>> 0;
  } else if (b === 0xe9) {
    op = "jmp";
    const d = u32() | 0;
    target = (p + d) >>> 0;
  } else if (b === 0xea) {
    op = "jmpf";
    far = true;
    const at = p;
    const off = u32();
    const sel = u16();
    ops = [{ t: "imm", size: 4, v: off, at }, { t: "imm", size: 2, v: sel, at: p - 2 }];
  } else if (b === 0xeb) {
    op = "jmp";
    const d = s8();
    target = (p + d) >>> 0;
  } else if (b === 0xec || b === 0xed) ((op = "in"), (isize = b & 1 ? osize : 1));
  else if (b === 0xee || b === 0xef) ((op = "out"), (isize = b & 1 ? osize : 1));
  else if (b === 0xf4) op = "hlt";
  else if (b === 0xf5) op = "cmc";
  else if (b === 0xf6 || b === 0xf7) {
    isize = b === 0xf6 ? 1 : osize;
    const d = rm(isize);
    const r = regField();
    op = ["test", "test", "not", "neg", "mul", "imul1", "div", "idiv"][r];
    ops = r < 2 ? [d, imm(isize)] : [d];
  } else if (b === 0xf8) op = "clc";
  else if (b === 0xf9) op = "stc";
  else if (b === 0xfa) op = "cli";
  else if (b === 0xfb) op = "sti";
  else if (b === 0xfc) op = "cld";
  else if (b === 0xfd) op = "std";
  else if (b === 0xfe) {
    isize = 1;
    const d = rm(1);
    const r = regField();
    if (r > 1) throw new DecodeError(addr, `bad FE /${r}`);
    op = r === 0 ? "inc" : "dec";
    ops = [d];
  } else if (b === 0xff) {
    const r = (mem.u8(p) >> 3) & 7;
    if (r === 3 || r === 5) {
      const d = rm(6 as Size);
      op = r === 3 ? "callf" : "jmpf";
      far = true;
      ops = [d];
    } else {
      const d = rm(osize);
      op = ["inc", "dec", "calli", "", "jmpi", "", "push", ""][r];
      if (!op) throw new DecodeError(addr, `bad FF /${r}`);
      ops = [d];
    }
  } else if (b === 0x0f) {
    const b2 = u8();
    if (b2 >= 0x80 && b2 < 0x90) {
      op = "jcc";
      cc = b2 & 15;
      const d = osize === 2 ? (u16() << 16) >> 16 : u32() | 0;
      target = (p + d) >>> 0;
    } else if (b2 >= 0x90 && b2 < 0xa0) {
      op = "setcc";
      cc = b2 & 15;
      isize = 1;
      ops = [rm(1)];
    } else if (b2 >= 0x40 && b2 < 0x50) {
      op = "cmovcc";
      cc = b2 & 15;
      ops = [reg(osize, regField()), rm(osize)];
    } else if (b2 === 0xb6 || b2 === 0xbe) {
      op = b2 === 0xb6 ? "movzx" : "movsx";
      ops = [reg(osize, regField()), rm(1)];
    } else if (b2 === 0xb7 || b2 === 0xbf) {
      op = b2 === 0xb7 ? "movzx" : "movsx";
      ops = [reg(osize, regField()), rm(2)];
    } else if (b2 === 0xaf) ((op = "imul2"), (ops = [reg(osize, regField()), rm(osize)]));
    else if (b2 === 0xa0 || b2 === 0xa8) ((op = "push"), (ops = [{ t: "seg", r: b2 === 0xa0 ? 4 : 5 }]));
    else if (b2 === 0xa1 || b2 === 0xa9) ((op = "pop"), (ops = [{ t: "seg", r: b2 === 0xa1 ? 4 : 5 }]));
    else if (b2 === 0xa3 || b2 === 0xab || b2 === 0xb3 || b2 === 0xbb) {
      op = { 0xa3: "bt", 0xab: "bts", 0xb3: "btr", 0xbb: "btc" }[b2]!;
      ops = [rm(osize), reg(osize, regField())];
    } else if (b2 === 0xba) {
      const d = rm(osize);
      const r = regField();
      if (r < 4) throw new DecodeError(addr, "bad 0F BA");
      op = ["bt", "bts", "btr", "btc"][r - 4];
      ops = [d, imm(1)];
    } else if (b2 === 0xbc || b2 === 0xbd) ((op = b2 === 0xbc ? "bsf" : "bsr"), (ops = [reg(osize, regField()), rm(osize)]));
    else if (b2 === 0xa4 || b2 === 0xac) {
      op = b2 === 0xa4 ? "shld" : "shrd";
      const d = rm(osize);
      ops = [d, reg(osize, regField()), imm(1)];
    } else if (b2 === 0xa5 || b2 === 0xad) {
      op = b2 === 0xa5 ? "shld" : "shrd";
      const d = rm(osize);
      ops = [d, reg(osize, regField()), reg(1, 1)];
    } else if (b2 === 0xb2 || b2 === 0xb4 || b2 === 0xb5) {
      op = { 0xb2: "lss", 0xb4: "lfs", 0xb5: "lgs" }[b2]!;
      ops = [reg(osize, regField()), rm(6 as Size)];
    } else if (b2 === 0xa2) op = "cpuid";
    else if (b2 === 0x31) op = "rdtsc";
    else if (b2 === 0x00 || b2 === 0x01) {
      op = "sysop";
      ops = [rm(2)];
    } else if (b2 === 0x02 || b2 === 0x03) ((op = b2 === 0x02 ? "lar" : "lsl"), (ops = [reg(osize, regField()), rm(2)]));
    else if (b2 === 0xc8 + (b2 & 7) && b2 >= 0xc8) ((op = "bswap"), (ops = [reg(4, b2 & 7)]));
    else if (b2 === 0xb0 || b2 === 0xb1) {
      op = "cmpxchg";
      isize = b2 === 0xb0 ? 1 : osize;
      ops = [rm(isize), reg(isize, regField())];
    } else if (b2 === 0xc0 || b2 === 0xc1) {
      op = "xadd";
      isize = b2 === 0xc0 ? 1 : osize;
      ops = [rm(isize), reg(isize, regField())];
    } else if (b2 === 0x20 || b2 === 0x22) {
      op = "movcr";
      ops = [rm(4)];
    } else throw new DecodeError(addr, `unsupported 0F ${b2.toString(16)}`);
  } else throw new DecodeError(addr, `unsupported opcode ${b.toString(16)}`);

  return { addr, len: p - addr, op, cc, ops, osize: isize, rep, target, far };
}

// x87 escape opcodes. Operands use FpuOp for st(i) or MemOp with size 2/4/8/10 (and 14/28/94/108 for
// environment/state forms, reported as size 10 with op name carrying the meaning).
function decodeFpu(mem: CodeReader, addr: number, p: number, b: number, seg: number, osize: Size): Insn {
  const m = mem.u8(p);
  const mod = m >> 6;
  const r = (m >> 3) & 7;
  const rmv = m & 7;
  const mk = (op: string, ops: Operand[], len: number): Insn => ({ addr, len, op, cc: -1, ops, osize, rep: 0, target: -1, far: false });
  if (mod !== 3) {
    // memory form: re-use the main ModRM decoder by decoding a fake instruction is awkward; decode inline
    let q = p + 1;
    const u8 = () => mem.u8(q++);
    const u32 = () => {
      const v = (mem.u8(q) | (mem.u8(q + 1) << 8) | (mem.u8(q + 2) << 16) | (mem.u8(q + 3) << 24)) | 0;
      q += 4;
      return v;
    };
    let base = -1;
    let index = -1;
    let scale = 1;
    let disp = 0;
    let dispAt = -1;
    if (rmv === 4) {
      const sib = u8();
      scale = 1 << (sib >> 6);
      index = (sib >> 3) & 7;
      if (index === 4) index = -1;
      base = sib & 7;
      if (base === 5 && mod === 0) {
        base = -1;
        dispAt = q;
        disp = u32();
      }
    } else if (rmv === 5 && mod === 0) {
      dispAt = q;
      disp = u32();
    } else base = rmv;
    if (mod === 1) {
      dispAt = q;
      disp = (u8() << 24) >> 24;
    } else if (mod === 2) {
      dispAt = q;
      disp = u32();
    }
    const M = (size: Size): MemOp => ({ t: "mem", size, base, index, scale, disp, seg, dispAt });
    const len = q - addr;
    const arith = ["fadd", "fmul", "fcom", "fcomp", "fsub", "fsubr", "fdiv", "fdivr"];
    switch (b) {
      case 0xd8:
        return mk(arith[r], [M(4)], len); // float32
      case 0xdc:
        return mk(arith[r], [M(8)], len); // float64
      case 0xda:
        return mk("fi" + arith[r].slice(1), [M(4)], len); // int32
      case 0xde:
        return mk("fi" + arith[r].slice(1), [M(2)], len); // int16
      case 0xd9:
        return mk(["fld", "?", "fst", "fstp", "fldenv", "fldcw", "fnstenv", "fnstcw"][r], [M(r < 4 ? 4 : 2)], len);
      case 0xdb:
        return mk(["fild", "fisttp", "fist", "fistp", "?", "fld", "?", "fstp"][r], [M(r < 4 ? 4 : 10)], len);
      case 0xdd:
        return mk(["fld", "fisttp64", "fst", "fstp", "frstor", "?", "fnsave", "fnstsw"][r], [M(r < 4 ? 8 : 2)], len);
      case 0xdf:
        return mk(["fild", "fisttp", "fist", "fistp", "fbld", "fild", "fbstp", "fistp"][r], [M(r < 4 ? 2 : r === 5 || r === 7 ? 8 : 10)], len);
    }
    throw new DecodeError(addr, "bad fpu");
  }
  const len = p + 1 - addr;
  const st = (i: number): FpuOp => ({ t: "st", i });
  switch (b) {
    case 0xd8:
      return mk(["fadd", "fmul", "fcom", "fcomp", "fsub", "fsubr", "fdiv", "fdivr"][r], [st(0), st(rmv)], len);
    case 0xdc:
      return mk(["fadd", "fmul", "fcom", "fcomp", "fsubr", "fsub", "fdivr", "fdiv"][r], [st(rmv), st(0)], len);
    case 0xde:
      if (r === 3 && rmv === 1) return mk("fcompp", [], len);
      return mk(["faddp", "fmulp", "fcomp", "?", "fsubrp", "fsubp", "fdivrp", "fdivp"][r], [st(rmv), st(0)], len);
    case 0xd9:
      if (r === 0) return mk("fld", [st(rmv)], len);
      if (r === 1) return mk("fxch", [st(rmv)], len);
      if (m === 0xd0) return mk("nop", [], len);
      {
        const t: Record<number, string> = {
          0xe0: "fchs", 0xe1: "fabs", 0xe4: "ftst", 0xe5: "fxam", 0xe8: "fld1", 0xe9: "fldl2t", 0xea: "fldl2e", 0xeb: "fldpi",
          0xec: "fldlg2", 0xed: "fldln2", 0xee: "fldz", 0xf0: "f2xm1", 0xf1: "fyl2x", 0xf2: "fptan", 0xf3: "fpatan",
          0xf4: "fxtract", 0xf5: "fprem1", 0xf6: "fdecstp", 0xf7: "fincstp", 0xf8: "fprem", 0xf9: "fyl2xp1", 0xfa: "fsqrt",
          0xfb: "fsincos", 0xfc: "frndint", 0xfd: "fscale", 0xfe: "fsin", 0xff: "fcos",
        };
        if (t[m]) return mk(t[m], [], len);
      }
      break;
    case 0xda:
      if (m === 0xe9) return mk("fucompp", [], len);
      break;
    case 0xdb:
      if (m === 0xe2) return mk("fclex", [], len);
      if (m === 0xe3) return mk("finit", [], len);
      if (m === 0xe0 || m === 0xe1 || m === 0xe4) return mk("nop", [], len);
      if (r === 5) return mk("fucomi", [st(0), st(rmv)], len);
      if (r === 6) return mk("fcomi", [st(0), st(rmv)], len);
      break;
    case 0xdd:
      if (r === 0) return mk("ffree", [st(rmv)], len);
      if (r === 2) return mk("fst", [st(rmv)], len);
      if (r === 3) return mk("fstp", [st(rmv)], len);
      if (r === 4) return mk("fucom", [st(rmv)], len);
      if (r === 5) return mk("fucomp", [st(rmv)], len);
      break;
    case 0xdf:
      if (m === 0xe0) return mk("fnstswax", [], len);
      if (r === 5) return mk("fucomip", [st(0), st(rmv)], len);
      if (r === 6) return mk("fcomip", [st(0), st(rmv)], len);
      break;
  }
  throw new DecodeError(addr, `unsupported fpu ${b.toString(16)} ${m.toString(16)}`);
}
