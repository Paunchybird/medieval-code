import type { RoadSegment, Rect } from "@medieval-code/model";

export function streetBetweenRows(
  x: number,
  y: number,
  width: number,
): RoadSegment {
  return { x1: x, y1: y, x2: x + width, y2: y, kind: "street" };
}

export function districtRoad(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): RoadSegment {
  return { x1, y1, x2, y2, kind: "district" };
}

export function bridgeRoad(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): RoadSegment {
  return { x1, y1, x2, y2, kind: "bridge" };
}

export function unionBounds(rects: Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, w: 100, h: 100 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
