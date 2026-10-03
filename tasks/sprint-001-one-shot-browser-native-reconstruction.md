# Sprint 001 — One-Shot Browser-Native Reconstruction Experiment

## Authority

This task is the first substantive implementation sprint for `hippogriff-classics-moo2`.

The project-owning thread explicitly authorizes one ambitious governed frontier-agent attempt using:

- agent: `claude`
- model: `claude-opus-5-5`
- model policy: `exact`
- effort: `high`
- execution: workstation-owned `csjs-agent`
- canonical repository: `/srv/csjs/repositories/hippogriff-classics-moo2`
- canonical browser dev port: `3180`

The operator-supplied MOO2 installation is available read-only at:

`private-input/moo2`

The projection is Control-owned. Treat it as research input only.

## Experiment goal

Push a current frontier coding agent as far as it can reasonably go in a single governed implementation run toward a **playable, browser-native reimplementation of Master of Orion II**.

This sprint is intentionally broad. Do not reduce it to a parser spike, architecture essay, mock UI, isolated subsystem prototype, or DOSBox wrapper unless a genuine technical blocker prevents meaningful further implementation.

The desired result is an integrated browser application that demonstrates as much of the actual game loop as can be reconstructed in this run: startup/import, original-data decoding where useful, strategic simulation, map/system/colony/fleet interaction, research/economy/production, turn progression, combat or a meaningful combat slice, AI where feasible, persistence, and a coherent UI.

Completeness is aspirational, not assumed. Prioritize a working integrated vertical whole over polishing one subsystem while leaving the rest unimplemented.

## Product boundary

This is a new implementation informed by lawful behavioral/file-format study.

It is **not** a DOSBox-in-browser target.

Durable architecture:

- game simulation: browser/client;
- rendering/UI: browser/client;
- imported original assets: browser-local;
- transformed/imported cache: browser-local;
- mods: primarily browser/client;
- meaningful game compute: browser/client;
- production delivery: static/versioned artifacts where practical.

Do not introduce a server-heavy gameplay architecture.

No production deployment, DNS mutation, provider mutation, production database, or hosted proprietary asset corpus is authorized.

## Proprietary-input boundary

You may inspect `private-input/moo2` deeply as needed for reverse engineering, format discovery, executable behavior clues, asset identification, and compatibility research.

Hard prohibitions:

- do not modify the private-input projection;
- do not copy original proprietary files into tracked paths;
- do not commit or redistribute original executables, LBX payloads, artwork, music, text, manuals, archives, extracted proprietary assets, or equivalent original-game material;
- do not embed proprietary bytes as source literals, fixtures, base64, generated blobs, screenshots, or test snapshots;
- do not commit bulk disassembly/decompiler output or source-like reproduction of the original program;
- do not create release artifacts containing the operator-supplied installation;
- do not weaken or bypass the read-only projection.

You may commit independently authored:
- format specifications;
- behavioral observations;
- compatibility notes;
- parsers/decoders/importers;
- algorithms and reconstructed rules;
- tests using synthetic fixtures;
- engine/client code;
- provenance records that describe research without redistributing proprietary content.

If runtime use of original assets is needed, design the application around **user-local import of a legitimate installation**, not redistribution by Hippogriff.

## License

Project-authored material is Apache-2.0 licensed.

Do not place claims in repository text implying that Apache-2.0 covers original Master of Orion II content, names, trademarks, or proprietary assets.

## First actions

Before making architectural commitments:

1. Read repository governance and boundaries:
   - `AGENTS.md`
   - `README.md`
   - `docs/architecture/ARCHITECTURE_BOUNDARY.md`
   - `docs/policy/PROPRIETARY_ASSET_POLICY.md`
   - `docs/research/REIMPLEMENTATION_BOUNDARY.md`
   - `docs/operations/PRIVATE_RESEARCH_INPUT.md`
   - `docs/operations/UNITY1_INTEGRATION.md`
   - `docs/operations/LOCAL_DEVELOPMENT.md`
2. Inspect the available original installation under `private-input/moo2`.
3. Inventory enough of its structure and formats to choose a technically grounded implementation path.
4. Inspect binaries/data when useful, while respecting the repository-content boundary.
5. Then choose the stack and reconstructed architecture yourself.

Do not spend most of the run producing planning documents before implementation. Plan enough to make good choices, then build.

## Implementation freedom

You have broad freedom to choose:

- TypeScript/JavaScript/WASM or another browser-suitable implementation stack;
- Canvas/WebGL/WebGPU/DOM rendering strategy;
- application/state architecture;
- LBX and related data decoders;
- deterministic simulation structures;
- local persistence approach;
- import/cache pipeline;
- testing strategy;
- UI composition;
- compatibility abstractions.

Favor maintainable code and deterministic systems, but do not let abstraction work crowd out actual game functionality.

Third-party open-source packages may be used when their licenses are compatible with Apache-2.0 and their inclusion is reasonable. Record material third-party dependencies normally through the package manager.

## Functional ambition

Attempt as much of the following as is technically achievable in this single run:

1. Browser application boots reliably.
2. User-local MOO2 installation import/recognition flow exists, or the development projection can be consumed through an equivalent development-only import path without hard-coding Unity1 paths into production behavior.
3. Important original data formats are decoded rather than manually recreated when that improves fidelity.
4. A new game can be initialized.
5. Galaxy/star-system state exists and renders.
6. Player can inspect systems, planets, colonies, fleets, leaders/technology/economy surfaces where implemented.
7. Turn progression advances deterministic simulation state.
8. Colony economy/production/research has meaningful mechanics.
9. Fleet movement and strategic interaction exist.
10. Diplomacy, espionage, AI opponents, tactical combat, ship design, technology, races/government, events, and victory logic are implemented as far as time allows.
11. Save/load or durable browser-local persistence exists.
12. UI is usable enough for human browser QA rather than being only a developer harness.

Where exact behavior cannot be reconstructed confidently, prefer an explicit approximation/TODO with a clear boundary over invented claims of exact fidelity.

## Research discipline

Create concise independently authored research/specification records when they materially help implementation.

For important reconstructed behaviors or formats, distinguish:

- observed from original data/runtime;
- inferred;
- approximated;
- not yet verified.

Do not claim byte-perfect or rules-perfect compatibility without evidence.

## Testing and validation

Build project-native automated validation as the implementation emerges.

At minimum before returning:

- run `python3 tools/validate.py`;
- run the project's package/unit/integration tests;
- run a production-style browser build;
- ensure `git diff --check` passes;
- confirm `git status --short` contains no proprietary input;
- confirm the application can start on the canonical Unity1 development port obtained from:
  `csjs-dev-port get hippogriff-classics-moo2 web`
- do not bind to `0.0.0.0` or `::`;
- if practical, perform browser smoke validation against the running application;
- ensure normal `tools/export_context.py` remains capable of exporting only tracked safe content.

If you add validation tooling, keep it project-local and deterministic.

## Git / delivery behavior

Work directly in the registered project repository under the governed agent run.

Make useful commits during the sprint rather than leaving all implementation uncommitted.

Do not mutate `csjs-workstation`.

Do not push proprietary data.

Do not deploy production.

At completion, leave the project in the strongest reviewable state you can: coherent commits, tests/build results, research notes where useful, and a concise final report.

The project-owning thread—not the coding agent—decides final Sprint 001 acceptance and release status.

## Final return

Your final response should be concise but technically useful and include:

- what was implemented;
- major architecture chosen;
- how original installation data is imported/decoded;
- what game systems are genuinely working;
- what is incomplete or approximate;
- validation/build/test results;
- browser/dev-server QA status;
- final Git HEAD and workspace cleanliness;
- any blockers that prevented further implementation.

Also emit the workstation-supported structured validation block when possible, using only safe repository-relative evidence paths and no proprietary content.

Do not declare the sprint accepted. Report evidence for the project-owning thread to judge.
