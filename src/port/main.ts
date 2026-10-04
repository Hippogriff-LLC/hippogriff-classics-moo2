// Browser entry point for the port of the original program (src/port/shell.ts).
import { bootShell } from "./shell.ts";

void bootShell(document.getElementById("app")!);
