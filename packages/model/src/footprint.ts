import type { ConstructMetrics, ConstructType } from "./schema.js";

/**
 * Voxel footprint of a building, in voxel/tile units (1 tile = 1 voxel = 1
 * world unit). This is the single source of truth shared by the layout
 * package (to reserve ground space) and the viewer (to build the meshes) —
 * if the two disagree, buildings overlap or float in empty plots.
 */
export interface Footprint {
  fw: number;
  fd: number;
}

export interface FootprintInput {
  type: ConstructType;
  metrics: ConstructMetrics;
  children?: FootprintInput[];
}

/** Padding between a courtyard wall and the buildings inside it. */
export const COMPOUND_PAD = 3;
/** Gap between sibling buildings inside a courtyard. */
export const COMPOUND_GAP = 2;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const odd = (n: number) => (n % 2 === 0 ? n + 1 : n);

/**
 * Arranges courtyard children in up to two centered rows (source order,
 * back row first) and returns the courtyard footprint plus each child's
 * position. Layout reserves ground with this and the viewer builds with it —
 * both must agree, so it lives here.
 */
export function layoutCompound(kids: Footprint[]): { fw: number; fd: number; slots: { x: number; z: number }[] } {
  const perRow = kids.length <= 3 ? kids.length : Math.ceil(kids.length / 2);
  const rows: Footprint[][] = [];
  for (let i = 0; i < kids.length; i += perRow) rows.push(kids.slice(i, i + perRow));

  const rowW = rows.map((r) => r.reduce((a, k) => a + k.fw, 0) + COMPOUND_GAP * (r.length - 1));
  const rowD = rows.map((r) => Math.max(...r.map((k) => k.fd)));
  const innerW = Math.max(...rowW);
  const innerD = rowD.reduce((a, d) => a + d, 0) + COMPOUND_GAP * (rows.length - 1);
  const fw = Math.max(innerW + COMPOUND_PAD * 2, 7);
  const fd = innerD + COMPOUND_PAD * 2;

  const slots: { x: number; z: number }[] = [];
  let z = COMPOUND_PAD;
  rows.forEach((row, ri) => {
    let x = Math.floor((fw - rowW[ri]) / 2);
    for (const k of row) {
      // bottom-align within the row so building fronts line up
      slots.push({ x, z: z + rowD[ri] - k.fd });
      x += k.fw + COMPOUND_GAP;
    }
    z += rowD[ri] + COMPOUND_GAP;
  });
  return { fw, fd, slots };
}

export function voxelFootprint(c: FootprintInput): Footprint {
  if (c.children && c.children.length > 0) {
    return layoutCompound(c.children.map(voxelFootprint));
  }
  const m = c.metrics;
  switch (c.type) {
    case "castle":
      return { fw: (m.members ?? 0) > 6 ? 11 : 9, fd: 8 };
    case "house":
      return { fw: odd(clamp(4 + (m.params ?? 0), 5, 7)), fd: 4 + ((m.loc ?? 0) > 60 ? 1 : 0) };
    case "factory":
      return { fw: 7, fd: 5 };
    case "church":
      return { fw: 5, fd: 6 };
    case "cathedral":
      return { fw: 9, fd: 8 };
    case "tower":
      return { fw: 3, fd: 3 };
    case "shop":
      return { fw: 5, fd: 4 };
    case "bridge":
      return { fw: 7, fd: 3 };
    case "townhall":
      return { fw: 9, fd: 6 };
    case "tenement":
      return { fw: 5, fd: 5 };
    case "training":
      return { fw: 7, fd: 5 };
    case "flag":
      return { fw: 1, fd: 1 };
    default:
      return { fw: 3, fd: 3 };
  }
}
