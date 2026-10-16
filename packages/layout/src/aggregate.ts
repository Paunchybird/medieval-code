import type { Construct, FootprintInput } from "@medieval-code/model";
import { voxelFootprint } from "@medieval-code/model";

/** Layout grid cell size in abstract layout units (1 tile = 1 voxel) */
export const TILE = 16;
export const TILE_GAP = 2;

/**
 * Footprint in tiles. Delegates to the shared voxel footprint so the ground
 * reserved here always matches the meshes the viewer builds — including
 * walled courtyards around constructs with children.
 */
export function tileFootprint(c: FootprintInput): { tw: number; td: number } {
  const { fw, fd } = voxelFootprint(c);
  return { tw: fw, td: fd };
}

export function buildingSize(c: FootprintInput): { w: number; h: number } {
  const { tw, td } = tileFootprint(c);
  return { w: tw * TILE, h: td * TILE };
}

export function aggregateOverflow(
  constructs: Construct[],
  maxWidth: number,
  gap = TILE_GAP * TILE,
): Construct[] {
  const result: Construct[] = [];
  let rowWidth = 0;
  let overflow: Construct[] = [];

  const flushOverflow = () => {
    if (overflow.length === 0) return;
    result.push({
      ...overflow[0],
      type: "tenement",
      name: `+${overflow.length} more`,
      metrics: { loc: overflow.reduce((s, c) => s + c.metrics.loc, 0) },
      sprite: { x: 0, y: 0, w: 5 * TILE, h: 4 * TILE },
      children: undefined,
    });
    overflow = [];
  };

  for (const c of constructs) {
    const size = buildingSize(c);
    const next = rowWidth + size.w + gap;
    if (next > maxWidth && result.length > 0) {
      flushOverflow();
      overflow.push(c);
      rowWidth = 0;
    } else if (next > maxWidth) {
      overflow.push(c);
    } else {
      result.push(c);
      rowWidth = next;
    }
  }
  flushOverflow();
  return result.length > 0 ? result : constructs;
}
