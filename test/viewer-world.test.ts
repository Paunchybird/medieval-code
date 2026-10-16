import { describe, expect, it } from "vitest";
import { buildRoadNetwork, type DistrictFoot } from "../packages/viewer/src/scene/roads";
import { fbm, Occupancy, valueNoise } from "../packages/viewer/src/scene/noise";

const rect = (r: { x: number; z: number; w: number; d: number }) => r;
const overlaps = (a: { x: number; z: number; w: number; d: number }, b: { x: number; z: number; w: number; d: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;

describe("road network", () => {
  // two rows, bottom-aligned, with the 10-tile avenue gap between them
  const foots: DistrictFoot[] = [
    { id: "a", x: 0, z: 0, W: 30, D: 20, gateX: 15 },
    { id: "b", x: 37, z: 6, W: 20, D: 14, gateX: 47 },
    { id: "c", x: 10, z: 31, W: 24, D: 18, gateX: 22 },
  ];
  const extent = { minX: -60, maxX: 120, minZ: -60, maxZ: 120 };
  const net = buildRoadNetwork(foots, extent);

  it("never runs a road through a district", () => {
    for (const r of net.rects) {
      for (const f of foots) {
        // the interior of the walls (gate aprons start outside the south wall)
        const inner = rect({ x: f.x + 1, z: f.z + 1, w: f.W - 1, d: f.D - 1 });
        expect(overlaps(r, inner), `${r.kind} road crosses district ${f.id}`).toBe(false);
      }
    }
  });

  it("opens every gate onto an avenue", () => {
    const avenues = net.rects.filter((r) => r.kind === "avenue");
    expect(avenues).toHaveLength(2);
    for (const f of foots) {
      const apron = net.rects.find((r) => r.kind === "gate" && r.x === f.gateX - 1);
      expect(apron, `gate of ${f.id}`).toBeDefined();
      expect(apron!.z).toBe(f.z + f.D + 1);
      expect(avenues.some((a) => Math.abs(a.z - (apron!.z + apron!.d)) < 1e-9)).toBe(true);
    }
  });

  it("leads the main road south to the map edge and puts lamps beside roads", () => {
    const main = net.rects.find((r) => r.kind === "main")!;
    expect(main.z + main.d).toBe(extent.maxZ);
    expect(net.lamps.length).toBeGreaterThan(3);
    for (const [x, z] of net.lamps) {
      for (const f of foots) {
        const inner = rect({ x: f.x + 1, z: f.z + 1, w: f.W - 1, d: f.D - 1 });
        expect(overlaps({ x, z, w: 0.1, d: 0.1 }, inner)).toBe(false);
      }
    }
  });

  it("copes with an empty town", () => {
    expect(buildRoadNetwork([], extent).rects).toEqual([]);
  });
});

describe("noise and occupancy", () => {
  it("is deterministic and bounded", () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 1.37, z = i * 0.71;
      const n = valueNoise(x, z, 5);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
      expect(valueNoise(x, z, 5)).toBe(n);
      expect(fbm(x, z, 5)).toBeLessThan(1);
    }
    expect(valueNoise(3.3, 4.4, 1)).not.toBe(valueNoise(3.3, 4.4, 2));
  });

  it("marks and tests cells, treating the outside as taken", () => {
    const o = new Occupancy(-10, -10, 20, 20);
    expect(o.free(0, 0, 1)).toBe(true);
    o.mark(0, 0, 2, 2);
    expect(o.free(0.5, 0.5)).toBe(false);
    expect(o.free(-1.5, -1.5, 0)).toBe(true);
    expect(o.free(-0.5, -0.5, 1)).toBe(false);
    expect(o.free(50, 50)).toBe(false);
    expect(o.get(50, 50)).toBe(255);
  });
});
