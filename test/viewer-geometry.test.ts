import { describe, expect, it } from "vitest";
import { VoxelGrid } from "../packages/viewer/src/scene/voxel-grid";
import { GroundBatch } from "../packages/viewer/src/scene/ground-batch";
import { rnd3 } from "../packages/viewer/src/scene/palette";
import * as THREE from "three";

const quads = (g: THREE.BufferGeometry) => g.index!.count / 6;

describe("voxel meshing", () => {
  it("meshes one voxel as six quads", () => {
    const v = new VoxelGrid();
    v.set(0, 0, 0, 0xff0000);
    expect(quads(v.build())).toBe(6);
  });

  it("merges a same-coloured slab into six quads, whatever its size", () => {
    const v = new VoxelGrid();
    v.fill(0, 0, 0, 39, 0, 19, 0x888888);
    expect(quads(v.build())).toBe(6);
  });

  it("keeps colours apart", () => {
    const v = new VoxelGrid();
    v.set(0, 0, 0, 0xff0000);
    v.set(1, 0, 0, 0x00ff00);
    // the shared face is hidden; the other five sides of each stay separate
    expect(quads(v.build())).toBe(10);
  });

  it("culls hidden faces and keeps the shape watertight", () => {
    const v = new VoxelGrid();
    v.fill(-2, -1, 3, 2, 1, 5, 0x123456);
    const g = v.build();
    expect(quads(g)).toBe(6);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.toArray()).toEqual([-2, -1, 3]);
    expect(g.boundingBox!.max.toArray()).toEqual([3, 2, 6]);
  });

  it("winds every face outwards (front faces point along their normal)", () => {
    const v = new VoxelGrid();
    v.set(0, 0, 0, 0xffffff);
    const g = v.build();
    const pos = g.attributes.position, nor = g.attributes.normal, idx = g.index!;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < idx.count; i += 3) {
      a.fromBufferAttribute(pos, idx.getX(i));
      b.fromBufferAttribute(pos, idx.getX(i + 1));
      c.fromBufferAttribute(pos, idx.getX(i + 2));
      n.fromBufferAttribute(nor, idx.getX(i));
      const face = b.sub(a).cross(c.sub(a));
      expect(face.dot(n)).toBeGreaterThan(0);
    }
  });

  it("supports negative coordinates, deletes and the top layer", () => {
    const v = new VoxelGrid();
    v.set(-5, 3, -7, 1);
    v.set(4, 9, 2, 2);
    expect(v.has(-5, 3, -7)).toBe(true);
    expect(v.maxY()).toBe(9);
    v.del(4, 9, 2);
    expect(v.maxY()).toBe(3);
    expect(v.size).toBe(1);
  });

  it("speckles deterministically", () => {
    const a = new VoxelGrid(), b = new VoxelGrid();
    a.speckle(0, 0, 0, 9, 9, 0, 1, 2, "wall", 0.3);
    b.speckle(0, 0, 0, 9, 9, 0, 1, 2, "wall", 0.3);
    expect([...a.m.entries()]).toEqual([...b.m.entries()]);
    const lo = [...a.m.values()].filter((c) => c === 2).length;
    expect(lo).toBeGreaterThan(10);
    expect(lo).toBeLessThan(55);
  });

  it("hashes positions uniformly", () => {
    let sum = 0;
    for (let i = 0; i < 2000; i++) sum += rnd3(7, i, i * 3, -i);
    expect(sum / 2000).toBeGreaterThan(0.45);
    expect(sum / 2000).toBeLessThan(0.55);
  });
});

describe("ground batches", () => {
  it("puts every quad in one mesh with world-space UVs", () => {
    const gb = new GroundBatch(4);
    gb.add(0, 0, 4, 2, 0.03);
    gb.add(10, 10, 8, 4, 0.03, 0xff0000);
    const m = gb.build(new THREE.MeshBasicMaterial())!;
    expect(gb.count).toBe(2);
    expect(m.geometry.index!.count).toBe(12);
    const uv = m.geometry.attributes.uv;
    // second quad's first corner sits at (10, 10): uv = (10/4, -10/4)
    expect(uv.getX(4)).toBeCloseTo(2.5);
    expect(uv.getY(4)).toBeCloseTo(-2.5);
    expect(new GroundBatch(1).build(new THREE.MeshBasicMaterial())).toBeNull();
  });
});
