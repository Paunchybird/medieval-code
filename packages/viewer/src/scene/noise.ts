import { hash } from "./palette.js";

/** Deterministic lattice value in [0, 1). */
function lattice(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Smooth 2D value noise in [0, 1). */
export function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix), fz = smooth(z - iz);
  const a = lattice(ix, iz, seed), b = lattice(ix + 1, iz, seed);
  const c = lattice(ix, iz + 1, seed), d = lattice(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Three octaves of value noise, normalised to [0, 1). */
export function fbm(x: number, z: number, seed: number): number {
  return (
    valueNoise(x, z, seed) * 0.57 +
    valueNoise(x * 2.1, z * 2.1, seed + 17) * 0.29 +
    valueNoise(x * 4.3, z * 4.3, seed + 41) * 0.14
  );
}

/** Seed derived from a string (repo root), so every repo gets its own countryside. */
export const seedOf = (s: string) => hash(s) % 100000;

/**
 * Tile-resolution occupancy map over the countryside. Roads, walls, fields
 * and every tree mark the cells they cover, so nothing is placed on top of
 * anything else.
 */
export class Occupancy {
  readonly cells: Uint8Array;
  constructor(readonly x0: number, readonly z0: number, readonly w: number, readonly d: number) {
    this.cells = new Uint8Array(Math.max(1, w * d));
  }

  private idx(x: number, z: number): number {
    const ix = Math.floor(x - this.x0), iz = Math.floor(z - this.z0);
    if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.d) return -1;
    return iz * this.w + ix;
  }

  /** Marks the cells under a world-space rectangle (inclusive of partial cells). */
  mark(x: number, z: number, w: number, d: number, v = 1) {
    for (let zz = Math.floor(z); zz < Math.ceil(z + d); zz++)
      for (let xx = Math.floor(x); xx < Math.ceil(x + w); xx++) {
        const i = this.idx(xx, zz);
        if (i >= 0) this.cells[i] = v;
      }
  }

  /** True when every cell within `r` of (x, z) is free (outside the map counts as taken). */
  free(x: number, z: number, r = 0): boolean {
    for (let zz = Math.floor(z - r); zz <= Math.floor(z + r); zz++)
      for (let xx = Math.floor(x - r); xx <= Math.floor(x + r); xx++) {
        const i = this.idx(xx, zz);
        if (i < 0 || this.cells[i]) return false;
      }
    return true;
  }

  get(x: number, z: number): number {
    const i = this.idx(x, z);
    return i < 0 ? 255 : this.cells[i];
  }
}
