# Private Input Access Check — Control Diagnostic

This is a bounded Unity1 Control diagnostic. It is **not Sprint 001** and must not perform game reconstruction.

Required actions only:

1. Read `private-input/moo2/.csjs-control/AGENT_READ_PROBE.txt` and confirm its single marker equals `UNITY1_MOO2_PRIVATE_INPUT_READ_PROBE_V1`.
2. Read `private-input/moo2/.csjs-control/SAMPLE.json`.
3. Without printing the proprietary file contents, compute SHA-256 and file size for the sample path named in that JSON and confirm they match the JSON.
4. Attempt to create `private-input/moo2/.csjs-control/agent-write-probe.tmp`. The write must fail because the projection is read-only. Do not attempt privilege escalation, remounting, chmod/chown, alternate backing-path access, or any workaround.
5. Run `git status --short` and confirm the repository remains clean.
6. Do not edit tracked files.

Return exactly these evidence lines, followed by at most two short explanatory sentences:

`MOO2_PRIVATE_INPUT_AGENT_READ=PASS`
`MOO2_PRIVATE_INPUT_SAMPLE_HASH=PASS`
`MOO2_PRIVATE_INPUT_AGENT_MUTATION_BLOCKED=PASS`
`MOO2_PRIVATE_INPUT_GIT_CLEAN=PASS`
`SPRINT001_AGENT_RUN=NO`
