// JavaScript side of the recompiled-program runtime: implements the host services declared in
// runtime/host.h as WebAssembly imports and drives a moo2.wasm module built by runtime/wasm.mk.
//
// The module is the user's own Orion2.exe recompiled into C and compiled to wasm in a private, user-local
// build; nothing here contains or reproduces original program material. Everything in this file is
// synchronous because the guest runs a synchronous loop: in the browser it runs inside a Web Worker
// (src/port/worker.ts), under Node it runs directly (tools/wasm/run.ts).
//
// Independently authored; Apache-2.0.

/** Read-only access to one file of the user's installation. */
export interface GameFile {
  size: number;
  read(pos: number, n: number): Uint8Array;
}

/** Files of the original installation (read-only) shadowed by the save directory (read-write). */
export interface FileSource {
  /** Upper-cased base name -> file, for every top-level file of the installation. */
  game: Map<string, GameFile>;
  /** Upper-cased base name -> contents, for files the game created or modified. */
  saves: Map<string, Uint8Array>;
  /** Called after the save directory changed (data null = deleted). */
  onSaveChanged?(name: string, data: Uint8Array | null): void;
}

export interface HostEvent {
  type: 1 | 2; // 1 key (scancode in code, bit 7 = release), 2 mouse (absolute screen pixels)
  code?: number;
  x?: number;
  y?: number;
  buttons?: number;
}

export interface HostOptions {
  files: FileSource;
  /** Host clock instead of deterministic virtual time. */
  realtime: boolean;
  verbose?: boolean;
  /** Indexed frame (a view into wasm memory, valid only during the call) and 6-bit RGB palette. */
  present(pixels: Uint8Array, width: number, height: number, pitch: number, palette: Uint8Array): void;
  /** Next pending input event, given guest time in ms; null when there is none. */
  pollEvent(guestMs: number): HostEvent | null;
  /** The guest is waiting; block (or not) for up to ms. */
  idle(ms: number): void;
  audioRate?: number;
  audioWrite?(samples: Int16Array): void;
  log(message: string): void;
  now(): number;
}

/** Thrown through the guest to end the run (host_exit, or a host that stops it). */
export class Moo2Exit extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`moo2 exit ${code}`);
    this.code = code;
  }
}

interface Handle {
  name: string;
  pos: number;
  // read-only game file, or writable contents in the save overlay
  game: GameFile | null;
  data: Uint8Array;
  size: number;
  readable: boolean;
  writable: boolean;
  dirty: boolean;
}

const O_READ = 0,
  O_WRITE = 1,
  O_RDWR = 2,
  O_CREATE = 3;

interface Exports {
  memory: WebAssembly.Memory;
  moo2_alloc(n: number): number;
  moo2_start(image: number, len: number, entry: number, esp: number, memMb: number, flags: number): void;
  moo2_guest_ms(): number;
  moo2_frames(): number;
  moo2_debug_dump(): void;
}

export interface Moo2Program {
  image: Uint8Array;
  entry: number;
  esp: number;
}

/** Parse the build's entry.txt ("<entry hex> <esp hex>"). */
export function parseEntry(text: string): { entry: number; esp: number } {
  const [e, s] = text.trim().split(/\s+/);
  const entry = parseInt(e, 16),
    esp = parseInt(s, 16);
  if (!Number.isFinite(entry) || !Number.isFinite(esp)) throw new Error("bad entry.txt");
  return { entry, esp };
}

/** Expand an indexed frame to RGBA using a 6-bit palette. */
export function frameToRgba(
  pixels: Uint8Array,
  width: number,
  height: number,
  pitch: number,
  palette: Uint8Array,
  out: Uint8Array | Uint8ClampedArray = new Uint8ClampedArray(width * height * 4),
): Uint8Array | Uint8ClampedArray {
  const lut = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const r = palette[i * 3] & 63,
      g = palette[i * 3 + 1] & 63,
      b = palette[i * 3 + 2] & 63;
    lut[i] = (0xff << 24) | (((b << 2) | (b >> 4)) << 16) | (((g << 2) | (g >> 4)) << 8) | ((r << 2) | (r >> 4));
  }
  const o32 = new Uint32Array(out.buffer, out.byteOffset, width * height); // little-endian RGBA
  for (let y = 0; y < height; y++) {
    const row = y * pitch,
      orow = y * width;
    for (let x = 0; x < width; x++) o32[orow + x] = lut[pixels[row + x]];
  }
  return out;
}

export class Moo2Host {
  private readonly opts: HostOptions;
  private ex: Exports | null = null;
  private mem8 = new Uint8Array(0);
  private mem32 = new Int32Array(0);
  private clock = { second: NaN, fields: [0, 0, 0, 0, 0, 0] };
  private readonly handles = new Map<number, Handle>();
  private nextHandle = 5;

  constructor(opts: HostOptions) {
    this.opts = opts;
  }

  /** Guest time in ms (0 before start). */
  guestMs(): number {
    return this.ex ? this.ex.moo2_guest_ms() : 0;
  }
  frames(): number {
    return this.ex ? this.ex.moo2_frames() : 0;
  }
  debugDump(): void {
    this.ex?.moo2_debug_dump();
  }

  /** Instantiate and run until the guest exits; returns its exit code. */
  async run(module: WebAssembly.Module, program: Moo2Program, memMb = 64): Promise<number> {
    const instance = await WebAssembly.instantiate(module, { env: this.imports() });
    return this.start(instance, program, memMb);
  }

  start(instance: WebAssembly.Instance, program: Moo2Program, memMb = 64): number {
    this.ex = instance.exports as unknown as Exports;
    const at = this.ex.moo2_alloc(program.image.length);
    if (!at) throw new Error("cannot allocate the program image");
    this.u8().set(program.image, at);
    const flags = (this.opts.realtime ? 1 : 0) | (this.opts.verbose ? 2 : 0);
    try {
      this.ex.moo2_start(at, program.image.length, program.entry, program.esp, memMb, flags);
      return 0;
    } catch (e) {
      if (e instanceof Moo2Exit) return e.code;
      throw e;
    } finally {
      for (const h of this.handles.keys()) this.close(h);
    }
  }

  // ---------------------------------------------------------------- memory helpers
  // Growing memory detaches the old buffer (byteLength 0); the guest calls in here very often, so the
  // views are only rebuilt then rather than on every call.
  private u8(): Uint8Array {
    if (this.mem8.byteLength === 0) this.refreshViews();
    return this.mem8;
  }
  private refreshViews(): void {
    const buf = this.ex!.memory.buffer;
    this.mem8 = new Uint8Array(buf);
    this.mem32 = new Int32Array(buf);
  }
  private cstr(p: number): string {
    const m = this.u8();
    let e = p;
    while (m[e]) e++;
    let s = "";
    for (let i = p; i < e; i++) s += String.fromCharCode(m[i]);
    return s;
  }
  private i32(p: number, v: number): void {
    if (this.mem32.byteLength === 0) this.refreshViews();
    this.mem32[p >>> 2] = v; // the C side passes aligned int pointers; wasm is little-endian
  }

  // ---------------------------------------------------------------- files
  private saveChanged(name: string, data: Uint8Array | null): void {
    const f = this.opts.files;
    if (data) f.saves.set(name, data);
    else f.saves.delete(name);
    f.onSaveChanged?.(name, data);
  }

  private open(name: string, mode: number): number {
    const f = this.opts.files;
    name = name.toUpperCase();
    const saved = f.saves.get(name);
    let h: Handle;
    if (mode === O_CREATE) {
      h = { name, pos: 0, game: null, data: new Uint8Array(0), size: 0, readable: true, writable: true, dirty: true };
    } else if (saved) {
      h = { name, pos: 0, game: null, data: saved, size: saved.length, readable: mode !== O_WRITE, writable: mode !== O_READ, dirty: false };
    } else {
      const g = f.game.get(name);
      if (!g) return -1;
      if (mode === O_READ) {
        h = { name, pos: 0, game: g, data: new Uint8Array(0), size: g.size, readable: true, writable: false, dirty: false };
      } else {
        // copy on write into the save overlay, as the native host does
        const data = g.read(0, g.size).slice();
        h = { name, pos: 0, game: null, data, size: data.length, readable: mode !== O_WRITE, writable: true, dirty: true };
      }
    }
    const id = this.nextHandle++;
    this.handles.set(id, h);
    if (mode === O_CREATE) this.saveChanged(name, h.data);
    return id;
  }

  private read(id: number, buf: number, n: number): number {
    const h = this.handles.get(id);
    if (!h || !h.readable) return -1;
    const count = Math.max(0, Math.min(n, h.size - h.pos));
    if (count) {
      const src = h.game ? h.game.read(h.pos, count) : h.data.subarray(h.pos, h.pos + count);
      this.u8().set(src.subarray(0, count), buf);
    }
    h.pos += count;
    return count;
  }

  private write(id: number, buf: number, n: number): number {
    const h = this.handles.get(id);
    if (!h || !h.writable) return -1;
    const end = h.pos + n;
    if (end > h.data.length) {
      const grown = new Uint8Array(Math.max(end, h.data.length * 2, 4096));
      grown.set(h.data.subarray(0, h.size));
      h.data = grown;
    }
    h.data.set(this.u8().subarray(buf, buf + n), h.pos);
    h.pos = end;
    if (end > h.size) h.size = end;
    h.dirty = true;
    return n;
  }

  private seek(id: number, off: bigint, whence: number): bigint {
    const h = this.handles.get(id);
    if (!h) return -1n;
    const base = whence === 0 ? 0 : whence === 1 ? h.pos : h.size;
    const p = base + Number(off);
    if (p < 0) return -1n;
    h.pos = p;
    return BigInt(p);
  }

  private close(id: number): number {
    const h = this.handles.get(id);
    if (!h) return -1;
    this.handles.delete(id);
    if (h.dirty) this.saveChanged(h.name, h.data.slice(0, h.size));
    return 0;
  }

  private list(buf: number, cap: number): number {
    const f = this.opts.files;
    const entries: [string, number][] = [];
    for (const [n, d] of f.saves) entries.push([n, d.length]);
    for (const [n, g] of f.game) if (!f.saves.has(n)) entries.push([n, g.size]);
    const enc = new TextEncoder();
    const parts = entries.map(([n, s]) => enc.encode(`${n}\0${s}\0`));
    const total = parts.reduce((a, p) => a + p.length, 0);
    if (total <= cap) {
      const m = this.u8();
      let o = buf;
      for (const p of parts) {
        m.set(p, o);
        o += p.length;
      }
    }
    return total;
  }

  // ---------------------------------------------------------------- imports
  imports(): Record<string, (...args: never[]) => unknown> {
    const o = this.opts;
    return {
      host_open: (name: number, mode: number) => this.open(this.cstr(name), mode),
      host_read: (h: number, buf: number, n: number) => this.read(h, buf, n >>> 0),
      host_write: (h: number, buf: number, n: number) => this.write(h, buf, n >>> 0),
      host_seek: (h: number, off: bigint, whence: number) => this.seek(h, off, whence),
      host_close: (h: number) => this.close(h),
      host_unlink: (name: number) => {
        const n = this.cstr(name).toUpperCase();
        if (!o.files.saves.has(n)) return -1;
        this.saveChanged(n, null);
        return 0;
      },
      host_rename: (from: number, to: number) => {
        const a = this.cstr(from).toUpperCase(),
          b = this.cstr(to).toUpperCase();
        let data = o.files.saves.get(a);
        if (!data) {
          const g = o.files.game.get(a);
          if (!g) return -1;
          data = g.read(0, g.size).slice();
        } else this.saveChanged(a, null);
        this.saveChanged(b, data);
        return 0;
      },
      host_list: (buf: number, cap: number) => this.list(buf, cap >>> 0),
      host_now_ms: () => o.now(),
      host_local_time: (y: number, mo: number, d: number, h: number, mi: number, s: number, cs: number) => {
        // fixed in virtual mode so runs are reproducible (matches runtime/host_native.c); the game polls
        // the clock in tight loops, so the broken-down time is computed once per second
        const ms = o.realtime ? Date.now() : 1e12 + this.guestMs();
        const second = Math.floor(ms / 1000);
        const c = this.clock;
        if (c.second !== second) {
          const t = new Date(second * 1000);
          c.second = second;
          c.fields = [t.getFullYear(), t.getMonth() + 1, t.getDate(), t.getHours(), t.getMinutes(), t.getSeconds()];
        }
        const f = c.fields;
        this.i32(y, f[0]);
        this.i32(mo, f[1]);
        this.i32(d, f[2]);
        this.i32(h, f[3]);
        this.i32(mi, f[4]);
        this.i32(s, f[5]);
        this.i32(cs, Math.floor((ms % 1000) / 10));
      },
      host_idle: (ms: number) => o.idle(ms),
      host_present: (px: number, w: number, h: number, pitch: number, pal: number) => {
        const m = this.u8();
        o.present(m.subarray(px, px + pitch * (h - 1) + w), w, h, pitch, m.subarray(pal, pal + 768));
      },
      host_poll_event: (p: number) => {
        const ev = o.pollEvent(this.guestMs());
        if (!ev) return 0;
        this.i32(p, ev.type);
        this.i32(p + 4, ev.code ?? 0);
        this.i32(p + 8, ev.x ?? 0);
        this.i32(p + 12, ev.y ?? 0);
        this.i32(p + 16, ev.buttons ?? 0);
        return 1;
      },
      host_audio_rate: () => o.audioRate ?? 22050,
      host_audio_write: (frames: number, count: number) => {
        if (o.audioWrite) o.audioWrite(new Int16Array(this.u8().buffer.slice(frames, frames + count * 4)));
      },
      host_log: (msg: number) => o.log(this.cstr(msg)),
      host_exit: (code: number) => {
        throw new Moo2Exit(code);
      },
    };
  }
}
