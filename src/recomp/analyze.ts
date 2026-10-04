// Control-flow recovery for a flat-model LE program with symbol information.
//
// Functions are discovered from code symbols, direct call targets, tail jumps and address-taken code
// (fixups whose target lies in the code object). Each function body is recovered by recursive descent
// from its entry, bounded by the symbol range that contains the entry. Switch jump tables are recognised
// from indirect jumps whose table operand carries a fixup into the code object.

import type { LeImage } from "./le.ts";
import { decode, type Insn, type CodeReader, DecodeError } from "./x86.ts";

export interface Sym {
  readonly addr: number;
  readonly name: string;
  readonly module: string;
  readonly code: boolean;
}

export interface Func {
  readonly entry: number;
  readonly name: string;
  readonly module: string;
  readonly insns: Map<number, Insn>;
  readonly labels: Set<number>; // instruction addresses that are branch targets
  readonly switches: Map<number, number[]>; // jmpi address -> case target addresses (in table order)
  readonly error?: string; // set when decoding failed somewhere in the body
}

export interface Program {
  readonly image: LeImage;
  readonly codeBase: number;
  readonly codeEnd: number;
  readonly fixups: Map<number, number>; // source -> target (32-bit offset fixups)
  readonly symbols: Sym[]; // sorted by address
  readonly funcs: Map<number, Func>;
  readonly addressTaken: Set<number>; // function entries whose address is stored as data
}

export interface AnalyzeOptions {
  /** Extra function entries (relocated addresses), e.g. found at run time. */
  readonly extraEntries?: Iterable<number>;
}

export function analyze(image: LeImage, symbols: Sym[], opts: AnalyzeOptions = {}): Program {
  const code = image.objects[0];
  const codeBase = code.base;
  const codeEnd = code.base + code.virtualSize;
  const inCode = (a: number) => a >= codeBase && a < codeEnd;
  const mem: CodeReader = {
    u8(a: number) {
      if (!inCode(a)) throw new DecodeError(a, "outside code object");
      return code.bytes[a - codeBase];
    },
  };
  const fixups = new Map<number, number>();
  for (const f of image.fixups) if (f.kind === 7) fixups.set(f.source, f.target);

  const syms = [...symbols].sort((a, b) => a.addr - b.addr);
  const symAt = new Map<number, Sym>();
  for (const s of syms) if (s.code || !symAt.has(s.addr)) symAt.set(s.addr, s);
  const starts = [...new Set(syms.filter((s) => inCode(s.addr)).map((s) => s.addr))].sort((a, b) => a - b);
  // Range [lo, hi) of the symbol that contains address a.
  const rangeOf = (a: number): [number, number] => {
    let lo = 0;
    let hi = starts.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= a) ((best = mid), (lo = mid + 1));
      else hi = mid - 1;
    }
    const s = best >= 0 ? starts[best] : codeBase;
    const e = best + 1 < starts.length ? starts[best + 1] : codeEnd;
    return [s, e];
  };

  const funcs = new Map<number, Func>();
  const work: number[] = [];
  const addEntry = (a: number) => {
    if (inCode(a) && !funcs.has(a) && !queued.has(a)) {
      queued.add(a);
      work.push(a);
    }
  };
  const queued = new Set<number>();
  for (const s of syms) if (s.code && inCode(s.addr)) addEntry(s.addr);
  for (const a of opts.extraEntries ?? []) addEntry(a);

  const tableSlots = new Set<number>(); // fixup sources that are switch-table slots
  const runFunc = (entry: number): Func => {
    const [lo, hi] = rangeOf(entry);
    const insns = new Map<number, Insn>();
    const labels = new Set<number>();
    const switches = new Map<number, number[]>();
    let error: string | undefined;
    const todo = [entry];
    const intra = (t: number) => t >= lo && t < hi;
    while (todo.length) {
      let a = todo.pop()!;
      while (!insns.has(a)) {
        let i: Insn;
        try {
          i = decode(mem, a);
        } catch (e) {
          error ??= (e as Error).message;
          break;
        }
        insns.set(a, i);
        const next = a + i.len;
        if (i.op === "jcc" || i.op === "loop" || i.op === "loope" || i.op === "loopne" || i.op === "jecxz") {
          if (intra(i.target)) {
            labels.add(i.target);
            todo.push(i.target);
          } else addEntry(i.target); // conditional tail jump
        } else if (i.op === "jmp") {
          if (intra(i.target)) {
            labels.add(i.target);
            todo.push(i.target);
          } else addEntry(i.target);
          break;
        } else if (i.op === "call") {
          addEntry(i.target);
        } else if (i.op === "jmpi") {
          const m = i.ops[0];
          if (m.t === "mem" && m.dispAt >= 0 && fixups.has(m.dispAt)) {
            const table = fixups.get(m.dispAt)!;
            const cases: number[] = [];
            for (let s = table; fixups.has(s); s += 4) {
              const t = fixups.get(s)!;
              if (!intra(t) || s === m.dispAt) break;
              // stop if the table runs into decoded code of this function
              if (insns.has(s)) break;
              cases.push(t);
              tableSlots.add(s);
            }
            switches.set(a, cases);
            for (const t of cases) {
              labels.add(t);
              todo.push(t);
            }
          }
          break;
        } else if (i.op === "ret" || i.op === "retf" || i.op === "iret" || i.op === "jmpf" || i.op === "hlt") break;
        if (!intra(next)) {
          // falls through into the next symbol: the emitter turns this into a tail call
          addEntry(next);
          break;
        }
        a = next;
      }
    }
    const s = symAt.get(entry);
    const host = symAt.get(lo);
    const name = s?.code ? s.name : `${host?.name ?? "sub"}+${(entry - lo).toString(16)}`;
    return { entry, name, module: (s ?? host)?.module ?? "", insns, labels, switches, error };
  };

  const drain = () => {
    while (work.length) {
      const a = work.pop()!;
      funcs.set(a, runFunc(a));
    }
  };
  drain();

  // Address-taken code: fixup targets in the code object that are not switch-table slots and not the
  // table operand of a recognised indirect jump.
  const addressTaken = new Set<number>();
  const jmpTableOperands = new Set<number>();
  for (const f of funcs.values())
    for (const [a] of f.switches) {
      const i = f.insns.get(a)!;
      const m = i.ops[0];
      if (m.t === "mem") jmpTableOperands.add(m.dispAt);
    }
  for (const [src, tgt] of fixups) {
    if (!inCode(tgt) || tableSlots.has(src) || jmpTableOperands.has(src)) continue;
    // Intra-object direct branches carry no fixups, so any other absolute code address is a pointer:
    // callbacks, CRT initialiser records, assembly jump tables, or return addresses pushed by hand
    // (`push label; jmp routine`) and function pointers stored with `mov [var], label`.
    addressTaken.add(tgt);
    addEntry(tgt);
  }
  drain();
  return { image, codeBase, codeEnd, fixups, symbols: syms, funcs, addressTaken };
}
