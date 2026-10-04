# Provenance: static recompiler and port runtime

Everything under `src/recomp/`, `runtime/`, `tools/re/`, `tools/wasm/` and `src/port/` was independently
authored for this project (Apache-2.0). None of it contains program bytes, disassembly, decompiled code
or data from Master of Orion II.

## Public references used

| Area | Reference |
| --- | --- |
| LE container (`src/recomp/le.ts`) | the public IBM/Microsoft LE/LX executable format description |
| Watcom debug info (`src/recomp/watcomdbg.ts`) | the Open Watcom debugging-information format documentation (v3) |
| x86 decoding and semantics (`src/recomp/x86.ts`, `emit-c.ts`, `runtime/rt.h`) | the Intel IA-32 architecture software developer's manuals |
| DOS and DPMI (`runtime/dos.c`) | the public MS-DOS int 21h interface and the DPMI 0.9 specification |
| PC hardware/BIOS (`runtime/pc.c`) | the public 8253 PIT, 8259 PIC, BIOS int 9h/16h and VGA DAC documentation; the VESA BIOS Extension 1.2 specification; the Microsoft mouse driver int 33h interface |
| WebAssembly objects (`tools/wasm/link.ts`) | the WebAssembly core specification and LLVM's `tool-conventions` Linking.md |

## Observations from the operator-supplied installation

These were made locally in private scratch space and are recorded here only as behaviour/interface facts:

* `Orion2.exe` is a Watcom C/C++ LE program for DOS/4GW (two objects, code at 0x10000 and data at
  0x178000) with a Watcom debug-info appendix. That appendix yields the symbol names the recompiler
  uses for function discovery.
* The program enters the Watcom CRT `int386()`/`int386x()` paths through generated `int N` stubs. These
  are the only replaced routines (`src/recomp/layout.ts`).
* Sound goes through Miles AIL 3.x drivers, called as real-mode int 66h via DPMI 0300h.
* The VESA mode is 640x480x256 with banked (windowed) access. The mouse is used through int 33h with a
  0..1279 horizontal range.

The generated C, `image.bin`, `moo2.wasm`, symbol lists and any disassembly are private, per-user build
output derived from the user's own executable. They are kept outside Git and are never exported.
