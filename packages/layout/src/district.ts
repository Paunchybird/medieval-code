import path from "node:path";
import type {
  Construct,
  District,
  FileEdge,
  ImportEdge,
  Neighborhood,
  ParsedConstruct,
  ParsedFile,
  Rect,
  RoadSegment,
  ScanCaps,
  TownMeta,
  TownModel,
} from "@medieval-code/model";
import { DEFAULT_CAPS } from "@medieval-code/model";
import { layoutNeighborhoods, ROAD_HEIGHT } from "./row.js";
import { districtRoad, streetBetweenRows, unionBounds } from "./roads.js";
import { resolveImportTarget, type ImportAlias } from "./resolve.js";

function toConstruct(c: ParsedConstruct): Construct {
  return { ...c, sprite: { x: 0, y: 0, w: 0, h: 0 }, children: c.children?.map(toConstruct) };
}

const PALETTE: Record<string, string> = {
  typescript: "#5b7a9d",
  javascript: "#c49a3c",
  python: "#4a7c59",
  test: "#8b7aa8",
  config: "#6b6b6b",
};

const T = 16; // layout px per tile
/** Breathing room between the district wall and the buildings, every side. */
const DISTRICT_PAD = 4 * T;
/** Extra space inside the north wall: the district banner floats there. */
const BANNER_PAD = 3 * T;
/** Gap between neighbouring districts of one row. */
export const DISTRICT_GAP_X = 6 * T;
/**
 * Gap between district rows. Every row's gates open south onto an avenue
 * that runs through this gap, so it must hold the gate apron, the road and
 * its lamps without touching the next row's north wall.
 */
export const DISTRICT_GAP_Z = 10 * T;
/** Target width / height of the whole town (screens are wider than tall). */
const TOWN_ASPECT = 1.5;

export function districtKey(relPath: string): string {
  const dir = path.posix.dirname(relPath);
  if (dir === ".") return "root";
  const parts = dir.split("/");
  return parts.length <= 1 ? parts[0] : parts.slice(0, 2).join("/");
}

function buildDistricts(parsed: ParsedFile[]): Map<string, ParsedFile[]> {
  const map = new Map<string, ParsedFile[]>();
  for (const f of parsed) {
    const key = districtKey(f.relPath);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(f);
  }
  return map;
}

function dominantLanguage(files: ParsedFile[]): string {
  const counts = new Map<string, number>();
  for (const f of files) {
    counts.set(f.language, (counts.get(f.language) ?? 0) + 1);
  }
  let best = "javascript";
  let max = 0;
  for (const [lang, n] of counts) {
    if (n > max) { max = n; best = lang; }
  }
  return best;
}

export interface LayoutOptions {
  root: string;
  theme?: TownMeta["theme"];
  caps?: Partial<ScanCaps>;
  truncated?: boolean;
  totalFound?: number;
  /** tsconfig paths and workspace packages, for non-relative imports */
  aliases?: ImportAlias[];
}

interface Measured {
  key: string;
  files: ParsedFile[];
  totalLoc: number;
  neighborhoods: Neighborhood[];
  /** size of the district including its walls, in layout px */
  w: number;
  h: number;
}

/** Lays one district's files out at the origin and measures its walls. */
function measureDistrict(key: string, files: ParsedFile[], maxRowWidth: number): Measured {
  const neighborhoods: Omit<Neighborhood, "row">[] = files.map((f) => ({
    file: f.relPath,
    absPath: f.absPath,
    language: f.language,
    isTest: f.isTest,
    isConfig: f.isConfig,
    constructs: f.constructs.map(toConstruct),
  }));
  const laid = layoutNeighborhoods(neighborhoods, DISTRICT_PAD, BANNER_PAD, maxRowWidth);
  const inner = unionBounds(laid.map((n) => n.row));
  return {
    key,
    files,
    totalLoc: files.reduce((s, f) => s + f.constructs.reduce((cs, c) => cs + c.metrics.loc, 0), 0),
    neighborhoods: laid,
    // walls sit an even DISTRICT_PAD from the buildings on every side
    w: inner.x + inner.w + DISTRICT_PAD,
    h: inner.y + inner.h + DISTRICT_PAD,
  };
}

function shiftNeighborhood(n: Neighborhood, dx: number, dy: number): Neighborhood {
  const shift = (c: Construct): Construct => ({ ...c, sprite: { ...c.sprite, x: c.sprite.x + dx, y: c.sprite.y + dy } });
  return {
    ...n,
    row: { ...n.row, x: n.row.x + dx, y: n.row.y + dy },
    // only top-level sprites carry positions; courtyard children are laid out by the viewer
    constructs: n.constructs.map(shift),
  };
}

/**
 * Packs districts into rows (biggest first), each row centred on the town's
 * north-south axis and bottom-aligned so every gate opens onto the same
 * avenue. The row width target keeps the town roughly TOWN_ASPECT wide.
 */
export function packDistricts(sizes: { w: number; h: number }[]): { x: number; y: number; row: number }[] {
  if (sizes.length === 0) return [];
  const area = sizes.reduce((a, s) => a + (s.w + DISTRICT_GAP_X) * (s.h + DISTRICT_GAP_Z), 0);
  const widest = Math.max(...sizes.map((s) => s.w));
  const targetW = Math.max(widest, Math.sqrt(area * TOWN_ASPECT));

  const rows: number[][] = [];
  let cur: number[] = [];
  let curW = 0;
  sizes.forEach((s, i) => {
    const add = (cur.length ? DISTRICT_GAP_X : 0) + s.w;
    if (cur.length && curW + add > targetW * 1.08) {
      rows.push(cur);
      cur = [];
      curW = 0;
    }
    curW += (cur.length ? DISTRICT_GAP_X : 0) + s.w;
    cur.push(i);
  });
  if (cur.length) rows.push(cur);

  const rowWidths = rows.map((r) => r.reduce((a, i) => a + sizes[i].w, 0) + DISTRICT_GAP_X * (r.length - 1));
  const townW = Math.max(...rowWidths);
  const out: { x: number; y: number; row: number }[] = new Array(sizes.length);
  let y = 0;
  rows.forEach((r, ri) => {
    const rowH = Math.max(...r.map((i) => sizes[i].h));
    // snap to the tile grid so walls, paths and gates line up in the viewer
    let x = Math.round((townW - rowWidths[ri]) / 2 / T) * T;
    for (const i of r) {
      out[i] = { x, y: y + rowH - sizes[i].h, row: ri };
      x += sizes[i].w + DISTRICT_GAP_X;
    }
    y += rowH + DISTRICT_GAP_Z;
  });
  return out;
}

export function buildTownModel(
  parsed: ParsedFile[],
  options: LayoutOptions,
): TownModel {
  const caps = { ...DEFAULT_CAPS, ...options.caps };
  const districtMap = buildDistricts(parsed);
  const roads: RoadSegment[] = [];

  const measured = [...districtMap.entries()]
    .map(([key, files]) => measureDistrict(key, files, caps.maxRowWidth))
    // the biggest district is the old town at the top; ties broken by name
    // so the layout is stable across scans
    .sort((a, b) => b.totalLoc - a.totalLoc || a.key.localeCompare(b.key));

  const placed = packDistricts(measured.map((m) => ({ w: m.w, h: m.h })));
  const districts: District[] = measured.map((m, i) => {
    const p = placed[i];
    const neighborhoods = m.neighborhoods.map((n) => shiftNeighborhood(n, p.x, p.y));
    return {
      id: m.key,
      path: m.key,
      language: dominantLanguage(m.files),
      bounds: { x: p.x, y: p.y, w: m.w, h: m.h },
      neighborhoods,
      totalLoc: m.totalLoc,
    };
  });

  // streets between file blocks (informational; the viewer draws its own network)
  for (const d of districts) {
    for (const n of d.neighborhoods) {
      roads.push(streetBetweenRows(n.row.x, n.row.y + n.row.h + ROAD_HEIGHT / 2, n.row.w));
    }
  }
  // one avenue under every row of districts, spanning the row
  const rowsByY = new Map<number, Rect[]>();
  districts.forEach((d, i) => {
    const r = placed[i].row;
    if (!rowsByY.has(r)) rowsByY.set(r, []);
    rowsByY.get(r)!.push(d.bounds);
  });
  for (const rects of rowsByY.values()) {
    const b = unionBounds(rects);
    const z = b.y + b.h + DISTRICT_GAP_Z / 2;
    roads.push(districtRoad(b.x, z, b.x + b.w, z));
  }

  // ---- imports: resolve to files, then aggregate per district ----
  const known = new Set(parsed.map((f) => f.relPath));
  const fileEdgeSet = new Set<string>();
  const fileEdges: FileEdge[] = [];
  for (const f of parsed) {
    for (const spec of f.imports) {
      const to = resolveImportTarget(f.relPath, spec, f.language, known, options.aliases);
      if (!to || to === f.relPath) continue;
      const k = f.relPath + "\u0000" + to;
      if (fileEdgeSet.has(k)) continue;
      fileEdgeSet.add(k);
      fileEdges.push({ from: f.relPath, to });
    }
  }
  const edgeMap = new Map<string, ImportEdge>();
  for (const e of fileEdges) {
    const from = districtKey(e.from);
    const to = districtKey(e.to);
    if (from === to) continue;
    const k = `${from}->${to}`;
    const existing = edgeMap.get(k);
    if (existing) existing.weight++;
    else edgeMap.set(k, { from, to, weight: 1, external: false });
  }
  const edges = [...edgeMap.values()].sort((a, b) => b.weight - a.weight || a.from.localeCompare(b.from)).slice(0, 80);

  const allBounds = unionBounds(districts.map((d) => d.bounds));

  return {
    meta: {
      root: options.root,
      generatedAt: new Date().toISOString(),
      fileCount: options.totalFound ?? parsed.length,
      parsedFiles: parsed.length,
      truncated: options.truncated ?? false,
      theme: options.theme ?? "day",
    },
    districts,
    edges,
    fileEdges,
    roads,
    palette: PALETTE,
    bounds: { ...allBounds, h: allBounds.h + DISTRICT_GAP_Z },
  };
}
