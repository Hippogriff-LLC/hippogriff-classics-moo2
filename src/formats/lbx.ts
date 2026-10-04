// LBX archive container decoder.
// Format notes: docs/research/formats/LBX.md (independently authored).
//
//   u16 entryCount
//   u16 signature   0xFEAD
//   u32 reserved    (observed 0 in every v1.31 archive inspected)
//   u32 offsets[entryCount + 1]   absolute byte offsets; entry i = [offsets[i], offsets[i+1])
//   ... header area padded to 0x800 in observed files, entries follow.

export const LBX_SIGNATURE = 0xfead;

export interface LbxArchive {
  readonly name: string;
  readonly count: number;
  entry(index: number): Uint8Array;
  entrySize(index: number): number;
}

export class LbxError extends Error {}

export function parseLbx(name: string, data: Uint8Array): LbxArchive {
  if (data.length < 8) throw new LbxError(`${name}: too short for LBX header`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint16(0, true);
  const sig = view.getUint16(2, true);
  if (sig !== LBX_SIGNATURE) throw new LbxError(`${name}: bad LBX signature 0x${sig.toString(16)}`);
  const tableEnd = 8 + 4 * (count + 1);
  if (tableEnd > data.length) throw new LbxError(`${name}: offset table exceeds file`);
  const offsets = new Uint32Array(count + 1);
  for (let i = 0; i <= count; i++) offsets[i] = view.getUint32(8 + 4 * i, true);
  for (let i = 0; i < count; i++) {
    if (offsets[i] > offsets[i + 1] || offsets[i + 1] > data.length) {
      throw new LbxError(`${name}: entry ${i} offsets out of range`);
    }
  }
  return {
    name,
    count,
    entry(index: number): Uint8Array {
      if (index < 0 || index >= count) throw new LbxError(`${name}: entry ${index} out of range (count ${count})`);
      return data.subarray(offsets[index], offsets[index + 1]);
    },
    entrySize(index: number): number {
      return offsets[index + 1] - offsets[index];
    },
  };
}

/** Build an LBX archive from entries. Used for synthetic test fixtures and mod tooling. */
export function buildLbx(entries: Uint8Array[]): Uint8Array {
  const headerSize = Math.max(0x800, 8 + 4 * (entries.length + 1));
  const total = headerSize + entries.reduce((a, e) => a + e.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, entries.length, true);
  view.setUint16(2, LBX_SIGNATURE, true);
  view.setUint32(4, 0, true);
  let off = headerSize;
  for (let i = 0; i < entries.length; i++) {
    view.setUint32(8 + 4 * i, off, true);
    out.set(entries[i], off);
    off += entries[i].length;
  }
  view.setUint32(8 + 4 * entries.length, off, true);
  return out;
}
