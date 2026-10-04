# Sprint 002 — Mobile Browser Usability, Diagnostics, Reusable Builds, and Port Coverage

## Starting point

Start from clean synchronized Sprint 001 milestone `dd92765b78cabadb174cb8a9df49e11e89055f6a`.

Sprint 001 established the accepted direction: the real purchased `Orion2.exe` is statically analyzed/recompiled into generated portable C, linked with the native/DOS runtime, built to WebAssembly, and run through the browser host. A fresh operator acceptance rebuilt the private port from the real executable, recovered 6,798 functions, produced ~19.6 MB `moo2.wasm`, rendered the original 640x480 game, reached the original main menu with digital audio, entered New Game, and passed the repository smoke suite.

A real Android Chrome test over a localhost SSH tunnel then exposed practical browser gaps. The port loads and Start succeeds on the phone, but the intro could not be skipped because the current shell has no usable touch/keyboard-equivalent controls, including Escape and other necessary keys. Do not replace or reinterpret original game behavior.

2. Mobile presentation: preserve the original 4:3 game image while fitting the game and required controls inside the mobile visual viewport without distortion, unintended cropping, or reliance on inaccessible page scrolling. Treat portrait and landscape deliberately.

3. Test diagnostics: add a development/test path that records useful browser/worker/WASM/runtime diagnostics to analyzable log artifacts outside the browser UI. A manual/mobile test that turns black, stalls, traps, or loses input/audio should leave enough evidence to investigate afterward. Avoid proprietary-data leakage.

4. Reusable private builds: iterative browser testing must reuse valid generated/recompiled/build artifacts. Do not mechanically rerun the expensive `Orion2.exe` -> generated C -> native/WASM pipeline for every test. Establish a clear safe stale/rebuild model and convenient test workflow.

5. Continue the known remaining work documented in `docs/research/RECOMPILATION.md`, including actual-play sound/volume verification, host mtime support for DOS `int 21h 5700h`, broader exercise of the real recompiled program including tactical combat and progression through a full game/ending plus wider race/settings/reference coverage, browser save import/export and useful browser polish, and performance work only where evidence shows it is needed.

## Authority and boundaries

The current static recompiler/native runtime/WASM/browser architecture is the accepted direction. `Orion2.exe` and original game data remain authoritative.

Do not develop the old TypeScript approximation as the product. Do not invent replacement gameplay logic where original behavior can be recovered.

You decide implementation strategy, subsystem order, test approach, tooling, and how much remaining coverage can responsibly be completed. Follow evidence from the original program. Treat each discovered `rt_bad_call`, DOS/runtime mismatch, audio/input/timing defect, or browser integration failure as a real port defect to investigate at the appropriate layer.

Keep proprietary executable-derived outputs, generated C/images/private builds, original assets, saves, screenshots/captures containing proprietary content, and similar private artifacts outside Git and public exports. Independently authored source, tooling, tests, and documentation belong in the repository. Do not weaken the canonical read-only original-game input boundary.

## Completion

Stop at a coherent milestone. Update authoritative documentation with exactly what was verified, what remains unverified, and any known approximations. Commit coherent repository work. Do not claim coverage that was not exercised.
