# Static recompilation of Orion2.exe (the port)

This is the Sprint 001 continuation approach. The original DOS program is translated mechanically from
the user's own `Orion2.exe` into portable C. That C is compiled natively and to WebAssembly and runs on a
small runtime that provides DOS, the DPMI extender and PC hardware. In the browser, a thin platform layer
supplies files, the display, input and time. The game logic, data layouts, AI, combat, UI and rendering
are therefore the original program's own code, not a reimplementation of it.

This is not an emulator. No x86 interpreter or JIT runs at play time. Every guest instruction is
translated ahead of time into C statements that operate on a guest register file and a flat guest memory.

```
Orion2.exe (user's copy)
  └─ tools/re/recompile.ts ──► <private>/gen/*.c, funcs.h, image.bin, entry.txt, symbols.txt
        src/recomp/le.ts         LE loader: MZ stub, object table, page map, internal fixups
        src/recomp/watcomdbg.ts  Watcom debug info v3: module and global symbol names/addresses
        src/recomp/x86.ts        IA-32 decoder (integer, string ops, the x87 subset used)
        src/recomp/analyze.ts    function discovery, recursive descent, jump tables
        src/recomp/emit-c.ts     C emission with lazy flags, guest stack and back-edge polling
        src/recomp/layout.ts     guest layout (+1 MB shift) and the HLE override table
  └─ runtime/native.mk ──► moo2-native     (runtime/host_native.c: files, PPM frames, scripts, control FIFO)
  └─ runtime/wasm.mk   ──► moo2.wasm       (tools/wasm/wasmcc.cpp + tools/wasm/link.ts; runtime/host_wasm.c)
        runtime/rt.c  memory, selectors, interrupt delivery, x87 model, diagnostics
        runtime/dos.c DOS int 21h, DOS/4GW-compatible DPMI int 31h, environment, files
        runtime/pc.c  PIT/PIC time base, int 8/9/16h, int 33h mouse, VGA DAC, VBE 1.2 banked 640x480x256
        runtime/audio.c  virtual Miles AIL 3 digital (.DIG) driver: int 66h VDI calls, DMA double buffer
  └─ src/port/ ──► browser: shell.ts (setup), worker.ts + host.ts (runs moo2.wasm), input.ts, store.ts,
                    audio.ts + audio-worklet.ts (sound ring and AudioWorklet output)
```

## What was reverse engineered

* **Container.** `Orion2.exe` is a Watcom C/C++ 10.x linear executable for DOS/4GW with two objects: code
  preferred at 0x10000 and data at 0x178000. It carries a complete Watcom debug-info appendix, so module
  and function names are available: 8598 symbols, including the Miles AIL 3.x sound library, the Watcom
  CRT and the game's own modules.
* **Control flow.** Functions are found from code symbols, direct call and tail-jump targets, and
  address-taken code (fixups into the code object). Bodies are recovered by recursive descent within the
  enclosing symbol range, and switch tables from indirect jumps through fixed-up tables. The result is
  6798 functions and about 23 MB of generated C. Indirect calls go through a generated dispatch switch.
  An unknown target traps through `rt_bad_call` with the guest address, so a gap shows up as a diagnostic
  instead of silent misbehaviour (none are hit in the play-through below).
* **Platform boundary.** The program talks to DOS/4GW (DPMI 0.9: selectors, memory blocks, real-mode
  interrupt simulation via 0300h, interrupt vectors), DOS (file I/O, find-first/next, date/time), the BIOS
  keyboard and timer, an int 33h mouse driver and a VESA banked 640x480x256 mode. The runtime implements
  exactly those services from the public interface descriptions.
* **HLE overrides.** Only two routines are replaced (`layout.ts`): the Watcom CRT `int386()` and
  `int386x()` back ends, `_DoINTR_` and `__int386x_`. They build `int N` stubs and enter them with
  `push addr; ret`, which the static model cannot express. Everything else runs as translated code.
* **Sound driver interface.** The Miles AIL 3.02 library is linked into the executable: its sample mixer
  (`_SS_serve`, `_AILSSA_merge`), stream code and XMIDI sequencer all run as translated code. Only the
  hardware layer sits outside, in real-mode driver files (`SB16.DIG`, `SBPRO2.MDI`, chosen by `DIG.INI`
  and `MDI.INI`). The library copies the driver into DOS memory and points the int 66h real-mode vector at
  it. It then calls it through DPMI 0300h with AX = function (300h init, 301h get info, 304h verify I/O,
  305h/306h device init/shutdown, 401h start playback with CX = rate and DX = format, 402h stop) and the
  arguments in BX/CX/DX/SI/DI. Function 301h returns two real-mode far pointers:
  * a driver description table: supported formats, and per format the rate range, half-buffer size range
    and sample flags;
  * a status table: the two DMA half-buffers and the index of the half the card is playing.

  The mixer reads that index on each timer service and refills the other half when it changes.
  `runtime/audio.c` answers these calls as a virtual digital driver. It offers one 16-bit stereo signed
  format, reports which half is playing as the guest clock consumes it at the programmed rate, and hands
  each half to `host_audio_write`, resampled to the host rate. Music drivers (`.MDI`) are reported absent.

## What runs (verified with the operator-supplied installation)

The native host was driven interactively through `--control`, and the browser was driven by
`tools/smoke.mjs --play`. Verified so far:

* the Simtex/MicroProse intro and the main menu;
* sound: the intro soundtrack and the main-menu music, which are digitized streams (`STREAM.LBX`), play
  through the virtual sound driver. A native `--wav` capture of the first 30 s holds 20.7 s of
  non-silent, correlated stereo audio starting when the intro does, with no discontinuities at the
  half-buffer seams. In Chromium the AudioWorklet consumed over 330,000 frames by the main menu;
* New Game setup, rendered in Chromium from `moo2.wasm`;
* Continue (loads `SAVE10.GAM`), with the home-star accept;
* research selection;
* the colony screen and build queue (a colony ship and a destroyer queued);
* more than 10 turns, with the research countdown advancing;
* the Colonies, Planets, Fleet Operations, Leaders, Race Relations and Info/Reference screens;
* GAME → Save Game (a 208,000-byte `SAVE1.GAM` written to the copy-on-write save directory) and Load
  Game restoring that state.

None of this produced a trap. Input behaviour follows the original, for example its rule that the first
Backspace in a save-name field clears the whole field.

## Building privately

Every output below derives from proprietary program bytes. Keep all of it outside the repository (the
tools refuse in-repo output) and never commit, export or redistribute it.

```
S=/some/private/dir
node tools/re/recompile.ts /path/to/MOO2/Orion2.exe $S/build      # gen/, image.bin, entry.txt, symbols.txt
make -f runtime/native.mk BUILD=$S/build OUT=$S/native -j4         # moo2-native
make -f runtime/wasm.mk   BUILD=$S/build OUT=$S/wasm   -j4         # moo2.wasm (~19.6 MB)
mkdir -p $S/devbuild && cp $S/wasm/moo2.wasm $S/build/image.bin $S/build/entry.txt $S/devbuild/
```

Run it in one of these ways:

* **Browser (end-user model).** `npm run dev` (or `serve:dist`), open the page, choose the installation
  folder and the build folder (the one holding `moo2.wasm`, `image.bin` and `entry.txt`). Both stay in
  this browser's IndexedDB, and saves are stored there as well. The page needs cross-origin isolation
  (COOP/COEP) for `SharedArrayBuffer`, which `tools/serve.mjs` provides.
* **Browser (development).** `node tools/serve.mjs --dev-install <install> --dev-build $S/devbuild`
  streams both through `/__dev_install/` and `/__dev_build/`, using Range requests for large files.
  `node tools/smoke.mjs --dev-install <install> --dev-build $S/devbuild --play` boots the port in
  Chromium.
* **Native.** `moo2-native $S/build <install> <save-dir> <frame-dir> [--ms N] [--every N] [--script F]
  [--realtime] [--control FIFO] [--wav F]`. The save directory is copy-on-write over the installation. Frames are
  written as PPM. `--control FIFO` takes line commands (`run MS`, `click X Y`, `move X Y`, `key SC`,
  `type TEXT`, `shot PATH`, `quit`) and replies `ok <ms>`. Guest time advances only on `run`/input, so
  sessions are deterministic. `--wav F` records the sound output (22050 Hz stereo) and reports its
  length and peak level on exit.
* **Node through the browser host.** `node tools/wasm/run.ts $S/wasm/moo2.wasm $S/build <install> …`
  runs `moo2.wasm` through `src/port/host.ts`, so it can be compared against the native host.

## Approximations and known gaps

* **Sound.** Digitized sound (effects, speech and the streamed music) goes through the virtual digital
  driver. The original mixer output reaches the host unchanged except for rate conversion: linear
  interpolation from the hardware rate the library picks (22050 Hz nominal) to the host's rate. Only the intro
  and menu streams have been verified (by capture analysis, not by ear). Individual effects during play
  have not been checked one by one. XMIDI music through an `.MDI` driver is not emulated, because that synthesis lives in the driver
  rather than the game. With the stock `MDI.INI` the library runs without a MIDI device. Browsers start
  sound only after a user gesture, so the AudioContext is created by the Start click and resumed on input.
* **File times.** int 21h AX=5700h returns a fixed date (1 Oct 1996) because `host.h` has no mtime
  service. No visible effect has been observed so far.
* **Timing.** Virtual time charges a fixed cost per back-edge poll and per idle op, which is
  deterministic but not cycle-accurate. Real-time mode (the browser default) syncs to the host clock
  while the guest idles. Animation speed is close to the original but not measured against hardware.
* **Performance.** The translated code is unoptimized at the guest level: lazy flags, a guest stack in guest
  memory and register synchronisation around every call. It runs at playable speed natively and in Chromium on the
  development host, but it has not been profiled on low-end devices.
* **No mid-run snapshots.** Game saves work. Saving the whole machine state does not exist yet.
* **Coverage.** Translation is static, so code paths that were never recovered would trap at
  `rt_bad_call`. The play-through above exercised none, but tactical combat, multiplayer (IPX/modem,
  intentionally unsupported) and the ending sequences have not been exercised yet.

## What remains

1. Sound checks during play: individual effects in combat and the UI, and the volume settings. An `.MDI`
   synthesizer only if a configuration that needs one turns up.
2. A host mtime API for int 21h 5700h.
3. Wider exercise: tactical combat, a full game to an ending, every race and setting, the reference
   screens. Each `rt_bad_call` hit becomes either an extra entry for `analyze` or a runtime fix.
4. Browser polish: pointer lock or scaling choices, a save import/export UI and touch input.
5. Performance work if needed: flag-liveness analysis in `emit-c.ts` and fewer register syncs at calls.

The first-run TypeScript engine (`src/engine/`, `src/ui/`, now reached through `prototype.html`) is a
MOO2-inspired approximation. It is kept as scaffolding and for its LBX decoders (`src/formats/`), but it
is not the port and is no longer the main entry point.
