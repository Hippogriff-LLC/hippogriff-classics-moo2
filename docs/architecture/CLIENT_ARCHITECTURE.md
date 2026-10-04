# Client architecture (Sprint 001)

> **Continuation update.** `index.html` is now the recompilation port shell (`src/port/`). It runs a private
> `moo2.wasm` built from the user's own `Orion2.exe` in a worker, with the installation, build and saves
> kept in the IndexedDB database `hippogriff-moo2-port`. It needs cross-origin isolation, which
> `tools/serve.mjs` sends as COOP/COEP headers. See `docs/research/RECOMPILATION.md`. The remainder of
> this document describes the first-run TypeScript engine, which is superseded scaffolding now reached at
> `prototype.html`.

Everything runs in the browser: simulation, rendering, the imported-asset cache and saves. The server
only serves static files. There are no runtime npm dependencies, and the toolchain is Node ≥ 24 alone.

```
src/
  formats/   pure decoders: LBX container, RLE images, palettes, text tables (+ encoders for fixtures)
  engine/    deterministic simulation; plain-JSON GameState; no DOM access
    data/    project-authored tables: races, techs, buildings, hulls/weapons/components
  import/    user-local import → IndexedDB; AssetService decodes images/names on demand
  ui/        vanilla DOM + canvas screens (galaxy, colonies, research, design, fleets, races, info,
             tactical combat, menus/import/saves)
  main.ts    entry point; index.html; styles.css
tools/       build, dev/dist server, static checks, browser smoke test, research inventory
tests/       node:test suites (formats, engine, integration)
```

## Layering

* `engine/` imports only `engine/` modules. It runs unchanged in Node, which is what the tests use, and
  in the browser. Every random draw goes through the sfc32 `Rng`, whose state is stored in `GameState`.
  A save is the JSON state plus a header and an FNV-1a checksum (`engine/save.ts`).
* `formats/` has no dependencies. Decoders take `Uint8Array` and return typed structures.
* `import/` is the only code that touches original data, and only data the user imported in this
  browser. If nothing has been imported, `AssetService` getters return `null`; the UI then draws
  procedural art (`ui/art.ts`) and uses procedural names (`engine/names.ts`).
* `ui/` holds an `App` with a screen map, modals and toasts. It calls engine functions directly and
  re-renders the active screen after each change. `data-testid` attributes support the smoke test.

## Persistence

| Store | Contents |
| --- | --- |
| IndexedDB `hippogriff-moo2` / `install-files` | the user's imported LBX archives (browser-local only) |
| IndexedDB `hippogriff-moo2` / `meta` | import metadata (version, file list, time, source) |
| IndexedDB `hippogriff-moo2` / `saves` | save slots and autosave (JSON) |

Saves can also be downloaded and uploaded as `.json` files. They never contain asset bytes.

## Build and serving

* `tools/build.mjs` strips TypeScript types with Node's built-in `stripTypeScriptTypes`, rewrites `.ts`
  specifiers to `.js` (in modules and in `index.html`), copies static files and writes
  `dist/build-info.json`. The output is plain static files.
* `tools/serve.mjs` serves either `src/` (stripping types on the fly) or `dist/`. It binds loopback by
  default, refuses wildcard addresses and sets a strict CSP. `--dev-install <dir>` is a development-only
  option of the dev server: it lets the in-browser importer read a local installation through
  `/__dev_install/`. The production build contains no reference to any local path, and its importer
  probes that endpoint only when running from source.
