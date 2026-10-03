#!/usr/bin/env python3
from pathlib import Path
import json, subprocess, sys

ROOT = Path(__file__).resolve().parents[1]
required = [
    "README.md",
    "LICENSE",
    "AGENTS.md",
    "project.json",
    "docs/architecture/ARCHITECTURE_BOUNDARY.md",
    "docs/policy/PROPRIETARY_ASSET_POLICY.md",
    "docs/research/REIMPLEMENTATION_BOUNDARY.md",
    "docs/operations/LOCAL_DEVELOPMENT.md",
    "docs/operations/UNITY1_INTEGRATION.md",
    "docs/operations/UNITY1_INTEGRATION_STATE.json",
    "tasks/README.md",
    "tests/README.md",
    "provenance/README.md",
    "tools/export_context.py",
    "tools/export_handoff.py",
]
for rel in required:
    if not (ROOT / rel).is_file():
        raise SystemExit(f"FAIL: missing required file: {rel}")

meta = json.loads((ROOT / "project.json").read_text())
assert meta["project_id"] == "hippogriff-classics-moo2"
assert meta["canonical_path"] == "/srv/csjs/repositories/hippogriff-classics-moo2"
assert meta["primary_branch"] == "main"
assert meta["visibility"] == "public"
assert meta["unity1"]["port_block"] == {"start": 3180, "end": 3189}
assert meta["unity1"]["services"][0]["port"] == 3180
assert meta["production_deployment_authorized"] is False
assert meta["proprietary_game_assets_in_repository"] is False
assert meta["license"] == "Apache-2.0"

state = json.loads((ROOT / "docs/operations/UNITY1_INTEGRATION_STATE.json").read_text())
assert state["project_id"] == meta["project_id"]
assert state["unity_mode"] == "unity1"
assert state["shared_authority_mutation_forbidden"] is True

try:
    tracked = subprocess.check_output(["git", "-C", str(ROOT), "ls-files", "-z"])
except subprocess.CalledProcessError:
    raise SystemExit("FAIL: git ls-files failed")
files = [x.decode("utf-8", "replace") for x in tracked.split(b"\0") if x]
bad_parts = {"private-input","original-game","original-game-files","research-input","proprietary-input","moo2-installation"}
bad_ext = {".lbx",".exe",".com",".iso",".cue",".img",".7z",".rar"}
for rel in files:
    p = Path(rel)
    if any(part.lower() in bad_parts for part in p.parts):
        raise SystemExit(f"FAIL: prohibited tracked research-input path: {rel}")
    if p.suffix.lower() in bad_ext:
        raise SystemExit(f"FAIL: prohibited tracked proprietary/binary extension: {rel}")
    fp = ROOT / rel
    if fp.is_file() and fp.stat().st_size > 5 * 1024 * 1024:
        raise SystemExit(f"FAIL: tracked file exceeds bootstrap 5 MiB review threshold: {rel}")

print("HIPPOGRIFF_CLASSICS_MOO2_VALIDATION=PASS")
print(f"TRACKED_FILES={len(files)}")
print("PROPRIETARY_TRACKED_INPUT=NONE_DETECTED")
