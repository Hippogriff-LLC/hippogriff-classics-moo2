# Local Development on Unity1

Canonical project id: `hippogriff-classics-moo2`

Reserved Unity1 block: TCP `3180–3189`

Canonical browser-development service: `web` on TCP `3180`.

The implementation stack is intentionally not selected by bootstrap.

When Sprint 001 establishes a browser development server:

- consume the canonical port through `csjs-dev-port get hippogriff-classics-moo2 web`;
- bind `127.0.0.1` for Unity1-only work;
- for phone/browser QA, bind specifically to the current Unity1 Tailscale IPv4 returned by `csjs-dev-port host`;
- do not bind `0.0.0.0`, `::`, or another wildcard;
- do not create production ingress.

No runtime listener is expected during repository bootstrap.
