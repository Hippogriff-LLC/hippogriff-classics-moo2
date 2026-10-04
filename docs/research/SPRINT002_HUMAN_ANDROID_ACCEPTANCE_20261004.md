# Sprint 002 — Human Android Browser Acceptance

Date: 2026-10-04

## Status

HUMAN_MOBILE_ACCEPTANCE=PASS

This is human-operator evidence from a real Android Chrome test of the faithful recompiled Master of Orion II port.

## Test configuration

- Repository base HEAD at Sprint 002 start: `a46318f37f51dab618baf6364c06073192f4bdb6`.
- The browser shell, responsive layout, touch controls, and diagnostic logging came from the uncommitted Sprint 002 working tree left by the 2026-10-04 Opus run.
- The game build was reused from `/tmp/moo2-dd927-acceptance/devbuild`, built from the accepted `dd92765b` port milestone. The phone test did **not** rerun the expensive `Orion2.exe` static recompilation.
- Android Chrome reached Unity1 through a ConnectBot local SSH port forward at `http://127.0.0.1:3180/`.

## Human-observed results

The actual recompiled original game successfully ran in Android Chrome.

Verified in the human test:

- Simtex intro rendered.
- On-screen Escape worked and skipped the intro.
- The original Master of Orion II main menu rendered.
- Touch/pointer interaction worked well enough to enter and drive the real game.
- The original galaxy map rendered and was interactive.
- Original in-game screens/events rendered, including a Nuclear Fission research-completion screen.
- The game remained running for many minutes of real mobile interaction.
- The portrait mobile layout preserved the original 4:3 image with letterboxing and kept controls accessible.
- Diagnostics were written outside the browser UI to a JSONL artifact on Unity1.
- The test reused an existing private WASM/image/entry build without recompiling `Orion2.exe`.

## Diagnostic summary

Source test directory:

`/srv/csjs/artifacts/MOO2_PHONE_TEST_20261004T202608Z`

The full JSONL remains an external test artifact outside Git. Sanitized summary:

- `ROWS=429`
- `ERROR_LIKE=0`
- `LAST_GUESTMS=536203`
- `LAST_FRAMES=9737`
- `LAST_PRESENTED=7283`
- `LAST_VIDEO="640x480"`
- `LAST_LIT=0.634`
- Input: `747` pushed, `0` dropped, `747` consumed.
- Audio: state `running`, `7299584` read, `7299584` written, `4496384` starved, `0` skipped, `0` worker-dropped.
- Control events: `5`
- Touch events: `107`
- Viewport events: `5`
- Visibility events: `5`
- Save-file events: `23`

Observed browser-background behavior: when the page became hidden, frame presentation stopped advancing while guest time continued and the audio starvation counter increased. This may be normal Android Chrome background-tab throttling, but it is useful diagnostic evidence if user-visible problems result.

## Scope and authority

Do not commit proprietary screenshots, original assets, saves, executable-derived generated output, private builds, or raw diagnostic traces that might contain proprietary data.

This text-only acceptance record is safe for Git/public context.

Continuation agents should treat this as authoritative human-operator evidence for Sprint 002 and inspect it before repeating mobile diagnostic work.
