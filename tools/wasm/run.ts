// Headless Node runner for a private moo2.wasm build: the same contract as runtime/host_native.c, but
// through the JavaScript host (src/port/host.ts) that the browser uses, so the two can be compared.
//
//   node tools/wasm/run.ts <moo2.wasm> <build-dir> <game-dir> <save-dir> <frame-dir> [options]
//     --ms N          stop after N ms of guest time (default 60000)
//     --every N       write every Nth presented frame as PPM (default 0: only the last frame)
//     --script FILE   timed input: lines "<ms> key <scancode-hex>" | "<ms> mouse <x> <y> <buttons>"
//     --realtime      use the host clock instead of deterministic virtual time
//     --verbose       log service calls
//
// The game directory is only read; files the game creates or modifies go to the save directory.
// Independently authored; Apache-2.0.

import { mkdirSync, openSync, readFileSync, readdirSync, readSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type GameFile, type HostEvent, Moo2Exit, Moo2Host, frameToRgba, parseEntry } from "../../src/port/host.ts";

export function parseScript(text: string): (HostEvent & { t: number })[] {
  const out: (HostEvent & { t: number })[] = [];
  for (const line of text.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (!f[0] || f[0].startsWith("#") || f.length < 3) continue;
    const t = Number(f[0]);
    if (f[1] === "key") out.push({ t, type: 1, code: parseInt(f[2], 16) });
    else if (f[1] === "mouse" && f.length >= 5) out.push({ t, type: 2, x: Number(f[2]), y: Number(f[3]), buttons: Number(f[4]) });
  }
  return out.sort((a, b) => a.t - b.t);
}

function gameFiles(dir: string): Map<string, GameFile> {
  const m = new Map<string, GameFile>();
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (!st.isFile()) continue;
    let fd = -1;
    m.set(name.toUpperCase(), {
      size: st.size,
      read(pos, n) {
        if (fd < 0) fd = openSync(p, "r");
        const b = new Uint8Array(n);
        const got = readSync(fd, b, 0, n, pos);
        return b.subarray(0, got);
      },
    });
  }
  return m;
}

function ppm(w: number, h: number, rgba: Uint8Array | Uint8ClampedArray): Uint8Array {
  const head = new TextEncoder().encode(`P6\n${w} ${h}\n255\n`);
  const out = new Uint8Array(head.length + w * h * 3);
  out.set(head);
  for (let i = 0, o = head.length; i < w * h; i++, o += 3) {
    out[o] = rgba[i * 4];
    out[o + 1] = rgba[i * 4 + 1];
    out[o + 2] = rgba[i * 4 + 2];
  }
  return out;
}

async function main(argv: string[]): Promise<number> {
  const pos: string[] = [];
  let limit = 60000,
    every = 0,
    realtime = false,
    verbose = false,
    script: (HostEvent & { t: number })[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ms") limit = Number(argv[++i]);
    else if (a === "--every") every = Number(argv[++i]);
    else if (a === "--script") script = parseScript(readFileSync(argv[++i], "utf8"));
    else if (a === "--realtime") realtime = true;
    else if (a === "--verbose") verbose = true;
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else pos.push(a);
  }
  if (pos.length !== 5) {
    console.error("usage: node tools/wasm/run.ts <moo2.wasm> <build-dir> <game-dir> <save-dir> <frame-dir> [--ms N] [--every N] [--script F] [--realtime] [--verbose]");
    return 2;
  }
  const [wasmPath, build, gameDir, saveDir, frameDir] = pos;
  mkdirSync(saveDir, { recursive: true });
  mkdirSync(frameDir, { recursive: true });
  const saves = new Map<string, Uint8Array>();
  for (const name of readdirSync(saveDir)) {
    const p = join(saveDir, name);
    if (statSync(p).isFile()) saves.set(name.toUpperCase(), new Uint8Array(readFileSync(p)));
  }
  const { entry, esp } = parseEntry(readFileSync(join(build, "entry.txt"), "utf8"));
  const image = new Uint8Array(readFileSync(join(build, "image.bin")));
  const module = await WebAssembly.compile(readFileSync(wasmPath));

  let presented = 0;
  let last: { w: number; h: number; rgba: Uint8Array | Uint8ClampedArray } | null = null;
  let sp = 0;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const host: Moo2Host = new Moo2Host({
    files: {
      game: gameFiles(gameDir),
      saves,
      onSaveChanged(name, data) {
        const p = join(saveDir, name);
        if (data) writeFileSync(p, data);
        else unlinkSync(p);
      },
    },
    realtime,
    verbose,
    present(px, w, h, pitch, pal) {
      presented++;
      last = { w, h, rgba: frameToRgba(px, w, h, pitch, pal) };
      if (every && presented % every === 0) {
        const name = `frame-${String(presented).padStart(6, "0")}-${String(Math.round(host.guestMs())).padStart(8, "0")}ms.ppm`;
        writeFileSync(join(frameDir, name), ppm(w, h, last.rgba));
      }
    },
    pollEvent(ms) {
      if (ms >= limit) {
        if (verbose) {
          console.error("time limit reached; guest stack:");
          host.debugDump();
        }
        throw new Moo2Exit(0);
      }
      return sp < script.length && script[sp].t <= ms ? script[sp++] : null;
    },
    idle(ms) {
      if (realtime) Atomics.wait(sleeper, 0, 0, ms);
    },
    log: (m) => console.error(m),
    now: () => performance.now(),
  });
  const t0 = performance.now();
  const code = await host.run(module, { image, entry, esp });
  if (last) {
    const l = last as { w: number; h: number; rgba: Uint8Array };
    writeFileSync(join(frameDir, "last.ppm"), ppm(l.w, l.h, l.rgba));
  }
  console.error(
    `[host] exit ${code} at guest ${host.guestMs().toFixed(0)} ms, ${presented} frames presented, ` +
      `${((performance.now() - t0) / 1000).toFixed(1)} s wall`,
  );
  return code;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
