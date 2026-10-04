// AudioWorklet processor that plays the guest's sound output from the shared ring (src/port/audio.ts).
// Loaded with audioWorklet.addModule(); it only runs in an AudioWorkletGlobalScope.
//
// Independently authored; Apache-2.0.

import { AudioRingReader } from "./audio.ts";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  constructor(options?: { processorOptions?: unknown });
}
declare function registerProcessor(name: string, ctor: unknown): void;

class Moo2Output extends AudioWorkletProcessor {
  private readonly reader: AudioRingReader;
  constructor(options: { processorOptions: { ring: SharedArrayBuffer } }) {
    super(options);
    // at most ~150 ms queued: the guest pushes a whole DMA half-buffer at a time
    this.reader = new AudioRingReader(options.processorOptions.ring, Math.round(sampleRate * 0.15));
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (out?.length >= 2) this.reader.read(out[0], out[1]);
    else if (out?.length === 1) this.reader.read(out[0], new Float32Array(out[0].length));
    return true;
  }
}

registerProcessor("moo2-output", Moo2Output);
