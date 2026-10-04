// Guest address-space layout and native-replacement table shared by the recompiler and the runtime.
//
// The executable prefers code at 0x10000 and data at 0x178000, which would overlap the real-mode
// first megabyte (BIOS data area, DOS memory, the VGA window at 0xA0000) that the program also uses
// directly. A DOS extender loads such programs above 1 MB; we do the same with a uniform +1 MB shift.

import type { HleOverride } from "./emit-c.ts";

export const GUEST_LAYOUT = {
  /** Relocation delta applied to every LE object. */
  delta: 0x100000,
  objectBases: [0x10000 + 0x100000, 0x178000 + 0x100000],
  /** First byte available to the DPMI/DOS heap emulation. */
  heapBase: 0x400000,
  /** Total guest memory in bytes. */
  memorySize: 64 * 1024 * 1024,
} as const;

// Functions replaced by runtime implementations. These are platform-boundary routines whose original
// implementation cannot be expressed in the static model (computed returns into self-modifying or
// patched interrupt stubs) or that talk to hardware the port does not have.
export const HLE_OVERRIDES: ReadonlyMap<string, HleOverride> = new Map([
  // Watcom CRT int386()/int386x() back end: dispatches through a `push addr; ret` into `int N` stubs.
  ["_DoINTR_", { impl: "hle_DoINTR" }],
  ["__int386x_", { impl: "hle_int386x" }],
]);
