export type ConstructType =
  | "castle"
  | "house"
  | "factory"
  | "church"
  | "cathedral"
  | "tower"
  | "shop"
  | "bridge"
  | "flag"
  | "decor"
  | "tenement"
  | "townhall"
  | "training";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Span {
  startLine: number;
  endLine: number;
}

export interface ConstructMetrics {
  loc: number;
  complexity?: number;
  depth?: number;
  branches?: number;
  params?: number;
  members?: number;
  cases?: number;
}

export interface Construct {
  type: ConstructType;
  name: string;
  file: string;
  span: Span;
  metrics: ConstructMetrics;
  sprite: Rect;
  /**
   * Constructs nested inside this one (e.g. loops inside a function).
   * Rendered as buildings inside a walled courtyard; rings of walls show
   * nesting depth. Children carry no sprite position of their own — the
   * viewer lays them out inside the compound.
   */
  children?: Construct[];
}

export interface Neighborhood {
  file: string;
  absPath: string;
  language: string;
  isTest: boolean;
  isConfig: boolean;
  constructs: Construct[];
  row: Rect;
}

export interface District {
  id: string;
  path: string;
  language: string;
  bounds: Rect;
  neighborhoods: Neighborhood[];
  totalLoc: number;
}

export interface ImportEdge {
  from: string;
  to: string;
  weight: number;
  external: boolean;
}

/** A resolved import between two source files of the scanned repo. */
export interface FileEdge {
  /** importing file (repo-relative path) */
  from: string;
  /** imported file (repo-relative path) */
  to: string;
}

export interface RoadSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: "street" | "bridge" | "district";
}

export interface TownMeta {
  root: string;
  generatedAt: string;
  fileCount: number;
  parsedFiles: number;
  truncated: boolean;
  /** generated or minified files the walker left out */
  skippedFiles?: number;
  theme: "dawn" | "day" | "dusk" | "night";
}

export interface TownModel {
  meta: TownMeta;
  districts: District[];
  /** district-level import edges (weight = number of file imports) */
  edges: ImportEdge[];
  /** file-level import edges, resolved inside the repo (optional: older town.json files lack it) */
  fileEdges?: FileEdge[];
  roads: RoadSegment[];
  palette: Record<string, string>;
  bounds: Rect;
}

export interface ScanCaps {
  maxFiles: number;
  maxConstructsPerFile: number;
  maxRowWidth: number;
}

export const DEFAULT_CAPS: ScanCaps = {
  maxFiles: 500,
  maxConstructsPerFile: 80,
  maxRowWidth: 512,
};

/** A construct as produced by the parser — no sprite geometry yet. */
export interface ParsedConstruct extends Omit<Construct, "sprite" | "children"> {
  children?: ParsedConstruct[];
}

export interface ParsedFile {
  absPath: string;
  relPath: string;
  language: string;
  isTest: boolean;
  isConfig: boolean;
  constructs: ParsedConstruct[];
  imports: string[];
}
