# Hippogriff Classics — Master of Orion II

`hippogriff-classics-moo2` is an experimental browser-native reimplementation project for Master of Orion II.

## Bootstrap scope

This repository begins as a Unity1-local research and implementation project. The initial objective is to learn how far a current frontier coding agent can push a clean browser-native reconstruction when given lawful local access to an operator-supplied installation for analysis.

This is **not** a DOSBox-in-browser wrapper.

The repository is intended to contain only independently authored engine code, importer/decoder code, browser client code, tests, tooling, documentation, reverse-engineering specifications, and provenance records.

## Proprietary content boundary

Original MOO2 executables, LBX payloads, artwork, music, text, and other proprietary game data must not be committed here, included in context/handoff exports, or redistributed by Hippogriff.

The eventual user model is local import of a user's own installation, with imported/transformed assets retained browser-locally.

Development research input must remain outside this Git repository. No project-local proprietary-input store is authorized by bootstrap.

## Architecture boundary

The game simulation, rendering, imported asset cache, mods, and computational workload are intended to remain client/browser-side. Optional future account or cloud-save services may exist, but this project must not evolve into a meaningful game-compute workload on Hippogriff/Aerie application servers.

No production deployment is created by bootstrap.

## Unity1

Canonical Unity1 project id: `hippogriff-classics-moo2`

Canonical path: `/srv/csjs/repositories/hippogriff-classics-moo2`

Canonical development block: TCP `3180–3189`

Canonical browser development service: TCP `3180`

See `docs/operations/UNITY1_INTEGRATION.md` and `docs/operations/LOCAL_DEVELOPMENT.md`.

## License

Independently authored project software and documentation are licensed under the Apache License 2.0 (`Apache-2.0`).

This license does not apply to original Master of Orion II executables, LBX payloads, artwork, music, text, manuals, archives, trademarks, or other proprietary game material. See `docs/policy/PROPRIETARY_ASSET_POLICY.md`.
