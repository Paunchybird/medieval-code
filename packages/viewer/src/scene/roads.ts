/**
 * The kingdom's road network, derived from where the districts stand. The
 * layout packs districts in rows, bottom-aligned, with a 10-tile gap under
 * every row; each row's gates open south onto an avenue running through that
 * gap. Ring roads join the avenues at both ends of the town, the main road
 * leaves the bottom avenue south over the river, and country roads lead off
 * the map so the town reads as part of a wider world.
 */

export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface DistrictFoot {
  id: string;
  /** wall origin (world tiles) */
  x: number;
  z: number;
  /** wall extent: walls stand at x..x+W and z..z+D */
  W: number;
  D: number;
  /** absolute x of the gate's centre voxel (south wall) */
  gateX: number;
}

export interface RoadRect {
  x: number;
  z: number;
  w: number;
  d: number;
  kind: "avenue" | "ring" | "main" | "country" | "gate";
}

export interface RoadNetwork {
  rects: RoadRect[];
  lamps: [number, number][];
  /** where the main road meets the river (x of the road's centre) */
  mainX: number;
  /** z where the bottom avenue ends and the main road begins */
  mainZ0: number;
  /** z of the bottom avenue's south edge: anything south of this is countryside */
  townSouth: number;
}

const ROAD_W = 3;

export function buildRoadNetwork(districts: DistrictFoot[], extent: Box): RoadNetwork {
  const rects: RoadRect[] = [];
  const lamps: [number, number][] = [];
  if (districts.length === 0) {
    return { rects, lamps, mainX: 0, mainZ0: 0, townSouth: 0 };
  }

  const minX = Math.min(...districts.map((d) => d.x));
  const maxX = Math.max(...districts.map((d) => d.x + d.W + 1));
  const townCx = Math.round((minX + maxX) / 2);

  // rows share their south wall line (bottom-aligned layout)
  const rows = new Map<number, DistrictFoot[]>();
  for (const d of districts) {
    const b = Math.round(d.z + d.D + 1);
    if (!rows.has(b)) rows.set(b, []);
    rows.get(b)!.push(d);
  }
  const bottoms = [...rows.keys()].sort((a, b) => a - b);

  const westX = minX - 6;
  const eastX = maxX + 3;
  const avenueZ = bottoms.map((b) => b + 3.5);

  // gate aprons + avenues
  bottoms.forEach((b, i) => {
    const az = avenueZ[i];
    for (const d of rows.get(b)!) {
      rects.push({ x: d.gateX - 1, z: b, w: ROAD_W, d: az - b, kind: "gate" });
    }
    rects.push({ x: westX, z: az, w: eastX + ROAD_W - westX, d: ROAD_W, kind: "avenue" });
    // lamps along the avenue's north verge, clear of the gates
    const gates = rows.get(b)!.map((d) => d.gateX);
    for (let x = westX + 6; x < eastX - 2; x += 13) {
      if (gates.some((g) => Math.abs(g - x) < 4)) continue;
      lamps.push([x, az - 0.9]);
    }
  });

  // ring roads: the west one runs on north out of the map, the east one joins the avenues
  const firstZ = avenueZ[0];
  const lastZ = avenueZ[avenueZ.length - 1];
  rects.push({ x: westX, z: extent.minZ, w: ROAD_W, d: lastZ - extent.minZ, kind: "ring" });
  if (avenueZ.length > 1) rects.push({ x: eastX, z: firstZ, w: ROAD_W, d: lastZ - firstZ, kind: "ring" });
  for (let z = Math.min(firstZ, districts[0].z) - 8; z < lastZ - 3; z += 14) {
    lamps.push([westX - 0.9, z]);
    if (avenueZ.length > 1 && z > firstZ + 3) lamps.push([eastX + ROAD_W + 0.2, z]);
  }

  // main road south from the bottom avenue, over the river and out of the map
  const mainZ0 = lastZ + ROAD_W;
  rects.push({ x: townCx - 1, z: mainZ0, w: ROAD_W, d: extent.maxZ - mainZ0, kind: "main" });

  // country roads east and west from the middle avenue
  const midZ = avenueZ[Math.floor((avenueZ.length - 1) / 2)];
  rects.push({ x: extent.minX, z: midZ, w: westX - extent.minX, d: ROAD_W, kind: "country" });
  rects.push({ x: eastX + ROAD_W, z: midZ, w: extent.maxX - eastX - ROAD_W, d: ROAD_W, kind: "country" });

  return { rects, lamps, mainX: townCx + 0.5, mainZ0, townSouth: mainZ0 };
}
