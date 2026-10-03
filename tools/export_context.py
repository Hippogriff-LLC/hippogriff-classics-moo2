#!/usr/bin/env python3
from pathlib import Path
from datetime import datetime, timezone
import subprocess, zipfile, sys

ROOT = Path(__file__).resolve().parents[1]
ART = Path("/srv/csjs/artifacts")
subprocess.run([sys.executable, str(ROOT/"tools/validate.py")], check=True, stdout=subprocess.DEVNULL)
head = subprocess.check_output(["git","-C",str(ROOT),"rev-parse","--short=8","HEAD"], text=True).strip()
tracked = subprocess.check_output(["git","-C",str(ROOT),"ls-files","-z"]).split(b"\0")
files = [x.decode() for x in tracked if x]
stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
out = ART / f"CHATGPT_HIPPOGRIFF_CLASSICS_MOO2_CONTEXT_{head}_{stamp}.zip"
ART.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for rel in files:
        z.write(ROOT/rel, rel)
print(out)
