# Private Research Input — MOO2

Unity1 Control provides the operator-owned original MOO2 installation through the ignored repo-local path:

`private-input/moo2`

That path is a persistent **read-only projection** of Control-owned private backing storage. The original archive and extracted proprietary bytes are not Git content.

Rules:

- never add files under `private-input/` to Git;
- never copy original executable/LBX/art/audio/text payloads into tracked paths, context packages, handoff packages, release artifacts, or public GitHub artifacts;
- use the projection only for local reverse engineering, format study, behavioral compatibility work, and tests that require the operator-supplied installation;
- generated specifications and independently authored implementation may enter Git only when they do not redistribute original game content;
- the projection is Control-owned; do not remount it writable or replace it with a project-local copy;
- production deployment remains unauthorized.

The repository's normal context exporter uses tracked Git files only and therefore does not traverse this projection.
