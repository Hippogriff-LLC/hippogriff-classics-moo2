# Local Development on Unity1

Canonical project id: `hippogriff-classics-moo2`

Reserved Unity1 block: TCP `3180–3189`

Canonical browser-development service: `web` on TCP `3180` (`csjs-dev-port get hippogriff-classics-moo2 web`).

## Requirements

Node.js ≥ 24 (built-in TypeScript type stripping). There are no npm dependencies, so there is nothing to
install.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | dev server on `127.0.0.1:3180` serving `src/` with on-the-fly type stripping |
| `npm run build` | production-style static build into `dist/` (git-ignored) |
| `npm run serve:dist` | serve `dist/` on `127.0.0.1:3180` |
| `npm test` | unit and integration tests (`node:test`) |
| `npm run check` | link and evaluate every module, check import extensions, flag encoded blobs |
| `npm run smoke` | headless Chromium smoke test against a freshly spawned `dist/` server |
| `python3 tools/validate.py` | repository and proprietary-input boundary validation |

Options for the servers: `--host`, `--port`, `--mode dev|dist`. Other ports must come from the reserved
block.

## Binding rules

- bind `127.0.0.1` for Unity1-only work (the default);
- for phone or browser QA, bind specifically to the current Unity1 Tailscale IPv4 returned by
  `csjs-dev-port host` (`--host <ip>`);
- do not bind `0.0.0.0`, `::` or another wildcard; `tools/serve.mjs` refuses them;
- do not create production ingress.

## Testing with an original installation (development only)

End users import their own installation through **Import original data** (folder picker). For
development, the dev server can expose an operator-supplied directory instead:

```
node tools/serve.mjs --mode dev --dev-install /path/to/installation
```

The import screen then shows **Use development installation**. Files are streamed to the browser and
stored in that browser profile's IndexedDB; nothing is copied into the repository or into `dist/`. The
directory must stay outside Git, and the read-only private-input projection must not be modified.

## Running the recompilation port (development only)

`index.html` is the port shell, and it needs a private build made from the user's own `Orion2.exe`. See
`docs/research/RECOMPILATION.md` for how to make one. Keep all build output outside the repository. To
provide the installation and the build without the folder pickers:

```
node tools/serve.mjs --mode dev --dev-install /path/to/installation --dev-build /private/devbuild
node tools/smoke.mjs --dev-install /path/to/installation --dev-build /private/devbuild --play \
  --screenshots "$TMPDIR/shots"
```

The server always sends COOP/COEP/CORP headers, because the port worker needs `SharedArrayBuffer`.
Screenshots of the running port show original artwork. Keep them out of Git and out of exports.

## Browser smoke test

`tools/smoke.mjs` drives a local Chromium over the DevTools protocol, without npm packages. By default it
finds the Playwright cache; override this with `--chrome` or `CHROME_PATH`. If no browser is found it
reports `SMOKE=BLOCKED`.

```
npm run build && npm run smoke                        # spawns the dist server on 127.0.0.1:3180
node tools/smoke.mjs --url http://127.0.0.1:3180/      # against an already running dev or dist server
node tools/smoke.mjs --url … --import-dev              # dev server started with --dev-install
node tools/smoke.mjs --screenshots "$TMPDIR/shots"     # optional screenshots, never inside the repo
```

The test covers the following:

- the menu and about screen;
- an optional development import;
- a new game, checking that the galaxy canvas draws;
- each management screen with one action on each;
- six turns;
- a staged tactical battle (opened, then auto-resolved);
- save and load;
- continue;
- the import screen.

Screenshots taken after `--import-dev` show original artwork. Keep them out of Git and out of any export.
