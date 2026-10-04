// Shared-memory channels between the page and the guest running in a worker (the guest loop is
// synchronous, so it can neither receive messages nor have the worker commit canvas frames):
//  - input: a single-producer/single-consumer ring of events, plus the mapping from KeyboardEvent.code to
//    the PC keyboard's scan code set 1 that the original program reads;
//  - video: an RGBA frame buffer with a sequence number the page polls once per animation frame.
//
// Independently authored; Apache-2.0.

import type { HostEvent } from "./host.ts";

const CAPACITY = 512; // events
const WORDS = 5; // type, code, x, y, buttons
const HEAD = 0, // written by the consumer
  TAIL = 1, // written by the producer
  WAKE = 2; // bumped by the producer; the consumer sleeps on it
const HEADER = 4;

export function createInputBuffer(): SharedArrayBuffer {
  return new SharedArrayBuffer((HEADER + CAPACITY * WORDS) * 4);
}

export class InputWriter {
  private readonly a: Int32Array;
  constructor(buf: SharedArrayBuffer) {
    this.a = new Int32Array(buf);
  }
  push(ev: HostEvent): boolean {
    const a = this.a;
    const tail = Atomics.load(a, TAIL);
    const next = (tail + 1) % CAPACITY;
    if (next === Atomics.load(a, HEAD)) return false; // full: drop
    const o = HEADER + tail * WORDS;
    a[o] = ev.type;
    a[o + 1] = ev.code ?? 0;
    a[o + 2] = ev.x ?? 0;
    a[o + 3] = ev.y ?? 0;
    a[o + 4] = ev.buttons ?? 0;
    Atomics.store(a, TAIL, next);
    Atomics.add(a, WAKE, 1);
    Atomics.notify(a, WAKE);
    return true;
  }
}

export class InputReader {
  private readonly a: Int32Array;
  constructor(buf: SharedArrayBuffer) {
    this.a = new Int32Array(buf);
  }
  pop(): HostEvent | null {
    const a = this.a;
    const head = Atomics.load(a, HEAD);
    if (head === Atomics.load(a, TAIL)) return null;
    const o = HEADER + head * WORDS;
    const ev: HostEvent = { type: a[o] as 1 | 2, code: a[o + 1], x: a[o + 2], y: a[o + 3], buttons: a[o + 4] };
    Atomics.store(a, HEAD, (head + 1) % CAPACITY);
    return ev;
  }
  /** Sleep up to ms, returning early when the page queues input. */
  wait(ms: number): void {
    const a = this.a;
    if (Atomics.load(a, HEAD) !== Atomics.load(a, TAIL)) return;
    Atomics.wait(a, WAKE, Atomics.load(a, WAKE), ms);
  }
}

// KeyboardEvent.code -> scan code set 1 make code; 0xE0xx marks the extended (E0-prefixed) keys.
const SCANCODES: Record<string, number> = {
  Escape: 0x01, Digit1: 0x02, Digit2: 0x03, Digit3: 0x04, Digit4: 0x05, Digit5: 0x06, Digit6: 0x07, Digit7: 0x08,
  Digit8: 0x09, Digit9: 0x0a, Digit0: 0x0b, Minus: 0x0c, Equal: 0x0d, Backspace: 0x0e, Tab: 0x0f,
  KeyQ: 0x10, KeyW: 0x11, KeyE: 0x12, KeyR: 0x13, KeyT: 0x14, KeyY: 0x15, KeyU: 0x16, KeyI: 0x17, KeyO: 0x18,
  KeyP: 0x19, BracketLeft: 0x1a, BracketRight: 0x1b, Enter: 0x1c, ControlLeft: 0x1d, KeyA: 0x1e, KeyS: 0x1f,
  KeyD: 0x20, KeyF: 0x21, KeyG: 0x22, KeyH: 0x23, KeyJ: 0x24, KeyK: 0x25, KeyL: 0x26, Semicolon: 0x27,
  Quote: 0x28, Backquote: 0x29, ShiftLeft: 0x2a, Backslash: 0x2b, KeyZ: 0x2c, KeyX: 0x2d, KeyC: 0x2e, KeyV: 0x2f,
  KeyB: 0x30, KeyN: 0x31, KeyM: 0x32, Comma: 0x33, Period: 0x34, Slash: 0x35, ShiftRight: 0x36,
  NumpadMultiply: 0x37, AltLeft: 0x38, Space: 0x39, CapsLock: 0x3a, F1: 0x3b, F2: 0x3c, F3: 0x3d, F4: 0x3e,
  F5: 0x3f, F6: 0x40, F7: 0x41, F8: 0x42, F9: 0x43, F10: 0x44, NumLock: 0x45, ScrollLock: 0x46, Numpad7: 0x47,
  Numpad8: 0x48, Numpad9: 0x49, NumpadSubtract: 0x4a, Numpad4: 0x4b, Numpad5: 0x4c, Numpad6: 0x4d,
  NumpadAdd: 0x4e, Numpad1: 0x4f, Numpad2: 0x50, Numpad3: 0x51, Numpad0: 0x52, NumpadDecimal: 0x53,
  IntlBackslash: 0x56, F11: 0x57, F12: 0x58,
  NumpadEnter: 0xe01c, ControlRight: 0xe01d, NumpadDivide: 0xe035, AltRight: 0xe038, Home: 0xe047,
  ArrowUp: 0xe048, PageUp: 0xe049, ArrowLeft: 0xe04b, ArrowRight: 0xe04d, End: 0xe04f, ArrowDown: 0xe050,
  PageDown: 0xe051, Insert: 0xe052, Delete: 0xe053,
};

/** Scan code bytes for a key press or release, or null for keys the PC keyboard does not have. */
export function scanBytes(code: string, release: boolean): number[] | null {
  const sc = SCANCODES[code];
  if (sc === undefined) return null;
  const make = sc & 0x7f;
  const b = release ? make | 0x80 : make;
  return sc > 0xff ? [0xe0, b] : [b];
}

// ---------------------------------------------------------------- video
export const MAX_WIDTH = 800,
  MAX_HEIGHT = 600;
const F_SEQ = 0,
  F_WIDTH = 1,
  F_HEIGHT = 2,
  F_HEADER = 16; // bytes

export function createFrameBuffer(): SharedArrayBuffer {
  return new SharedArrayBuffer(F_HEADER + MAX_WIDTH * MAX_HEIGHT * 4);
}

export class FrameWriter {
  private readonly h: Int32Array;
  private readonly px: Uint8Array;
  private w = 0;
  private hgt = 0;
  constructor(buf: SharedArrayBuffer) {
    this.h = new Int32Array(buf, 0, 4);
    this.px = new Uint8Array(buf, F_HEADER);
  }
  /** RGBA destination for a width x height frame, or null if it does not fit. */
  begin(width: number, height: number): Uint8Array | null {
    if (width <= 0 || height <= 0 || width > MAX_WIDTH || height > MAX_HEIGHT) return null;
    this.w = width;
    this.hgt = height;
    return this.px.subarray(0, width * height * 4);
  }
  commit(): void {
    Atomics.store(this.h, F_WIDTH, this.w);
    Atomics.store(this.h, F_HEIGHT, this.hgt);
    Atomics.add(this.h, F_SEQ, 1);
  }
}

export class FrameReader {
  private readonly h: Int32Array;
  private readonly px: Uint8Array;
  private seen = 0;
  constructor(buf: SharedArrayBuffer) {
    this.h = new Int32Array(buf, 0, 4);
    this.px = new Uint8Array(buf, F_HEADER);
  }
  get width(): number {
    return Atomics.load(this.h, F_WIDTH);
  }
  get height(): number {
    return Atomics.load(this.h, F_HEIGHT);
  }
  /** Copy the latest frame into an ImageData of the right size if a new one was committed. */
  take(into: (w: number, h: number) => ImageData): ImageData | null {
    const seq = Atomics.load(this.h, F_SEQ);
    if (seq === this.seen) return null;
    this.seen = seq;
    const w = this.width,
      h = this.height;
    if (!w || !h) return null;
    const img = into(w, h);
    // a frame being written concurrently may tear for one display refresh; the next one replaces it
    img.data.set(this.px.subarray(0, w * h * 4));
    return img;
  }
}
