---
schema_version: 1
record_type: unity1-project-integration
unity_mode: unity1
shared_authority_repository: /srv/csjs/repositories/csjs-workstation
shared_consumer_contract: docs/operations/UNITY1_SHARED_CONSUMER_CONTRACT.md
shared_authority_access: read_only
refresh_policy: on_demand
project_owned_record: true
---

# Unity1 Project Integration

## Applicability

Unity1 mode: **ACTIVE**

## Project identity

- Project id: `hippogriff-classics-moo2`
- Canonical repository path: `/srv/csjs/repositories/hippogriff-classics-moo2`
- Canonical branch: `main`
- Remote: `git@github.com:Hippogriff-LLC/hippogriff-classics-moo2.git`
- Project governance/bootstrap entrypoint: `README.md`, `AGENTS.md`, and project-owned task records

## Shared authority

Canonical workstation repository: `/srv/csjs/repositories/csjs-workstation`

Canonical shared consumer contract: `docs/operations/UNITY1_SHARED_CONSUMER_CONTRACT.md`

The workstation repository is read-only authority from this project. Shared changes are returned to Unity1 Control rather than implemented here.

## Stable shared baseline

- `CSJS_*` is inbound package/intake naming.
- `CHATGPT_*` is outbound evidence/handoff naming.
- `csjs-deliver` owns outbound transport.
- long/network/build/export/agent work uses named tmux;
- operator commands are one physical line and never terminate the operator shell;
- governed coding agents use workstation-owned `csjs-agent`;
- shared ports, secrets, backup, provider capabilities, intake/delivery, and runtime authority remain workstation-owned.

## Project-local commands

- Validation: `python3 tools/validate.py`
- Context export: `python3 tools/export_context.py`
- Handoff export: `python3 tools/export_handoff.py`
- Agent sprint/task records: `tasks/`
- Canonical development port query: `csjs-dev-port get hippogriff-classics-moo2 web`

## Project-specific pitfalls

- Never place the operator's original MOO2 installation beneath this repository, even untracked.
- Context/handoff exports include tracked Git content only.
- Do not let the local experiment drift into a server-heavy production architecture.
- Do not invoke vendor coding CLIs directly when `csjs-agent` is the accepted Unity1 path.
- The first implementation sprint belongs to the project-owning thread, not Unity1 Control.

## Context/handoff inclusion

This record and `UNITY1_INTEGRATION_STATE.json` are included in normal project context exports while Unity1 mode is active.
