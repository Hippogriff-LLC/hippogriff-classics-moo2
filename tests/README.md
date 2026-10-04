# Tests

Run with `npm test`, which uses Node's built-in `node:test` runner with native TypeScript stripping.

| Suite | Scope |
| --- | --- |
| `formats.test.ts` | LBX container, RLE image, palette and text decoders, using synthetic fixtures built by the project's own encoders |
| `engine.test.ts` | RNG determinism, new game setup, economy, research, production and buying, colonisation, movement range, combat, invasion, save integrity, and turn determinism across save/load |
| `integration.test.ts` | full all-AI games over 120 turns with state-consistency checks and deterministic replay |

Fixtures are synthetic. Tests never read the original installation and never embed original bytes.

Related checks live outside `tests/`:

* `tools/check.mjs` (`npm run check`): every module links and evaluates, relative imports carry `.ts`,
  and no encoded blobs are present.
* `tools/smoke.mjs` (`npm run smoke`): headless browser smoke test; see
  `docs/operations/LOCAL_DEVELOPMENT.md`.
* `tools/validate.py`: repository bootstrap and proprietary-input boundary validation. Its static
  assertions are not duplicated here.
