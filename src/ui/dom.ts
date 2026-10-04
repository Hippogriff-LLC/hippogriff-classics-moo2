// Tiny DOM helpers (no framework).

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = String(v);
      else if (k === "style") el.setAttribute("style", String(v));
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === "value" && "value" in el) (el as HTMLInputElement).value = String(v);
      else if (k === "checked" && "checked" in el) (el as HTMLInputElement).checked = Boolean(v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: HTMLElement, children: (Child | Child[])[]): void {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
}

export function button(label: Child, onClick: () => void, opts: { cls?: string; disabled?: boolean; title?: string; testid?: string } = {}): HTMLButtonElement {
  return h("button", { class: opts.cls ?? "", disabled: opts.disabled, title: opts.title, "data-testid": opts.testid, onclick: (ev: Event) => { ev.stopPropagation(); onClick(); } }, label);
}

export function select<T extends string | number>(value: T, options: [T, string][], onChange: (v: T) => void, attrs: Attrs = {}): HTMLSelectElement {
  const el = h("select", attrs, ...options.map(([v, label]) => h("option", { value: String(v), selected: v === value }, label)));
  el.addEventListener("change", () => {
    const opt = options.find(([v]) => String(v) === el.value);
    if (opt) onChange(opt[0]);
  });
  return el;
}

export function fmt(n: number, digits = 0): string {
  return n.toFixed(digits).replace(/\.0+$/, "");
}

export function signed(n: number, digits = 0): string {
  return (n >= 0 ? "+" : "") + fmt(n, digits);
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}
