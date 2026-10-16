import type { Construct, District, TownModel } from "@medieval-code/model";

export interface HitTarget {
  construct: Construct;
  neighborhood: { file: string; absPath: string; language: string; isTest: boolean; isConfig: boolean };
  district: District;
  /** world-space footprint center (voxel units) — marker + camera focus */
  center: { x: number; z: number };
  /** world-space height of the building's tallest voxel */
  top: number;
  /** number of constructs nested inside (courtyard buildings) */
  nested: number;
  /** the construct whose courtyard this building stands in (undefined at street level) */
  parent?: Construct;
  /** first-level constructs inside the courtyard, with world label anchors */
  children: { construct: Construct; anchor: { x: number; y: number; z: number } }[];
}

export interface FilterState {
  search: string;
  languages: Set<string>;
  types: Set<string>;
  districts: Set<string>;
}

function collectTypes(constructs: Construct[], types: Set<string>) {
  for (const c of constructs) {
    types.add(c.type);
    if (c.children) collectTypes(c.children, types);
  }
}

export function defaultFilters(model: TownModel): FilterState {
  const languages = new Set<string>();
  const types = new Set<string>();
  const districts = new Set<string>();

  for (const d of model.districts) {
    districts.add(d.id);
    languages.add(d.language);
    for (const n of d.neighborhoods) {
      languages.add(n.language);
      // include nested constructs — a type that only appears inside a
      // courtyard must still pass the default filter, or it renders ghosted
      collectTypes(n.constructs, types);
    }
  }

  return { search: "", languages, types, districts };
}

export function matchesFilter(
  c: Construct,
  n: { language: string },
  d: District,
  f: FilterState,
): boolean {
  if (!f.districts.has(d.id)) return false;
  if (!f.languages.has(n.language)) return false;
  if (!f.types.has(c.type)) return false;
  if (f.search) {
    const q = f.search.toLowerCase();
    if (!c.name.toLowerCase().includes(q) && !c.file.toLowerCase().includes(q)) return false;
  }
  return true;
}

export function openInEditor(absPath: string, line: number) {
  const uri = `vscode://file/${absPath}:${line}`;
  window.open(uri, "_blank");
  navigator.clipboard?.writeText(`${absPath}:${line}`).catch(() => {});
}

/** Swatch color for a construct type (legend + selection contents list). */
export function typeColor(type: string): string {
  const row = LEGEND.find(([t]) => t === type);
  return row ? row[1] : "#8f8a80";
}

/** Code-speak for a construct type: house → "function", castle → "class / enum" … */
export function typeMeaning(type: string): string {
  const row = LEGEND.find(([t]) => t === type);
  return row ? row[3] : type;
}

/**
 * Complexity heat bucket: 0 = calm … 4 = burning. Thresholds tuned so a
 * straight-line function is calm and anything past ~15 decision points howls.
 */
export function heatBucket(complexity: number): number {
  if (complexity <= 2) return 0;
  if (complexity <= 5) return 1;
  if (complexity <= 9) return 2;
  if (complexity <= 15) return 3;
  return 4;
}

export const HEAT_LABELS = ["calm", "mild", "warm", "hot", "burning"];
export const HEAT_COLORS = ["#63a852", "#c9c94e", "#e0a13c", "#d96a35", "#c73b2d"];

/** type · swatch color · building name · code meaning */
export const LEGEND: [string, string, string, string][] = [
  ["castle", "#9c9a90", "Castle", "class / enum"],
  ["house", "#f1e2bd", "House", "function"],
  ["factory", "#8a5548", "Workshop", "loop"],
  ["church", "#c9b78a", "Church", "if / else"],
  ["cathedral", "#b9a06b", "Cathedral", "switch"],
  ["tower", "#7e7c72", "Guard tower", "try / catch"],
  ["shop", "#c75146", "Shop", "imports"],
  ["bridge", "#b3b1a6", "Bridge", "interface / type"],
  ["townhall", "#b3702e", "Town hall", "config file"],
  ["training", "#a98fce", "Training ground", "test / describe"],
  ["decor", "#63a852", "Tree / lamp", "const"],
  ["flag", "#d9a441", "Flag", "export"],
  ["tenement", "#8f8a80", "Tenement", "overflow"],
];
