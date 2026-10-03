#!/usr/bin/env python3
from pathlib import Path
from datetime import datetime, timezone
import subprocess

ROOT=Path(__file__).resolve().parents[1]
ART=Path("/srv/csjs/artifacts")
head=subprocess.check_output(["git","-C",str(ROOT),"rev-parse","HEAD"],text=True).strip()
stamp=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
out=ART/f"CHATGPT_HIPPOGRIFF_CLASSICS_MOO2_THREAD_HANDOFF_{stamp}.md"
text=f"""# Hippogriff Classics MOO2 — Project Thread Handoff

- Project id: `hippogriff-classics-moo2`
- Canonical path: `/srv/csjs/repositories/hippogriff-classics-moo2`
- Remote: `git@github.com:Hippogriff-LLC/hippogriff-classics-moo2.git`
- Visibility: public
- Branch: `main`
- HEAD: `{head}`
- Unity1 port block: `3180–3189`
- Canonical browser dev port: `3180`

## Bootstrap boundary

Repository bootstrap is complete only when accompanied by Unity1 Control acceptance.

No production deployment is authorized.

Unity1 Control has accepted an external private research-input mechanism. The operator-owned installation is visible read-only at `private-input/moo2`; proprietary bytes remain outside Git and outside normal project context/handoff exports.

## Recommended next project-thread action

Review the private-input acceptance, select the project software license, then author Sprint 001 for the governed `claude-opus-5-5` / exact / high experiment. Do not copy proprietary input into tracked or release paths.
"""
ART.mkdir(parents=True,exist_ok=True)
out.write_text(text,encoding="utf-8")
print(out)
