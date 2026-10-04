# Imported asset map (index observations)

The browser client reads a small subset of the user's own installation after it has been imported locally
(see `src/import/install.ts`). This page records **which archive and entry index** each feature uses. It
holds no content: no pixels, palettes, names or text.

The constants live in `ASSET` in `src/import/assets.ts`. They were checked against one v1.31
installation. If an entry is missing or fails to decode, the UI falls back to its procedural artwork for
that item.

| Archive | Use | Index observation |
| --- | --- | --- |
| `FONTS.LBX` | base palettes | entry 1: main game palette; entry 12: neutral ramp used for tinted ship hulls |
| `MAINMENU.LBX` | title art on the main menu | entry 1 |
| `BUFFER0.LBX` | galaxy-map stars | entry 148 + 6 × colour + size (size 0 = largest); black hole at 184 |
| `BUFFER0.LBX` | system-view stars | entry 83 + colour |
| `BUFFER0.LBX` | planet icons | entry 92 + 5 × climate + size, multi-frame rotation; gas giant at 142 |
| `RACESEL.LBX` | race portraits | entry 15 + race portrait index |
| `SHIPS.LBX` | ship sprites | blocks of 50 entries per colour style; within a block, hull class × 8 + variant. Sprites are 52 × 48, face right and have a neutral palette (recoloured per empire) |
| `STARBG.LBX` | combat and screen backdrops | entries 0–5 |
| `PLANETS.LBX` | planet surface art | entries 0–29 |
| `STARNAME.LBX` | star names | entry 1, fixed-record table |
| `SHIPNAME.LBX` | ship names | entry 0, fixed-record table |
| `RACENAME.LBX` | race names | entry 0, fixed-record table |
| `TECHNAME.LBX` | technology names | entry 0, NUL-separated list |

The importer checks that all eleven archives are present and parse as LBX containers. It records the
product version found in the installation (for example `1.31`) and stores the archives in this browser's
IndexedDB (`hippogriff-moo2` → `install-files`). The default procedural names stay in use until an import
succeeds. Saves never contain asset bytes.

`tools/research/lbx-inventory.ts` prints entry counts and image dimensions for a local directory, which is
how these observations were made. Its output can contain names from the original files, so it goes to the
terminal only and is never committed.
