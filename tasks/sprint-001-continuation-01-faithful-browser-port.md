# Sprint 001 — Continuation 01: Decompile and Port Master of Orion II

## Continuity

This is a continuation of Sprint 001 after the previous governed `claude-opus-5-5` / exact / high run was interrupted by subscription usage limits.

Continue from the repository exactly as it now exists.

Preserve the existing commits, dirty working-tree edits, untracked research notes, browser importer, LBX work, UI work, tests, and other artifacts from the interrupted run. Do not reset, clean, revert, or discard them merely because the previous run ended before completion.

Review the current state and decide for yourself what is useful. Existing code may be retained, revised, refactored, superseded, or discarded where appropriate. Existing implementation is not automatically authoritative.

## Primary objective

The purpose of this project is to **port the actual Master of Orion II DOS game to a browser-native runtime by decompiling and reverse-engineering the supplied original game**.

The intended technical direction is:

`MOO2.EXE + original game data`
→ reverse engineering / decompilation / disassembly / dynamic analysis
→ recovered original logic, structures, globals, algorithms, constants, state transitions, and behavior
→ portable reconstructed native core
→ WebAssembly-compatible build
→ thin browser platform layer for graphics, audio, input, storage, and user-local asset access

A literal byte-for-byte or instruction-for-instruction translation of the DOS executable is not required. The target runtime is different, so the implementation will necessarily change.

However, the **original executable and data are the authoritative implementation**.

The goal is to recover and port the real game, not to design another game with similar concepts.

## What is not acceptable

Do not solve this task by:

- embedding or wrapping DOSBox or another emulator as the game runtime;
- building a generic or MOO2-inspired 4X game;
- independently inventing replacement gameplay systems because they seem reasonable for the genre;
- treating approximate mechanics from the first run as authoritative merely because they already exist;
- continuing to expand an independently invented TypeScript game engine as though that were the port.

TypeScript/JavaScript may be used for browser/platform integration, tooling, importers, asset access, UI shell, testing, or other appropriate surrounding work.

The game engine itself should come from recovery of the original implementation.

## Acceptable recovery outcomes

Prefer direct or mechanical recovery/translation of original executable behavior into a portable native implementation when practical.

Where literal translation is impractical, a clean replacement implementation is acceptable **only after its behavior has been derived from the original executable/data or otherwise verified against the original game**.

Approximation may be used temporarily during investigation, but it is not an acceptable final substitute for recoverable original behavior.

## Frontier-model authority

You are intentionally given broad freedom over how to accomplish this objective.

You decide:

- how to attack the executable;
- which decompiler, disassembler, debugger, binary-analysis, dynamic-analysis, instrumentation, scripting, or other tools to use;
- what temporary tooling to create;
- how to recover types, globals, structures, tables, functions, calling relationships, and algorithms;
- whether and how to use existing public reverse-engineering knowledge;
- how to slice the work;
- which systems to analyze first;
- what dependencies or abstractions to introduce;
- what language and portable-native implementation strategy best fits the recovered program;
- how to structure the WASM/native boundary;
- what existing first-run code is useful and what should be replaced;
- how to spend the available run time for maximum progress toward the actual port.

Do not wait for the project thread to prescribe a subsystem-by-subsystem plan.

Part of this experiment is specifically to test whether a frontier model can determine how to decompile, recover, and port an old commercial DOS game on its own.

## Original-game access

The operator-supplied original installation is available read-only under:

`private-input/moo2`

You may inspect it deeply, including executables and data, and may use static analysis, decompilation, disassembly, binary inspection, targeted execution/observation, or other technically appropriate reverse-engineering methods.

If your chosen strategy requires a writable private scratch workspace for decompiler databases, temporary extracted binaries, patched experimental copies, dynamic-analysis artifacts, caches, generated symbols, save/config files, or similar non-committable research material, do not weaken the canonical read-only installation or copy proprietary material into tracked paths. Instead, clearly report the need and the exact capability required so Unity1 Control can provide an appropriate private writable research workspace.

## Proprietary-material boundary

The original Master of Orion II installation, executable, LBX files, artwork, music, text, manuals, archives, extracted proprietary assets, disassembly dumps, decompiler databases, and other original-game material must not be committed or redistributed through the public repository or release artifacts.

Temporary private reverse-engineering artifacts may be used locally when technically useful, but must remain outside Git and normal public/context exports.

Independently authored reconstructed source code, specifications, structural descriptions, behavioral observations, synthetic tests, compatibility notes, algorithms, and other clean project material may be committed when consistent with repository policy.

The durable product should rely on a user's legitimate local installation for proprietary assets where needed rather than Hippogriff redistributing them.

## Current first-run work

The interrupted first run created substantial TypeScript/browser work, including import/asset handling, LBX decoding, UI, tests, and an approximate game engine.

Do not discard that work automatically.

Evaluate it as engineering material:

- retain anything that advances the actual port;
- use it as browser/platform scaffolding where appropriate;
- replace or supersede approximate game logic when recovered original implementation makes it incorrect;
- do not spend the run polishing approximate systems simply because they already exist.

The first-run code is evidence and scaffolding, not the behavioral authority.

## Product boundary

The target remains a browser-native port.

The recovered/reconstructed game core should be portable and suitable for WebAssembly or another genuinely browser-native compiled target.

The browser layer should remain comparatively thin and responsible for platform integration such as rendering, audio, input, storage, user-local import, and presentation.

No production deployment, DNS/provider mutation, production database, or hosted proprietary asset corpus is authorized in this sprint.

## Governance

Before substantial work, re-read the repository governance, current Git state, existing Sprint 001 material, research notes, architecture notes, and proprietary-input policies.

Respect the Control-owned read-only projection at `private-input/moo2`.

Do not mutate `csjs-workstation`.

Project-authored material is Apache-2.0 licensed. That license does not apply to original Master of Orion II proprietary material.

## Validation and return

Use your own judgment about how and when to validate while working.

Before returning, leave the strongest coherent and reviewable state you can. Run relevant project-native validation, tests, builds, and browser QA that exist or that you add. Preserve Git hygiene and ensure proprietary source material has not been accidentally tracked or exported.

Make useful commits when appropriate. Do not push or deploy merely to make the run appear complete; project acceptance and release decisions belong to the project-owning thread.

In the final return, explain concisely:

- what parts of the original MOO2 executable/data you actually reverse-engineered or decompiled;
- what original structures, code paths, algorithms, constants, behaviors, or systems were recovered;
- what portable/native/WASM-oriented implementation now exists from that recovery;
- what browser-shell or first-run work was retained and why;
- what remains approximate, inferred, unverified, or not yet recovered;
- what still remains to be decompiled/ported;
- validation/build/browser results;
- final Git HEAD and worktree state;
- any blocker that prevented further progress.

Do not declare Sprint 001 accepted. The project-owning thread decides acceptance.
