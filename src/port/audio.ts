// Sound output channel between the worker running the guest and the page's AudioWorklet: a
// single-producer/single-consumer ring of interleaved 16-bit stereo frames in shared memory. The guest's
// virtual sound card (runtime/audio.c) writes whole DMA half-buffers as the guest clock consumes them;
// the worklet reads at the audio device's pace. The worklet keeps latency bounded: it skips forward when
// more than `maxLatency` frames are queued, and plays silence when the ring runs dry.
//
// Independently authored; Apache-2.0.

const READ = 0, // frames consumed, written by the reader
  WRITE = 1; // frames produced, written by the writer
const HEADER_BYTES = 16;

export function createAudioRing(frames: number): SharedArrayBuffer {
  return new SharedArrayBuffer(HEADER_BYTES + frames * 4);
}

const capacityOf = (buf: SharedArrayBuffer) => (buf.byteLength - HEADER_BYTES) / 4;

export class AudioRingWriter {
  private readonly pos: Int32Array;
  private readonly data: Int16Array;
  private readonly cap: number;
  constructor(buf: SharedArrayBuffer) {
    this.pos = new Int32Array(buf, 0, 4);
    this.cap = capacityOf(buf);
    this.data = new Int16Array(buf, HEADER_BYTES, this.cap * 2);
  }
  /** Queue interleaved stereo frames; frames that do not fit are dropped. Returns the number queued. */
  write(samples: Int16Array): number {
    const w = Atomics.load(this.pos, WRITE);
    const free = this.cap - ((w - Atomics.load(this.pos, READ)) | 0);
    const n = Math.min(free, samples.length >> 1);
    for (let i = 0; i < n; i++) {
      const o = ((w + i) % this.cap) * 2;
      this.data[o] = samples[i * 2];
      this.data[o + 1] = samples[i * 2 + 1];
    }
    Atomics.store(this.pos, WRITE, (w + n) | 0);
    return n;
  }
  /** Total frames written so far (wraps at 2^31). */
  written(): number {
    return Atomics.load(this.pos, WRITE);
  }
}

export class AudioRingReader {
  private readonly pos: Int32Array;
  private readonly data: Int16Array;
  private readonly cap: number;
  private readonly maxLatency: number;
  constructor(buf: SharedArrayBuffer, maxLatency: number) {
    this.maxLatency = maxLatency;
    this.pos = new Int32Array(buf, 0, 4);
    this.cap = capacityOf(buf);
    this.data = new Int16Array(buf, HEADER_BYTES, this.cap * 2);
  }
  /** Fill both channels with the next frames, as floats in [-1, 1). Returns the number of real frames. */
  read(left: Float32Array, right: Float32Array): number {
    let r = Atomics.load(this.pos, READ);
    const w = Atomics.load(this.pos, WRITE);
    let avail = (w - r) | 0;
    if (avail > this.maxLatency) {
      r = (w - this.maxLatency) | 0;
      avail = this.maxLatency;
    }
    const n = Math.min(avail, left.length);
    for (let i = 0; i < n; i++) {
      const o = ((((r + i) | 0) % this.cap) + this.cap) % this.cap;
      left[i] = this.data[o * 2] / 32768;
      right[i] = this.data[o * 2 + 1] / 32768;
    }
    left.fill(0, n);
    right.fill(0, n);
    Atomics.store(this.pos, READ, (r + n) | 0);
    return n;
  }
}
