import type { Construct, Neighborhood, Rect } from "@medieval-code/model";
import { voxelFootprint } from "@medieval-code/model";
import { TILE, TILE_GAP, tileFootprint } from "./aggregate.js";

const STREET_LANE = TILE * 3;
const FILE_PAD = TILE * 2;
const MIN_BLOCK_H = TILE * 5;

/**
 * Children carry footprint-sized sprites (position stays 0 — the viewer lays
 * courtyard interiors out itself) so town.json stays schema-complete.
 */
function sizeChildren(kids: Construct[] | undefined): Construct[] | undefined {
  if (!kids || kids.length === 0) return undefined;
  return kids.map((k) => {
    const f = voxelFootprint(k);
    return { ...k, sprite: { x: 0, y: 0, w: f.fw * TILE, h: f.fd * TILE }, children: sizeChildren(k.children) };
  });
}

export function layoutRow(
  constructs: Construct[],
  startX: number,
  startY: number,
  maxWidth: number,
): { placed: Construct[]; row: Rect } {
  const placed: Construct[] = [];
  let col = 0;
  let subRow = 0;
  let subRowDepth = 0;
  let usedCols = 0;
  const maxCols = Math.max(6, Math.floor((maxWidth - FILE_PAD * 2) / TILE));

  for (let i = 0; i < constructs.length; i++) {
    const c = constructs[i];
    const { tw, td } = tileFootprint(c);

    if (col > 0 && col + tw > maxCols) {
      subRow += subRowDepth + TILE_GAP;
      col = 0;
      subRowDepth = 0;
    }

    const x = startX + FILE_PAD + col * TILE;
    const y = startY + FILE_PAD + subRow * TILE;

    placed.push({
      ...c,
      sprite: { x, y, w: tw * TILE, h: td * TILE },
      children: sizeChildren(c.children),
    });

    col += tw + TILE_GAP;
    usedCols = Math.max(usedCols, col - TILE_GAP);
    subRowDepth = Math.max(subRowDepth, td);
  }

  const blockH = FILE_PAD * 2 + (subRow + subRowDepth) * TILE;
  // block hugs its actual content instead of claiming the full row budget —
  // districts stay dense and walls sit close to real buildings
  const blockW = usedCols * TILE + FILE_PAD * 2;

  return {
    placed,
    row: { x: startX, y: startY, w: Math.max(blockW, MIN_BLOCK_H), h: Math.max(blockH, MIN_BLOCK_H) },
  };
}

/**
 * Pack source files in a 2D grid so the town stays roughly square (not a
 * vertical strip). Two passes: measure every block at the origin first, then
 * place columns at their real widths — no dead space from the row budget.
 */
export function layoutNeighborhoods(
  neighborhoods: Omit<Neighborhood, "row">[],
  originX: number,
  originY: number,
  maxRowWidth: number,
): Neighborhood[] {
  const count = neighborhoods.length;
  const cols = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(count))));

  const measured = neighborhoods.map((n) =>
    layoutRow(n.constructs as Construct[], 0, 0, maxRowWidth),
  );

  // shelf packing: place tallest blocks first so each band has a uniform
  // height and districts don't end up with dead space beside short files
  const order = measured
    .map((_, i) => i)
    .sort((a, b) => measured[b].row.h - measured[a].row.h);

  const colW: number[] = new Array(cols).fill(MIN_BLOCK_H);
  order.forEach((idx, k) => {
    const c = k % cols;
    colW[c] = Math.max(colW[c], measured[idx].row.w);
  });
  const colX: number[] = [];
  let acc = originX;
  for (let c = 0; c < cols; c++) {
    colX[c] = acc;
    acc += colW[c] + STREET_LANE;
  }

  const laid: Neighborhood[] = [];
  let bandY = originY;
  let bandMaxH = 0;

  order.forEach((idx, k) => {
    const m = measured[idx];
    const c = k % cols;
    const dx = colX[c];
    const dy = bandY;
    const placed = m.placed.map((p) => ({
      ...p,
      sprite: { ...p.sprite, x: p.sprite.x + dx, y: p.sprite.y + dy },
    }));
    laid.push({
      ...neighborhoods[idx],
      constructs: placed,
      row: { x: dx, y: dy, w: m.row.w, h: m.row.h },
    });
    bandMaxH = Math.max(bandMaxH, m.row.h);
    if (c === cols - 1) {
      bandY += bandMaxH + STREET_LANE * 2;
      bandMaxH = 0;
    }
  });

  return laid;
}

export const ROW_HEIGHT = MIN_BLOCK_H;
export const ROAD_HEIGHT = STREET_LANE;
export const GAP = TILE_GAP * TILE;
