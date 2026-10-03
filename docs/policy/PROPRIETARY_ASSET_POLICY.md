# Proprietary Asset Policy

The repository must not contain or redistribute operator-supplied Master of Orion II proprietary content.

Prohibited tracked material includes original executables, archives, LBX payloads, artwork, music, text, manuals, extracted proprietary assets, and other original game data.

The intended eventual application flow is:

1. user opens the browser-native application;
2. user selects/imports their own legitimate MOO2 installation;
3. the client recognizes a supported version;
4. required assets are decoded/transformed locally;
5. transformed/imported data persists locally in the browser;
6. gameplay uses the independently authored engine.

A possession/hash check must not be used as a pretext for Hippogriff to distribute the copyrighted assets.

## Development input

An operator-supplied installation may be used as development/research input only after Unity1 Control identifies an appropriate external private-input location. Bootstrap does **not** authorize placing those files anywhere under this repository.

The repository context exporter includes tracked Git files only. This is a defense-in-depth boundary, not permission to place proprietary bytes untracked beneath the repository tree.
