// Runtime service tests: the virtual Miles digital sound driver (runtime/audio.c, exercised from C through
// tests/fixtures/audio_test.c) and the shared-memory sound ring used by the browser port
// (src/port/audio.ts).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { AudioRingReader, AudioRingWriter, createAudioRing } from "../src/port/audio.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function haveCc(): string | null {
  for (const cc of [process.env.CC, "gcc", "cc", "clang"]) {
    if (cc && spawnSync(cc, ["--version"], { stdio: "ignore" }).status === 0) return cc;
  }
  return null;
}

test("virtual Miles DIG driver: driver info, verification and double-buffered playback", (t) => {
  const cc = haveCc();
  if (!cc) {
    t.skip("no C compiler");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "hippogriff-audio-test-"));
  try {
    const exe = join(dir, "audio_test");
    const rt = join(ROOT, "runtime");
    execFileSync(cc, ["-O1", "-Wall", "-fno-strict-aliasing", `-I${rt}`, "-o", exe, join(rt, "audio.c"), join(ROOT, "tests/fixtures/audio_test.c"), "-lm"], { stdio: "pipe" });
    for (const rate of ["22050", "44100", "11025"]) {
      const run = spawnSync(exe, [rate], { encoding: "utf8", timeout: 10_000 });
      assert.equal(run.status, 0, `rate ${rate}: ${run.stdout}${run.stderr}`);
      assert.match(run.stdout, /^ok /);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sound ring: frames pass through in order, overflow drops, underrun plays silence", () => {
  const ring = createAudioRing(8);
  const w = new AudioRingWriter(ring);
  const r = new AudioRingReader(ring, 8);
  assert.equal(w.write(Int16Array.of(16384, -16384, 8192, -8192, 0, 0)), 3);
  const L = new Float32Array(4),
    R = new Float32Array(4);
  assert.equal(r.read(L, R), 3);
  assert.deepEqual([...L], [0.5, 0.25, 0, 0]);
  assert.deepEqual([...R], [-0.5, -0.25, 0, 0]);
  // wrap around the end of the ring, and drop what does not fit
  const many = new Int16Array(20).map((_, i) => i);
  assert.equal(w.write(many), 8);
  assert.equal(w.write(many), 0);
  const L8 = new Float32Array(8),
    R8 = new Float32Array(8);
  assert.equal(r.read(L8, R8), 8);
  assert.deepEqual([...L8].map((x) => x * 32768), [0, 2, 4, 6, 8, 10, 12, 14]);
  assert.equal(w.written(), 11);
});

test("sound ring: the reader skips ahead to bound latency", () => {
  const ring = createAudioRing(64);
  const w = new AudioRingWriter(ring);
  const r = new AudioRingReader(ring, 4);
  w.write(new Int16Array(40).map((_, i) => (i >> 1) * 100));
  const L = new Float32Array(2),
    R = new Float32Array(2);
  assert.equal(r.read(L, R), 2);
  // 20 frames queued, at most 4 kept: playback resumes at frame 16
  assert.deepEqual([...L].map((x) => Math.round(x * 32768)), [1600, 1700]);
});
