// Web Worker that runs the recompiled program (moo2.wasm) with the browser host services.
//
// The guest is a synchronous loop, so it owns this worker's thread and the worker's event loop never runs
// while it plays. Everything therefore goes through shared memory or outgoing messages: input arrives in a
// shared ring (src/port/input.ts), sleeping is Atomics.wait, frames are written to a shared frame buffer
// the page draws from (an OffscreenCanvas would not be committed without returning to the event loop),
// and the user's installation is read synchronously (FileReaderSync over Blobs, or ranged synchronous
// requests to the development server). Saves are posted back to the page, which persists them.
//
// Independently authored; Apache-2.0.

import { AudioRingWriter } from "./audio.ts";
import { type GameFile, Moo2Host, frameToRgba, parseEntry } from "./host.ts";
import { FrameWriter, InputReader } from "./input.ts";

export type GameSource = { name: string; blob: Blob } | { name: string; url: string; size: number };

export interface StartMessage {
  type: "start";
  wasm: ArrayBuffer;
  image: ArrayBuffer;
  entry: string;
  game: GameSource[];
  saves: [string, Uint8Array][];
  input: SharedArrayBuffer;
  frame: SharedArrayBuffer;
  /** sound output ring and the rate the page plays it at; absent when the page has no audio */
  audio?: { ring: SharedArrayBuffer; rate: number };
  verbose?: boolean;
}

export type WorkerMessage =
  | { type: "status"; frames: number; guestMs: number }
  | { type: "save"; name: string; data: Uint8Array | null }
  | { type: "log"; message: string }
  | { type: "exit"; code: number }
  | { type: "error"; message: string };

declare const FileReaderSync: { new (): { readAsArrayBuffer(b: Blob): ArrayBuffer } };

const post = (m: WorkerMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

function blobFile(blob: Blob): GameFile {
  const reader = new FileReaderSync();
  return { size: blob.size, read: (pos, n) => new Uint8Array(reader.readAsArrayBuffer(blob.slice(pos, pos + n))) };
}

function urlFile(url: string, size: number): GameFile {
  return {
    size,
    read(pos, n) {
      if (n <= 0) return new Uint8Array(0);
      const x = new XMLHttpRequest();
      x.open("GET", url, false); // synchronous requests are permitted in workers
      x.responseType = "arraybuffer";
      x.setRequestHeader("Range", `bytes=${pos}-${pos + n - 1}`);
      x.send();
      if (x.status !== 206 && x.status !== 200) throw new Error(`read ${url}: HTTP ${x.status}`);
      const b = new Uint8Array(x.response as ArrayBuffer);
      return x.status === 200 ? b.subarray(pos, pos + n) : b;
    },
  };
}

async function start(m: StartMessage): Promise<void> {
  const input = new InputReader(m.input);
  const frame = new FrameWriter(m.frame);
  const game = new Map<string, GameFile>();
  for (const g of m.game) game.set(g.name.toUpperCase(), "blob" in g ? blobFile(g.blob) : urlFile(g.url, g.size));
  const audio = m.audio ? new AudioRingWriter(m.audio.ring) : null;
  let lastStatus = 0;
  const host: Moo2Host = new Moo2Host({
    files: {
      game,
      saves: new Map(m.saves.map(([n, d]) => [n.toUpperCase(), d])),
      onSaveChanged: (name, data) => post({ type: "save", name, data: data ? data.slice() : null }),
    },
    realtime: true,
    verbose: m.verbose,
    audioRate: m.audio?.rate,
    audioWrite: audio ? (samples) => void audio.write(samples) : undefined,
    present(px, w, h, pitch, pal) {
      const out = frame.begin(w, h);
      if (out) {
        frameToRgba(px, w, h, pitch, pal, out);
        frame.commit();
      }
      const now = performance.now();
      if (now - lastStatus > 500) {
        lastStatus = now;
        post({ type: "status", frames: host.frames(), guestMs: host.guestMs() });
      }
    },
    pollEvent: () => input.pop(),
    idle: (ms) => input.wait(ms),
    log: (message) => post({ type: "log", message }),
    now: () => performance.now(),
  });
  const module = await WebAssembly.compile(m.wasm);
  const { entry, esp } = parseEntry(m.entry);
  const code = await host.run(module, { image: new Uint8Array(m.image), entry, esp });
  post({ type: "exit", code });
}

self.onmessage = (ev: MessageEvent<StartMessage>) => {
  if (ev.data?.type !== "start") return;
  start(ev.data).catch((err: unknown) => post({ type: "error", message: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err) }));
};
