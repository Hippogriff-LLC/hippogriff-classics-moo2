# Tests

Run with `npm test`, which uses Node's built-in `node:test` runner with native TypeScript stripping.

| Suite | Scope |
| --- | --- |
| `formats.test.ts` | LBX container, RLE image, palette and text decoders, using synthetic fixtures built by the project's own encoders |
| `engine.test.ts` | RNG determinism, new game setup, economy, research, production and buying, colonisation, movement range, combat, invasion, save integrity, and turn determinism across save/load |
| `integration.test.ts` | full all-AI games over 120 turns with state-consistency checks and deterministic replay |
| `recomp.test.ts` | the static recompiler on a hand-assembled synthetic LE program: LE loading and fixups, x86 decoding, control-flow recovery (recursion, a switch table, an address-taken function), and an end-to-end run of the emitted C compiled with `runtime/` and `fixtures/host_test.c` (skipped if no C compiler is found) |
| `runtime.test.ts` | the virtual Miles digital sound driver (`runtime/audio.c`, compiled with `fixtures/audio_test.c`): driver info tables, device verification, double-buffer playback and resampling at three host rates; and the browser port's shared sound ring (ordering, overflow, underrun, latency bound) |

Fixtures are synthetic. Tests never read the original installation and never embed original bytes.

Related checks live outside `tests/`:

* `tools/check.mjs` (`npm run check`): every module links and evaluates, relative imports carry `.ts`,
  and no encoded blobs are present.
* `tools/smoke.mjs` (`npm run smoke`): headless browser smoke test; see
  `docs/operations/LOCAL_DEVELOPMENT.md`.
* `tools/validate.py`: repository bootstrap and proprietary-input boundary validation. Its static
  assertions are not duplicated here.
