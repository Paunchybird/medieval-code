export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/** A swatch + name + meta row, the building block of every sidebar list. */
export function listRow(cls: "result" | "child", swatch: string, name: string, meta: string, title: string, onClick: () => void): HTMLButtonElement {
  const row = document.createElement("button");
  row.type = "button";
  row.className = `${cls}-row`;
  row.title = title;
  const sw = document.createElement("span");
  sw.className = "swatch";
  sw.style.background = swatch;
  const n = document.createElement("span");
  n.className = `${cls}-name`;
  n.textContent = name;
  const m = document.createElement("span");
  m.className = `${cls}-meta`;
  m.textContent = meta;
  row.append(sw, n, m);
  row.onclick = onClick;
  return row;
}

export function note(text: string, cls = "result-count"): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = text;
  return d;
}
