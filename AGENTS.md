# Agent Instructions — Hippogriff Classics MOO2

This repository is project authority for the Hippogriff Classics Master of Orion II reimplementation.

## Hard boundaries

- Never commit or redistribute original MOO2 executables, LBX payloads, artwork, music, text, manuals, archives, or other proprietary game content.
- Development-only original game material must remain outside this repository and outside ordinary context/handoff exports.
- Independently authored reverse-engineering notes/specifications may be committed; avoid copying large decompiler outputs or proprietary source-like material into Git.
- Do not introduce a DOSBox-in-browser wrapper as the target architecture.
- Preserve the browser/client-heavy architecture boundary. Do not make Hippogriff/Aerie production servers responsible for simulation, rendering, imported asset hosting, or game compute.
- No production deployment or provider mutation is authorized by repository bootstrap.
- Use Unity1 shared infrastructure rather than recreating shared ports, secrets, delivery, backup, runtime, or AI-agent mechanisms locally.

## Initial implementation intent

After bootstrap acceptance, the project-owning thread may author Sprint 001 for an intentionally ambitious governed Claude Opus 5.5 experiment. Bootstrap itself does not authorize that run.

## Unity1 agent execution

When a governed coding run is approved, use workstation-owned `csjs-agent`; do not invoke vendor coding CLIs directly.
