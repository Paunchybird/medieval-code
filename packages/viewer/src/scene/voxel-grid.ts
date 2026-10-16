import * as THREE from "three";
import { rnd3, seedNum } from "./palette.js";

/**
 * Sparse voxel grid meshed into a single BufferGeometry. Interior faces are
 * culled, coplanar same-colour faces are merged (greedy meshing) and
 * directional shading is baked into vertex colours (sun-side faces bright,
 * undersides dark). One draw call per model instead of one mesh per voxel.
 *
 * Voxels are keyed by a packed number (coordinates in -2048..2047), which
 * is several times faster than "x,y,z" strings on big towns.
 */

interface Face {
  n: [number, number, number];
  s: number;
  c: [number, number, number][];
}

const FACES: Face[] = [
  { n: [0, 1, 0], s: 1.0, c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { n: [0, -1, 0], s: 0.42, c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [1, 0, 0], s: 0.8, c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], s: 0.62, c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 0, 1], s: 0.9, c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], s: 0.7, c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

const S = 4096;
const OFF = 2048;
const S2 = S * S;
const key = (x: number, y: number, z: number) => (x + OFF) * S2 + (y + OFF) * S + (z + OFF);

export class VoxelGrid {
  m = new Map<number, number>();

  set(x: number, y: number, z: number, c: number) {
    this.m.set(key(x, y, z), c);
  }

  del(x: number, y: number, z: number) {
    this.m.delete(key(x, y, z));
  }

  has(x: number, y: number, z: number): boolean {
    return this.m.has(key(x, y, z));
  }

  get size(): number {
    return this.m.size;
  }

  /** Highest occupied voxel layer (0 when empty). */
  maxY(): number {
    let top = 0;
    for (const k of this.m.keys()) {
      const y = (Math.floor(k / S) % S) - OFF;
      if (y > top) top = y;
    }
    return top;
  }

  merge(other: VoxelGrid, ox: number, oy: number, oz: number) {
    for (const [k, c] of other.m) {
      const x = Math.floor(k / S2) - OFF, y = (Math.floor(k / S) % S) - OFF, z = (k % S) - OFF;
      this.set(x + ox, y + oy, z + oz, c);
    }
  }

  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number) {
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) this.set(x, y, z, c);
  }

  /** fill with occasional off-colour voxels: cheap masonry/plaster texture */
  speckle(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    c: number, cLo: number, seed: string | number, p = 0.16,
  ) {
    const s = seedNum(seed);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++)
          this.set(x, y, z, rnd3(s, x, y, z) < p ? cLo : c);
  }

  /**
   * Meshes the grid. Interior faces are culled and coplanar neighbouring
   * faces of the same colour are merged into one quad (greedy meshing), so a
   * courtyard floor or a plain wall costs a handful of triangles instead of
   * two per voxel. `seed` is kept for API compatibility.
   */
  build(_seed: string | number = 1): THREE.BufferGeometry {
    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const tmp = new THREE.Color();
    const n = this.m.size;
    const xs = new Int32Array(n), ys = new Int32Array(n), zs = new Int32Array(n), cs = new Int32Array(n);
    let i = 0;
    for (const [k, c] of this.m) {
      xs[i] = Math.floor(k / S2) - OFF;
      ys[i] = (Math.floor(k / S) % S) - OFF;
      zs[i] = (k % S) - OFF;
      cs[i] = c;
      i++;
    }
    const p = [0, 0, 0];
    for (const f of FACES) {
      const a = f.n[0] !== 0 ? 0 : f.n[1] !== 0 ? 1 : 2; // normal axis
      const u = a === 0 ? 1 : 0;
      const v = a === 2 ? 1 : 2;
      // visible faces of this direction, bucketed by slice, keyed u*S+v
      const slices = new Map<number, Map<number, number>>();
      for (let j = 0; j < n; j++) {
        if (this.m.has(key(xs[j] + f.n[0], ys[j] + f.n[1], zs[j] + f.n[2]))) continue;
        p[0] = xs[j]; p[1] = ys[j]; p[2] = zs[j];
        let sl = slices.get(p[a]);
        if (!sl) slices.set(p[a], (sl = new Map()));
        sl.set((p[u] + OFF) * S + (p[v] + OFF), cs[j]);
      }
      for (const [slice, faces] of slices) {
        const done = new Set<number>();
        const keys = [...faces.keys()].sort((q, r) => (q % S) - (r % S) || q - r); // by v, then u
        for (const k0 of keys) {
          if (done.has(k0)) continue;
          const c = faces.get(k0)!;
          const u0 = Math.floor(k0 / S) - OFF, v0 = (k0 % S) - OFF;
          const same = (uu: number, vv: number) => {
            const kk = (uu + OFF) * S + (vv + OFF);
            return !done.has(kk) && faces.get(kk) === c;
          };
          let u1 = u0 + 1;
          while (same(u1, v0)) u1++;
          let v1 = v0 + 1;
          for (;;) {
            let ok = true;
            for (let uu = u0; uu < u1 && ok; uu++) if (!same(uu, v1)) ok = false;
            if (!ok) break;
            v1++;
          }
          for (let vv = v0; vv < v1; vv++) for (let uu = u0; uu < u1; uu++) done.add((uu + OFF) * S + (vv + OFF));
          const base = pos.length / 3;
          tmp.set(c).multiplyScalar(f.s);
          for (const cn of f.c) {
            const q = [0, 0, 0];
            q[a] = slice + cn[a];
            q[u] = cn[u] ? u1 : u0;
            q[v] = cn[v] ? v1 : v0;
            pos.push(q[0], q[1], q[2]);
            nor.push(f.n[0], f.n[1], f.n[2]);
            col.push(tmp.r, tmp.g, tmp.b);
          }
          idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    return g;
  }
}
