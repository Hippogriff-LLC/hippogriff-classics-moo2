#!/usr/bin/env node
// Browser smoke test using a locally installed Chromium over the DevTools protocol (no npm dependencies).
//
//   node tools/smoke.mjs                         build output: spawn `serve.mjs --mode dist` on 127.0.0.1:<port>
//   node tools/smoke.mjs --url http://127.0.0.1:3180/   test an already running dev or dist server
//   --port 3180          port for the spawned server (default: canonical port)
//   --chrome <path>      Chromium binary (default: $CHROME_PATH or the Playwright cache)
//   --screenshots <dir>  write PNG screenshots (default: none; never write them into the repository)
//   --import-dev         first import through the dev server's /__dev_install endpoint (dev server with
//                        --dev-install only); screenshots then show original artwork, so keep them out of Git
//
//   --dev-install <dir>  spawn a dev server (instead of dist) exposing a private installation
//   --dev-build <dir>    ... and a private build of the recompiled program (runtime/wasm.mk output)
//   --play               with both of the above: start the original program in the port shell, skip the
//                        intro with Escape and open the New Game screen with the mouse; screenshots then
//                        show original artwork, so keep them out of Git
//
// The run uses a throw-away browser profile. It first checks the port shell (index.html), then exercises
// the superseded first-run prototype (prototype.html). Without --import-dev the prototype never sees an
// imported installation and exercises its built-in (procedural) presentation path only.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};

function canonicalPort() {
  try {
    return Number(execFileSync("csjs-dev-port", ["get", "hippogriff-classics-moo2", "web"], { encoding: "utf8" }).trim()) || 3180;
  } catch {
    return 3180;
  }
}

function findChrome() {
  const explicit = opt("chrome", process.env.CHROME_PATH);
  if (explicit) return explicit;
  const cache = join(homedir(), ".cache", "ms-playwright");
  if (existsSync(cache)) {
    for (const d of readdirSync(cache).sort().reverse()) {
      for (const rel of ["chrome-linux64/chrome", "chrome-linux/chrome", "chrome-headless-shell-linux64/chrome-headless-shell"]) {
        const p = join(cache, d, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  for (const p of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]) if (existsSync(p)) return p;
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return r;
    } catch {}
    await sleep(150);
  }
  throw new Error(`timeout waiting for ${url}`);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      } else if (m.method) for (const h of this.handlers) h(m);
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", rej, { once: true });
    });
    return new Cdp(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  on(fn) {
    this.handlers.push(fn);
  }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
}

// helpers injected into the page
const PAGE_HELPERS = `
window.__smoke = {
  q: (id) => document.querySelector('[data-testid="' + id + '"]'),
  async wait(fn, ms = 8000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 50)); }
    throw new Error('wait timeout: ' + fn.toString());
  },
  async click(id, ms) {
    const el = await this.wait(() => { const e = this.q(id); return e && !e.disabled ? e : null; }, ms);
    el.click();
    await new Promise(r => setTimeout(r, 30));
    return true;
  },
  screen: () => document.getElementById('app').dataset.screen,
  // dismiss start-of-turn / report modals, resolving any battles automatically
  async drain(maxSteps = 40) {
    for (let i = 0; i < maxSteps; i++) {
      await new Promise(r => setTimeout(r, 40));
      const m = document.querySelector('.modal-backdrop:last-of-type');
      if (!m) return i;
      const auto = m.querySelector('[data-testid="battle-auto-all"]');
      if (auto) { auto.click(); continue; }
      const btns = [...m.querySelectorAll('.modal-actions button')];
      const pick = btns.find(b => b.classList.contains('primary')) || btns[btns.length - 1];
      if (!pick) throw new Error('modal without actions');
      pick.click();
    }
    throw new Error('modals did not settle');
  },
};
true;
`;

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.log("SMOKE=BLOCKED reason=no-chromium");
    process.exit(3);
  }
  let url = opt("url", null);
  let server = null;
  const devInstall = opt("dev-install", null);
  const devBuild = opt("dev-build", null);
  const play = args.includes("--play");
  if (play && !(devInstall && devBuild)) {
    console.log("SMOKE=BLOCKED reason=--play-needs-dev-install-and-dev-build");
    process.exit(3);
  }
  if (!url) {
    const port = Number(opt("port", canonicalPort()));
    let serveArgs = ["--mode", "dist"];
    if (devInstall || devBuild) {
      serveArgs = ["--mode", "dev"];
      if (devInstall) serveArgs.push("--dev-install", devInstall);
      if (devBuild) serveArgs.push("--dev-build", devBuild);
    } else if (!existsSync(join(ROOT, "dist", "index.html"))) execFileSync(process.execPath, [join(ROOT, "tools", "build.mjs")], { stdio: "inherit" });
    server = spawn(process.execPath, [join(ROOT, "tools", "serve.mjs"), ...serveArgs, "--host", "127.0.0.1", "--port", String(port)], { stdio: ["ignore", "pipe", "inherit"] });
    url = `http://127.0.0.1:${port}/`;
  }
  await waitHttp(url, 10000);
  const debugPort = Number(opt("debug-port", 3189));
  const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "hippogriff-smoke-"));
  const browser = spawn(chrome, [
    "--headless=new",
    `--remote-debugging-port=${debugPort}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-extensions",
    "--window-size=1440,900",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let browserErr = "";
  browser.stderr.on("data", (d) => (browserErr += d));
  const shotsDir = opt("screenshots", null);
  if (shotsDir) mkdirSync(shotsDir, { recursive: true });
  const errors = [];
  const steps = [];
  const step = (name, detail = "") => {
    steps.push(name);
    console.log(`STEP ${name}${detail ? ` ${detail}` : ""}`);
  };
  let cdp;
  try {
    const ver = await (await waitHttp(`http://127.0.0.1:${debugPort}/json/version`, 15000)).json();
    void ver;
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const page = targets.find((t) => t.type === "page");
    cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    cdp.on((m) => {
      if (m.method === "Runtime.exceptionThrown") errors.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
      if (m.method === "Log.entryAdded" && m.params.entry.level === "error" && !/favicon/.test(m.params.entry.url ?? "")) errors.push(`log: ${m.params.entry.text} ${m.params.entry.url ?? ""}`);
    });
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const shot = async (name) => {
      if (!shotsDir) return;
      const r = await cdp.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(r.data, "base64"));
    };
    const ev = (expr) => cdp.eval(`(async () => { ${expr} })()`);
    const waitReady = async () => {
      const until = Date.now() + 15000;
      while (Date.now() < until) {
        if (await cdp.eval(`document.getElementById('app')?.dataset.ready === '1'`).catch(() => false)) return;
        await sleep(100);
      }
      throw new Error("page did not become ready");
    };

    // ---- port shell: the original program recompiled to WebAssembly
    await cdp.send("Page.navigate", { url });
    await waitReady();
    const shell = await ev(`const q = (id) => document.querySelector('[data-testid="' + id + '"]');
      return { isolated: crossOriginIsolated, game: q('port-game-status').textContent, build: q('port-build-status').textContent, canStart: !q('port-start').disabled };`);
    if (!shell.isolated) throw new Error("port shell is not cross-origin isolated");
    step("port-shell", JSON.stringify(shell).slice(0, 240));
    await shot("00-port-shell");
    if (play) {
      if (!shell.canStart) throw new Error(`port cannot start: ${shell.game} / ${shell.build}`);
      await ev(`document.querySelector('[data-testid="port-start"]').click(); return true;`);
      const status = () => ev(`return window.__moo2`);
      const waitGuest = async (ms, limit = 120000) => {
        const until = Date.now() + limit;
        for (;;) {
          const st = await status();
          if (st.state === "error" || st.state === "exited") throw new Error(`game stopped (${st.state}): ${document_status(st)}`);
          if (st.guestMs >= ms) return st;
          if (Date.now() > until) throw new Error(`guest time stuck at ${st.guestMs} ms`);
          await sleep(200);
        }
      };
      const document_status = (st) => JSON.stringify({ ...st, log: st.log.slice(-5) });
      const st0 = await waitGuest(3000);
      step("port-running", `frames=${st0.frames} video=${st0.width}x${st0.height}`);
      await shot("01-port-logo");
      // the canvas has focus; Escape skips each part of the intro, as in DOS
      for (let i = 0; i < 5; i++) {
        await waitGuest(9000 + i * 3000);
        await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", code: "Escape", key: "Escape", windowsVirtualKeyCode: 27 });
        await sleep(60);
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", code: "Escape", key: "Escape", windowsVirtualKeyCode: 27 });
      }
      await waitGuest(25000);
      await shot("02-port-main-menu");
      step("port-main-menu");
      // the New Game entry of the main menu, in guest screen coordinates (640x480)
      const pt = await ev(`const r = document.querySelector('[data-testid="port-canvas"]').getBoundingClientRect();
        return { x: r.left + r.width * 490 / 640, y: r.top + r.height * 228 / 480 };`);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x - 10, y: pt.y - 8 });
      await sleep(300);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y });
      await sleep(300);
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", buttons: 1, clickCount: 1 });
      await sleep(200);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", buttons: 0, clickCount: 1 });
      const st1 = await waitGuest((await status()).guestMs + 4000);
      await shot("03-port-new-game");
      const lit = await ev(`const c = document.querySelector('[data-testid="port-canvas"]'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0; for (let i = 0; i < d.length; i += 64) if (d[i] + d[i+1] + d[i+2] > 60) n++; return n;`);
      if (!(lit > 200)) throw new Error(`port canvas looks blank (${lit} lit samples)`);
      step("port-new-game", `guestMs=${Math.round(st1.guestMs)} frames=${st1.frames} litSamples=${lit}`);
    }

    // ---- first-run prototype (superseded; kept as scaffolding)
    await cdp.send("Page.navigate", { url: new URL("prototype.html", url).href });
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      if (await cdp.eval(`document.getElementById('app')?.dataset.ready === '1'`).catch(() => false)) break;
      await sleep(100);
    }
    await cdp.eval(PAGE_HELPERS);
    const S = "window.__smoke";
    step("boot", await ev(`return ${S}.screen()`));
    const status = await ev(`return ${S}.q('asset-status')?.textContent`);
    step("menu", JSON.stringify(status));
    await shot("01-menu");

    await ev(`await ${S}.click('menu-about'); await ${S}.wait(() => ${S}.screen() === 'about'); document.querySelector('.screen button').click(); return true;`);
    step("about");

    if (args.includes("--import-dev")) {
      // requires a dev server started with --dev-install <dir>; imports through the real in-browser pipeline
      await ev(`await ${S}.click('menu-import'); const b = await ${S}.wait(() => { const x = ${S}.q('import-dev'); return x && !x.hidden ? x : null; }); b.click();
        try { await ${S}.wait(() => /Imported|failed|Missing/.test(${S}.q('import-log').textContent), 60000); } catch { throw new Error('import stalled: ' + ${S}.q('import-log').textContent + ' / ' + (document.querySelector('.import-log progress')?.title ?? '')); } return true;`);
      const log = await ev(`return ${S}.q('import-log').textContent`);
      if (!/Imported/.test(log)) throw new Error(`dev import failed: ${log}`);
      await shot("00-import");
      await ev(`[...document.querySelectorAll('.screen button')].find(x => x.textContent === 'Back').click(); await ${S}.wait(() => ${S}.screen() === 'menu'); return true;`);
      const st = await ev(`return ${S}.q('asset-status').textContent`);
      if (!/imported/i.test(st)) throw new Error(`assets not active after import: ${st}`);
      step("import-dev", JSON.stringify(log.replace(/\s+/g, " ").slice(0, 160)));
    }

    await ev(`await ${S}.click('menu-new'); await ${S}.wait(() => ${S}.screen() === 'newgame'); return true;`);
    await ev(`await ${S}.click('race-psilon'); const s = ${S}.q('seed'); s.value = '424242'; return true;`);
    await shot("02-newgame");
    await ev(`await ${S}.click('start-game'); await ${S}.wait(() => ${S}.screen() === 'galaxy'); await ${S}.drain(); return true;`);
    const mapPixels = await ev(`
      const c = ${S}.q('galaxy-canvas'); await ${S}.wait(() => c.width > 100);
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let lit = 0;
      for (let i = 0; i < d.length; i += 16) if (d[i] + d[i+1] + d[i+2] > 120) lit++;
      return lit;`);
    if (!(mapPixels > 50)) throw new Error(`galaxy map looks blank (${mapPixels} lit samples)`);
    step("galaxy", `litSamples=${mapPixels}`);
    await shot("03-galaxy");

    // visit every in-game screen
    for (const sc of ["colonies", "research", "design", "fleets", "races", "info"]) {
      await ev(`await ${S}.click('nav-${sc}'); await ${S}.wait(() => ${S}.screen() === '${sc}'); return true;`);
      if (sc === "research") {
        await ev(`const b = await ${S}.wait(() => document.querySelector('button.app-choice')); b.click(); await ${S}.wait(() => document.querySelector('button.app-choice.active')); return true;`);
      }
      if (sc === "design") {
        await ev(`await ${S}.click('design-save'); await ${S}.wait(() => document.querySelectorAll('.screen table.grid tr').length > 7); return true;`);
      }
      if (sc === "colonies") {
        await ev(`const row = await ${S}.wait(() => document.querySelector('[data-testid^="colony-row-"]')); row.click(); await ${S}.wait(() => ${S}.screen() === 'colony');
          await ${S}.click('job-workers-plus'); return true;`);
        await shot("04-colony");
      }
      step(`screen-${sc}`);
    }
    await shot("05-info");

    // play turns
    await ev(`await ${S}.click('nav-galaxy'); return true;`);
    const t0 = await ev(`return window.hippogriff.game.turn`);
    for (let i = 0; i < 6; i++) {
      await ev(`await ${S}.click('end-turn'); await new Promise(r => setTimeout(r, 60)); await ${S}.drain(); return true;`);
    }
    const t1 = await ev(`return window.hippogriff.game.turn`);
    if (t1 <= t0) throw new Error(`turn did not advance (${t0} -> ${t1})`);
    step("turns", `${t0}->${t1}`);

    // stage a tactical battle: move an armed fleet onto a monster lair, then command it
    const staged = await ev(`
      const app = window.hippogriff; const s = app.game; const me = app.me.id;
      const armed = Object.values(s.fleets).find(f => f.owner === me && f.starId !== null && f.ships.some(sh => s.designs[sh.designId].weapons.length));
      const lair = Object.values(s.fleets).find(f => f.owner === -1 && f.starId !== null && s.stars[f.starId].special !== 'orion');
      if (!armed || !lair) return 'none';
      const st = s.stars[lair.starId]; armed.starId = st.id; armed.x = st.x; armed.y = st.y; armed.destStarId = null; armed.originStarId = st.id;
      app.render(); return st.name;`);
    if (staged !== "none") {
      // the "no research project" confirmation may come first; accept it and wait for the battle list
      await ev(`await ${S}.click('end-turn');
        await ${S}.wait(() => { if (${S}.q('battles-modal')) return true; const p = document.querySelector('.modal-backdrop .modal-actions button.primary'); if (p) p.click(); return false; });
        await ${S}.click('battle-command'); await ${S}.wait(() => ${S}.screen() === 'combat'); return true;`);
      await shot("06-combat");
      const status2 = await ev(`return ${S}.q('battle-status').textContent`);
      await ev(`if (${S}.q('battle-autoresolve')) await ${S}.click('battle-autoresolve'); await ${S}.click('battle-continue'); await ${S}.drain(); await ${S}.wait(() => ${S}.screen() === 'galaxy'); return true;`);
      step("combat", JSON.stringify({ at: staged, status: status2 }));
    } else step("combat", "skipped: no monster lair");

    // save and reload
    const turnBeforeSave = await ev(`return window.hippogriff.game.turn`);
    await ev(`await ${S}.click('nav-game'); const b = [...document.querySelectorAll('.modal-actions button')].find(x => x.textContent.includes('Save')); b.click();
      await ${S}.wait(() => ${S}.screen() === 'saves'); await ${S}.click('save-slot1'); await ${S}.wait(() => ${S}.q('load-slot1')); return true;`);
    await ev(`await ${S}.click('load-slot1'); await ${S}.wait(() => ${S}.screen() === 'galaxy'); await ${S}.drain(); return true;`);
    const turnAfterLoad = await ev(`return window.hippogriff.game.turn`);
    if (turnAfterLoad !== turnBeforeSave) throw new Error(`save/load turn mismatch ${turnBeforeSave} vs ${turnAfterLoad}`);
    step("save-load", `turn=${turnAfterLoad}`);

    // main menu and continue from autosave
    await ev(`await ${S}.click('nav-game'); const b = [...document.querySelectorAll('.modal-actions button')].find(x => x.textContent.includes('Main Menu')); b.click();
      await ${S}.wait(() => ${S}.screen() === 'menu'); await ${S}.click('menu-continue'); await ${S}.wait(() => ${S}.screen() === 'galaxy' || ${S}.screen() === 'gameover'); await ${S}.drain(); return true;`);
    step("continue");

    await ev(`await ${S}.click('nav-game'); [...document.querySelectorAll('.modal-actions button')].find(x => x.textContent.includes('Main Menu')).click(); await ${S}.click('menu-import'); await ${S}.wait(() => ${S}.q('import-pick')); return true;`);
    step("import-screen");
    await shot("07-import");
  } catch (err) {
    errors.push(`step failed after [${steps.join(", ")}]: ${err.message}`);
  } finally {
    try {
      cdp?.ws.close();
    } catch {}
    browser.kill("SIGKILL");
    server?.kill("SIGTERM");
    await sleep(200);
    rmSync(profile, { recursive: true, force: true });
  }
  if (errors.length) {
    for (const e of errors) console.error(`SMOKE_ERROR ${e}`);
    if (browserErr && !steps.length) console.error(browserErr.slice(-2000));
    console.log(`SMOKE=FAIL steps=${steps.length}`);
    process.exit(1);
  }
  console.log(`SMOKE=PASS steps=${steps.length} url=${url}`);
}

await main();
