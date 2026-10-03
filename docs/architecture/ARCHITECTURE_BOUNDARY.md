# Architecture Boundary

## Initial target

A browser-native reimplementation engine and client. This bootstrap intentionally does not prescribe the detailed reconstructed game architecture; Sprint 001 should have room to inspect the original software and attempt an ambitious whole-program solution.

## Durable boundary

The intended long-term workload split is:

- simulation: browser/client
- rendering: browser/client
- imported original assets: browser-local
- transformed/imported asset cache: browser-local, preferably IndexedDB or an equivalent browser-local store
- mods: primarily browser/client
- computational game workload: browser/client
- engine/application releases: static/versioned distribution where practical

Possible future small Hippogriff services may provide account/login or cloud-save synchronization. They are not authorized or provisioned by bootstrap.

Hippogriff/Aerie production application servers must not become game simulation/rendering/asset-hosting compute.

## Explicit exclusions during bootstrap

- no production deployment
- no production database
- no production DNS/provider changes
- no game server
- no hosted original MOO2 asset corpus
- no detailed subsystem architecture imposed before the frontier-model experiment
