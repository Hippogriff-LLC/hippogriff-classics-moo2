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

Original MOO2 files must remain outside Git and must not be installed until Unity1 Control designates/accepts an external private research-input location that will not leak into repository context exports or public artifacts.

## Recommended next project-thread action

Review repository bootstrap/context, select the project software license, resolve the private research-input location with Unity1 Control, then author Sprint 001 for the governed `claude-opus-5-5` / exact / high experiment. Do not launch the agent until the original game input location has been accepted and populated through the approved mechanism.
"""
ART.mkdir(parents=True,exist_ok=True)
out.write_text(text,encoding="utf-8")
print(out)
