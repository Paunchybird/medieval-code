import { HEAT_COLORS, HEAT_LABELS, heatBucket, openInEditor, typeColor, typeMeaning, type HitTarget } from "../interaction.js";
import type { FocusInfo } from "../scene/routes.js";
import { IN_COLOR, OUT_COLOR } from "../scene/routes.js";
import type { TownScene } from "../scene/town-scene.js";
import { el, listRow, note } from "./dom.js";
import { rankHotspots, rankSearch } from "./rank.js";

const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");
const base = (file: string) => file.split("/").pop() ?? file;

export function renderStats(s: TownScene["stats"]) {
  const items = [
    { value: s.files, label: "Files" },
    { value: s.districts, label: "Districts" },
    { value: s.buildings, label: "Buildings" },
    { value: s.routes, label: "Import routes" },
  ];
  el("stats").innerHTML = items
    .map((i) => `<div class="stat-card"><div class="value">${i.value}</div><div class="label">${i.label}</div></div>`)
    .join("");
}

/** A row of swatch buttons where one is active (time of day, view mode). */
export function renderChoice<T extends string>(
  wrapId: string,
  options: { id: T; label: string; sw: string }[],
  active: T,
  onPick: (id: T) => void,
) {
  const wrap = el(wrapId);
  wrap.innerHTML = "";
  for (const o of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-btn" + (o.id === active ? " active" : "");
    btn.innerHTML = `<span class="sw" style="background:${o.sw}"></span><span>${o.label}</span>`;
    btn.onclick = () => onPick(o.id);
    wrap.appendChild(btn);
  }
}

export function renderHeatScale(visible: boolean) {
  const scale = el("heat-scale");
  scale.innerHTML = HEAT_LABELS
    .map((l, i) => `<span class="heat-step"><span class="swatch" style="background:${HEAT_COLORS[i]}"></span>${l}</span>`)
    .join("");
  scale.hidden = !visible;
}

function hitRow(h: HitTarget, swatch: string, meta: string, onSelect: (h: HitTarget) => void) {
  return listRow("result", swatch, h.construct.name, meta, `${h.construct.file}:${h.construct.span.startLine}`, () => onSelect(h));
}

export function renderHotspots(hits: HitTarget[], onSelect: (h: HitTarget) => void) {
  const list = el("hotspots");
  list.innerHTML = "";
  const hot = rankHotspots(hits);
  if (hot.length === 0) {
    list.appendChild(note("No complex code. A calm kingdom.", "result-empty"));
    return;
  }
  for (const h of hot) {
    const cx = h.construct.metrics.complexity ?? 1;
    list.appendChild(hitRow(h, HEAT_COLORS[heatBucket(cx)], `cx ${cx} · ${h.parent ? h.parent.name : base(h.construct.file)}`, onSelect));
  }
}

/** Fills the search results box; returns every match, best first. */
export function renderSearch(hits: HitTarget[], query: string, onSelect: (h: HitTarget) => void): HitTarget[] {
  const box = el("search-results");
  box.innerHTML = "";
  if (!query.trim()) {
    box.hidden = true;
    return [];
  }
  const found = rankSearch(hits, query);
  box.hidden = false;
  box.appendChild(note(found.length === 0
    ? "No matches"
    : `${found.length} match${found.length === 1 ? "" : "es"}` + (found.length > 1 ? " · Enter jumps to the first" : "")));
  for (const h of found.slice(0, 10)) {
    const where = h.parent ? `in ${h.parent.name}` : `${base(h.construct.file)}:${h.construct.span.startLine}`;
    box.appendChild(hitRow(h, typeColor(h.construct.type), `${typeMeaning(h.construct.type)} · ${where}`, onSelect));
  }
  return found;
}

/** Long route lists are capped; the arcs in the town still show every route. */
const ROUTE_CAP = 10;

/** The selection card: kind, size, complexity, what is inside, import routes. */
export function renderSelection(hit: HitTarget | null, routes: FocusInfo, onFile: (file: string) => void) {
  const panel = el("selection");
  panel.hidden = !hit;
  if (!hit) return;
  const c = hit.construct;
  el("sel-name").textContent = c.name;
  el("sel-type").textContent = typeMeaning(c.type);
  el("sel-meta").textContent =
    `LOC ${c.metrics.loc}` +
    (c.metrics.params != null ? ` · ${c.metrics.params} params` : "") +
    (hit.nested ? ` · contains ${hit.nested} nested` : "");

  // complexity meter, heat-coloured, full at 20
  const cx = c.metrics.complexity ?? 1;
  const bucket = heatBucket(cx);
  el("sel-cx-label").textContent = `Complexity ${cx} · ${HEAT_LABELS[bucket]}`;
  const fill = el("sel-cx-fill");
  fill.style.width = `${Math.min(100, (cx / 20) * 100)}%`;
  fill.style.background = HEAT_COLORS[bucket];

  // what lives inside the courtyard: each row opens its exact line
  const list = el("sel-children");
  list.innerHTML = "";
  el("sel-children-wrap").hidden = hit.children.length === 0;
  for (const kid of hit.children) {
    const k = kid.construct;
    list.appendChild(listRow("child", typeColor(k.type), k.name,
      `${typeMeaning(k.type)} · ${k.metrics.loc} loc · cx ${k.metrics.complexity ?? 1}`,
      `${k.file}:${k.span.startLine}`,
      () => openInEditor(hit.neighborhood.absPath, k.span.startLine)));
  }

  // the file's import routes, drawn as arcs in the town and listed here
  const rList = el("sel-routes");
  rList.innerHTML = "";
  el("sel-routes-wrap").hidden = routes.imports.length + routes.importedBy.length === 0;
  const side = (files: string[], color: number, label: string, moreLabel: string) => {
    for (const f of files.slice(0, ROUTE_CAP)) {
      const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : ".";
      rList.appendChild(listRow("child", hex(color), base(f), `${label} · ${dir}`, `${label} ${f}`, () => onFile(f)));
    }
    if (files.length > ROUTE_CAP) rList.appendChild(note(`+${files.length - ROUTE_CAP} more ${moreLabel} (all drawn as arcs)`));
  };
  side(routes.imports, OUT_COLOR, "imports", "imports");
  side(routes.importedBy, IN_COLOR, "used by", "files using it");

  el("sel-path").textContent = `${c.file}:${c.span.startLine}`;
  el("sel-district").textContent = hit.district.path;
  el<HTMLButtonElement>("open-source").onclick = () => openInEditor(hit.neighborhood.absPath, c.span.startLine);
}
