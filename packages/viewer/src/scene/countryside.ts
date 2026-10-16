import * as THREE from "three";
import { COL, FLOWERS, hash, rnd } from "./palette.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { batchMaterial, GroundBatch } from "./ground-batch.js";
import { fbm, Occupancy, valueNoise } from "./noise.js";
import type { Box } from "./roads.js";
import { VoxelGrid } from "./voxel-grid.js";

/* ------------------------------------------------------------------ */
/* Instanced scatter: one InstancedMesh per variant, whatever the count */
/* ------------------------------------------------------------------ */

interface Variant {
  geo: THREE.BufferGeometry;
  /** hidden below this camera zoom (pixels per tile): too small to see */
  lod: number;
  /** geometry carries baked vertex colours (voxel models) */
  vc: boolean;
  shadow: boolean;
  items: { x: number; y: number; z: number; rot: number; col: number; sx: number; sz: number }[];
}

export class Scatter {
  private variants = new Map<string, Variant>();

  define(name: string, geo: THREE.BufferGeometry, vc: boolean, shadow: boolean, lod = 0) {
    this.variants.set(name, { geo, vc, shadow, lod, items: [] });
  }

  add(name: string, x: number, z: number, opts: { y?: number; rot?: number; col?: number; sx?: number; sz?: number } = {}) {
    const v = this.variants.get(name);
    if (!v) throw new Error("unknown scatter variant " + name);
    v.items.push({ x, y: opts.y ?? 0, z, rot: opts.rot ?? 0, col: opts.col ?? 0xffffff, sx: opts.sx ?? 1, sz: opts.sz ?? 1 });
  }

  count(name: string): number {
    return this.variants.get(name)?.items.length ?? 0;
  }

  /**
   * Builds the instanced meshes into `parent`, one per variant per CHUNK²
   * tile square, so the camera and the (view-sized) shadow camera cull
   * whole chunks instead of drawing every tree of the countryside.
   */
  flush(parent: THREE.Object3D, vcMat: THREE.Material, plainMat: THREE.Material, chunk = 56): THREE.InstancedMesh[] {
    const out: THREE.InstancedMesh[] = [];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    for (const v of this.variants.values()) {
      const buckets = new Map<string, Variant["items"]>();
      for (const it of v.items) {
        const key = Math.floor(it.x / chunk) + "," + Math.floor(it.z / chunk);
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = []));
        b.push(it);
      }
      for (const items of buckets.values()) {
        const im = new THREE.InstancedMesh(v.geo, v.vc ? vcMat : plainMat, items.length);
        items.forEach((it, i) => {
          q.setFromAxisAngle(up, it.rot);
          m4.compose(p.set(it.x, it.y, it.z), q, s.set(it.sx, 1, it.sz));
          im.setMatrixAt(i, m4);
          im.setColorAt(i, c.set(it.col));
        });
        im.castShadow = v.shadow;
        im.receiveShadow = true;
        im.userData.lod = v.lod;
        im.computeBoundingSphere();
        parent.add(im);
        out.push(im);
      }
    }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Voxel models: trees, bushes, hay, scarecrow, reeds, lamp posts       */
/* ------------------------------------------------------------------ */

const OAK = [0x4e8f45, 0x63a852, 0x77bb60];
const PINE = [0x2f6b3f, 0x3b7a48, 0x2a5e38, 0x356f43];
const BIRCH = [0x8cc063, 0x9fcf6e, 0x7db35a];
const BUSH = [0x4a8240, 0x5a9a4b, 0x3f7538];

function blob(v: VoxelGrid, seed: string, layers: [number, number][], greens: number[], fruit = 0, fruitCol: number = COL.red) {
  for (const [r, y] of layers) {
    for (let x = -r; x <= r; x++)
      for (let z = -r; z <= r; z++) {
        if (Math.abs(x) + Math.abs(z) > r + (r > 1 ? 1 : 0)) continue;
        const f = fruit > 0 && rnd(seed + "fr" + x + y + z) < fruit;
        v.set(x, y, z, f ? fruitCol : greens[hash(seed + "g" + x + y + z) % greens.length]);
      }
  }
}

/** Centres a voxel model's (0,0) column on the origin so rotations keep it in place. */
function centred(v: VoxelGrid, seed: string): THREE.BufferGeometry {
  const g = v.build(seed);
  g.translate(-0.5, 0, -0.5);
  return g;
}

export interface Footprint { r: number }

/** Tree and bush models, with the canopy radius each needs on the ground. */
export function treeModels(): { name: string; geo: THREE.BufferGeometry; r: number }[] {
  const models: { name: string; geo: THREE.BufferGeometry; r: number }[] = [];

  let v = new VoxelGrid();
  v.fill(0, 0, 0, 0, 1, 0, COL.timber);
  blob(v, "oakS", [[1, 2], [1, 3], [0, 4]], OAK, 0.04);
  models.push({ name: "oakS", geo: centred(v, "oakS"), r: 1 });

  v = new VoxelGrid();
  v.fill(0, 0, 0, 0, 2, 0, COL.timber);
  blob(v, "oakM", [[2, 3], [2, 4], [1, 5], [0, 6]], OAK, 0.03);
  models.push({ name: "oakM", geo: centred(v, "oakM"), r: 2 });

  v = new VoxelGrid();
  v.fill(0, 0, 0, 0, 3, 0, COL.timber);
  v.set(1, 2, 0, COL.timber);
  blob(v, "oakL", [[2, 3], [3, 4], [3, 5], [2, 6], [1, 7]], OAK, 0.02);
  models.push({ name: "oakL", geo: centred(v, "oakL"), r: 3 });

  v = new VoxelGrid();
  v.set(0, 0, 0, COL.timberDk);
  blob(v, "pine", [[2, 1], [2, 2], [1, 3], [1, 4], [0, 5], [0, 6]], PINE);
  models.push({ name: "pine", geo: centred(v, "pine"), r: 2 });

  v = new VoxelGrid();
  v.fill(0, 0, 0, 0, 1, 0, COL.timberDk);
  blob(v, "pineT", [[2, 2], [1, 3], [2, 4], [1, 5], [1, 6], [0, 7], [0, 8]], PINE);
  models.push({ name: "pineT", geo: centred(v, "pineT"), r: 2 });

  v = new VoxelGrid();
  for (let y = 0; y <= 3; y++) v.set(0, y, 0, y === 1 ? 0xb9b4a6 : 0xeeeae0);
  blob(v, "birch", [[1, 3], [1, 4], [1, 5], [0, 6]], BIRCH);
  models.push({ name: "birch", geo: centred(v, "birch"), r: 1 });

  v = new VoxelGrid();
  blob(v, "bush", [[1, 0], [0, 1]], BUSH);
  models.push({ name: "bush", geo: centred(v, "bush"), r: 1 });

  v = new VoxelGrid();
  blob(v, "berry", [[1, 0], [1, 1], [0, 2]], BUSH, 0.18, 0xb0386a);
  models.push({ name: "berry", geo: centred(v, "berry"), r: 1 });

  v = new VoxelGrid();
  v.set(0, 0, 0, BUSH[1]);
  v.set(1, 0, 0, BUSH[0]);
  models.push({ name: "shrub", geo: centred(v, "shrub"), r: 0 });

  return models;
}

function hayGeo(): THREE.BufferGeometry {
  const v = new VoxelGrid();
  v.speckle(0, 0, 0, 1, 1, 1, 0xe2c25e, 0xc9a748, "hay", 0.3);
  v.set(0, 2, 0, 0xe2c25e);
  return centred(v, "hay");
}

function scarecrowGeo(): THREE.BufferGeometry {
  const v = new VoxelGrid();
  v.fill(0, 0, 0, 0, 2, 0, COL.timber);
  v.fill(-1, 2, 0, 1, 2, 0, 0x8a4a3a); // coat sleeves
  v.set(0, 3, 0, 0xe2c25e); // straw head
  v.set(0, 4, 0, 0x533625); // hat
  return centred(v, "scarecrow");
}

function wellGeo(): THREE.BufferGeometry {
  const v = new VoxelGrid();
  for (let x = -1; x <= 1; x++)
    for (let z = -1; z <= 1; z++) {
      if (x === 0 && z === 0) v.set(0, 0, 0, 0x3f74a8); // water
      else v.set(x, 0, z, (x + z) % 2 === 0 ? COL.stone : COL.stoneLo);
    }
  v.fill(-1, 1, 0, -1, 2, 0, COL.timber);
  v.fill(1, 1, 0, 1, 2, 0, COL.timber);
  for (let x = -1; x <= 1; x++) v.set(x, 3, 0, COL.timberDk);
  v.set(0, 2, 0, COL.gold); // bucket on the beam
  return v.build("well");
}

function benchGeo(): THREE.BufferGeometry {
  const v = new VoxelGrid();
  v.set(-1, 0, 0, COL.timberDk);
  v.set(1, 0, 0, COL.timberDk);
  v.fill(-1, 1, 0, 1, 1, 0, COL.timber);
  return v.build("bench");
}

function reedGeo(): THREE.BufferGeometry {
  const v = new VoxelGrid();
  v.set(0, 0, 0, 0x4e8f45);
  v.set(0, 1, 0, 0x63a852);
  v.set(0, 2, 0, 0x7a5a32); // cattail
  return centred(v, "reed");
}

export function lampPostGeo(): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const v = new VoxelGrid();
  v.set(0, 0, 0, COL.stoneLo);
  v.fill(0, 1, 0, 0, 2, 0, COL.timberDk);
  v.set(0, 4, 0, COL.timberDk);
  const g = new VoxelGrid();
  g.set(0, 3, 0, COL.window);
  return { body: centred(v, "lamp"), glow: centred(g, "lampg") };
}

/* ------------------------------------------------------------------ */
/* River                                                                */
/* ------------------------------------------------------------------ */

export interface River {
  /** z of the river's centre line at x */
  zAt(x: number): number;
  halfW: number;
  /** z of the centre line where the main road crosses */
  crossZ: number;
}

/**
 * A meandering river south of the town. Its centre line is flat (zero
 * slope) where the main road crosses so the bridge meets it square, and it
 * only ever swings south, away from the walls.
 */
export function makeRiver(mainX: number, z0: number): River {
  const zAt = (x: number) => {
    const u = x - mainX;
    return z0 + 5 * (1 - Math.cos(u / 24)) + 3 * Math.sin(u / 11) ** 2;
  };
  return { zAt, halfW: 3.5, crossZ: z0 };
}

function ribbon(zAt: (x: number) => number, x0: number, x1: number, halfW: number, y: number, uvScale: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let len = 0;
  let prev: [number, number] | null = null;
  let k = 0;
  for (let x = x0; x <= x1; x += 1) {
    const z = zAt(x);
    const dz = (zAt(x + 0.5) - zAt(x - 0.5));
    const nl = Math.hypot(1, dz);
    const nx = -dz / nl, nz = 1 / nl; // normal to the tangent (1, dz)
    if (prev) len += Math.hypot(x - prev[0], z - prev[1]);
    prev = [x, z];
    pos.push(x + nx * halfW, y, z + nz * halfW, x - nx * halfW, y, z - nz * halfW);
    uv.push(len / uvScale, 0, len / uvScale, (halfW * 2) / uvScale);
    if (k > 0) {
      const a = (k - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    k++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the strip is wound clockwise seen from above: flip normals up
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

export function buildRiverMeshes(river: River, x0: number, x1: number, waterTex: THREE.Texture, sandMat: THREE.Material): THREE.Mesh[] {
  const sand = new THREE.Mesh(ribbon(river.zAt, x0, x1, river.halfW + 1.6, 0.014, 4), sandMat);
  sand.receiveShadow = true;
  waterTex.repeat.set(1, 1);
  const water = new THREE.Mesh(
    ribbon(river.zAt, x0, x1, river.halfW, 0.05, 6),
    new THREE.MeshLambertMaterial({ map: waterTex }),
  );
  water.receiveShadow = true;
  return [sand, water];
}

/** Stone bridge carrying the main road over the river, square to the flow. */
export function buildBridgeVoxels(len: number): VoxelGrid {
  const v = new VoxelGrid();
  for (let z = 0; z < len; z++) {
    const lift = z >= 2 && z <= len - 3 ? 1 : 0;
    const lift2 = z >= 4 && z <= len - 5 ? 1 : 0;
    for (let x = 0; x < 5; x++) v.set(x, lift + lift2, z, (x + z) % 3 === 0 ? COL.stoneHi : COL.stone);
    if (lift) for (let x = 0; x < 5; x++) v.set(x, 0, z, COL.stoneLo); // the arch body
    if (z % 2 === 0) {
      v.set(-1, 1 + lift + lift2, z, COL.stoneLo);
      v.set(5, 1 + lift + lift2, z, COL.stoneLo);
    }
    v.set(-1, lift + lift2, z, COL.stoneLo);
    v.set(5, lift + lift2, z, COL.stoneLo);
  }
  // the arch: hollow under the middle so water reads through it
  for (let z = 4; z <= len - 5; z++) for (let x = 0; x < 5; x++) v.del(x, 0, z);
  return v;
}

/* ------------------------------------------------------------------ */
/* Fields                                                               */
/* ------------------------------------------------------------------ */

type Crop = "wheat" | "greens" | "lavender" | "pumpkin" | "plowed";
const CROPS: Crop[] = ["wheat", "wheat", "greens", "lavender", "pumpkin", "plowed", "wheat", "greens"];

function furrowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 16;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#8a6a42";
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = "#74552f";
  for (let y = 0; y < 16; y += 4) ctx.fillRect(0, y, 16, 2);
  ctx.fillStyle = "#9c7a4c";
  for (let i = 0; i < 10; i++) ctx.fillRect(hash("fx" + i) % 16, hash("fy" + i) % 16, 1, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/* ------------------------------------------------------------------ */
/* The whole countryside                                                */
/* ------------------------------------------------------------------ */

export interface CountrysideInput {
  parent: THREE.Object3D;
  extent: Box;
  /** union of the district walls */
  town: Box;
  /** district wall rectangles: inside them only garden rules apply */
  districts: { x: number; z: number; w: number; d: number }[];
  occ: Occupancy;
  river: River;
  seed: number;
  vcMat: THREE.Material;
  plainMat: THREE.Material;
}

export interface CountrysideStats {
  trees: number;
  bushes: number;
  fields: number;
  flowers: number;
  /** meshes hidden when zoomed out, with their minimum zoom */
  lod: THREE.Object3D[];
}

function distToBox(x: number, z: number, b: Box): number {
  const dx = Math.max(b.minX - x, 0, x - b.maxX);
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  return Math.hypot(dx, dz);
}

export function buildCountryside(inp: CountrysideInput): CountrysideStats {
  const { parent, extent, town, occ, river, seed } = inp;
  const sc = new Scatter();
  const trees = treeModels();
  const radius = new Map(trees.map((t) => [t.name, t.r]));
  for (const t of trees) sc.define(t.name, t.geo, true, t.r > 0, t.r === 0 ? 2.2 : 0);
  // the last argument is the zoom below which a variant is not drawn
  sc.define("hay", hayGeo(), true, true, 1.6);
  sc.define("scarecrow", scarecrowGeo(), true, true, 2.5);
  sc.define("reed", reedGeo(), true, false, 2.5);
  sc.define("well", wellGeo(), true, true);
  sc.define("bench", benchGeo(), true, true, 2.5);
  sc.define("tuft", new THREE.BoxGeometry(0.6, 0.3, 0.6).translate(0, 0.15, 0), false, false, 3);
  sc.define("flower", new THREE.BoxGeometry(0.36, 0.36, 0.36).translate(0, 0.3, 0), false, false, 3);
  // a little patch of blooms around a few leaves: one instance, five flowers
  sc.define("flowers", mergeGeometries([
    new THREE.BoxGeometry(0.36, 0.36, 0.36).translate(-0.45, 0.3, -0.3),
    new THREE.BoxGeometry(0.36, 0.36, 0.36).translate(0.4, 0.34, -0.45),
    new THREE.BoxGeometry(0.36, 0.36, 0.36).translate(0.05, 0.28, 0.4),
    new THREE.BoxGeometry(0.36, 0.36, 0.36).translate(-0.55, 0.32, 0.55),
    new THREE.BoxGeometry(0.36, 0.36, 0.36).translate(0.6, 0.3, 0.35),
  ])!, false, false, 2.6);
  sc.define("rock", new THREE.BoxGeometry(1, 0.6, 0.8).translate(0, 0.3, 0), false, true, 1.8);
  sc.define("pebble", new THREE.BoxGeometry(0.5, 0.35, 0.5).translate(0, 0.17, 0), false, false, 3);
  sc.define("wheat", new THREE.BoxGeometry(0.8, 0.9, 0.8).translate(0, 0.45, 0), false, true, 1.4);
  sc.define("greens", new THREE.BoxGeometry(0.7, 0.5, 0.7).translate(0, 0.25, 0), false, true, 1.4);
  sc.define("lavender", new THREE.BoxGeometry(0.7, 0.7, 0.7).translate(0, 0.35, 0), false, true, 1.4);
  sc.define("pumpkin", new THREE.BoxGeometry(0.8, 0.6, 0.8).translate(0, 0.3, 0), false, true, 1.8);
  sc.define("vine", new THREE.BoxGeometry(1, 0.15, 1).translate(0, 0.08, 0), false, false, 1.4);
  sc.define("post", new THREE.BoxGeometry(0.25, 1.1, 0.25).translate(0, 0.55, 0), false, true, 2.2);
  sc.define("railX", new THREE.BoxGeometry(2, 0.14, 0.14).translate(1, 0.75, 0), false, false, 2.2);
  sc.define("railZ", new THREE.BoxGeometry(0.14, 0.14, 2).translate(0, 0.75, 1), false, false, 2.2);

  const districtAt = (x: number, z: number) =>
    inp.districts.findIndex((r) => x > r.x && x < r.x + r.w && z > r.z && z < r.z + r.d);
  const hasWell = new Set<number>();
  const forestN = (x: number, z: number) => fbm(x / 34, z / 34, seed);
  const rot = (k: string) => (hash(k) % 4) * (Math.PI / 2);
  const shade = (k: string, lo = 0.9, hi = 1.08) => {
    const t = lo + (hi - lo) * rnd(k);
    return new THREE.Color(t, t, t).getHex();
  };

  /* ---- fields: a patchwork of farms in a ring around the walls ---- */
  const furrow = furrowTexture();
  const soil = new GroundBatch(4);
  let fields = 0;
  const fieldRing = 30;
  for (let gz = town.minZ - fieldRing; gz < town.maxZ + fieldRing + 30; gz += 12) {
    for (let gx = town.minX - fieldRing; gx < town.maxX + fieldRing; gx += 15) {
      const k = `fd${gx},${gz}`;
      const w = 9 + (hash(k + "w") % 5);
      const d = 6 + (hash(k + "d") % 4);
      const x = Math.round(gx + rnd(k + "x") * 3);
      const z = Math.round(gz + rnd(k + "z") * 3);
      const cx = x + w / 2, cz = z + d / 2;
      const dist = distToBox(cx, cz, town);
      // inside the town box only the open commons between wards are farmed
      if (dist > fieldRing) continue;
      if (dist < 4 && rnd(k + "allot") < 0.35) continue;
      if (forestN(cx, cz) > 0.55) continue;
      // farms come in clusters, with meadow between them
      if (valueNoise(cx / 26, cz / 26, seed + 5) < 0.5) continue;
      if (!occ.free(cx, cz, 0)) continue;
      let ok = true;
      for (let zz = z - 1; zz <= z + d && ok; zz++) for (let xx = x - 1; xx <= x + w && ok; xx++) if (!occ.free(xx, zz)) ok = false;
      if (!ok) continue;
      occ.mark(x - 1, z - 1, w + 2, d + 2, 2);
      fields++;
      const crop = CROPS[hash(k + "crop") % CROPS.length];
      // ploughed ground (all fields share one mesh)
      soil.add(x, z, w, d, 0.02);
      // crop rows run along x, one row every other tile
      for (let zz = 0; zz < d; zz += 2) {
        for (let xx = 0; xx < w; xx++) {
          const px = x + xx + 0.5, pz = z + zz + 0.5;
          const ck = k + ":" + xx + "," + zz;
          if (crop === "wheat") sc.add("wheat", px, pz, { col: rnd(ck) < 0.3 ? 0xd4b04a : 0xe6c862 });
          else if (crop === "greens") sc.add("greens", px, pz, { col: rnd(ck) < 0.4 ? 0x5f9e45 : 0x78b85a });
          else if (crop === "lavender") sc.add("lavender", px, pz, { col: rnd(ck) < 0.35 ? 0x8a6fc4 : 0xa48ad8 });
          else if (crop === "pumpkin") {
            sc.add("vine", px, pz, { col: 0x5d8f49 });
            if (rnd(ck) < 0.3) sc.add("pumpkin", px, pz, { col: rnd(ck + "c") < 0.5 ? 0xe08a2e : 0xd27424 });
          }
        }
      }
      // fences on two sides, a scarecrow or hay stacks for character
      if (rnd(k + "fence") < 0.6) {
        for (let xx = 0; xx <= w; xx += 2) {
          sc.add("post", x + xx, z - 0.4, { col: 0x6d4a31 });
          if (xx + 2 <= w) sc.add("railX", x + xx, z - 0.4, { col: 0x7d5a3c });
        }
        for (let zz = 0; zz <= d; zz += 2) {
          sc.add("post", x - 0.4, z + zz, { col: 0x6d4a31 });
          if (zz + 2 <= d) sc.add("railZ", x - 0.4, z + zz, { col: 0x7d5a3c });
        }
      }
      if (crop === "wheat" && rnd(k + "scare") < 0.5) sc.add("scarecrow", x + Math.floor(w / 2) + 0.5, z + 1.5, { rot: rot(k + "sr") });
      if (crop === "plowed" || rnd(k + "hay") < 0.25) {
        sc.add("hay", x + w - 1, z + d - 1, { rot: rot(k + "hr") });
        if (rnd(k + "hay2") < 0.5) sc.add("hay", x + w - 3, z + d - 1, { rot: rot(k + "hr2") });
      }
    }
  }

  /* ---- river banks: reeds and pebbles ---- */
  for (let x = extent.minX; x < extent.maxX; x += 1.3) {
    const zc = river.zAt(x);
    for (const side of [-1, 1]) {
      const k = `rb${x.toFixed(1)}${side}`;
      const z = zc + side * (river.halfW + 0.6 + rnd(k) * 1.1);
      if (rnd(k + "r") < 0.22) sc.add("reed", x, z, { rot: rot(k) });
      else if (rnd(k + "p") < 0.05) sc.add("pebble", x, z, { col: shade(k + "c", 0.75, 0.95), rot: rnd(k + "pr") });
    }
  }

  /* ---- forests, hedges, meadow trees, flowers ---- */
  let treeCount = 0, bushCount = 0, flowerCount = 0;
  const step = 2;
  for (let gz = extent.minZ; gz < extent.maxZ; gz += step) {
    for (let gx = extent.minX; gx < extent.maxX; gx += step) {
      const k = `${gx},${gz}`;
      const x = gx + 0.5 + Math.round((rnd("jx" + k) - 0.5) * 1.6);
      const z = gz + 0.5 + Math.round((rnd("jz" + k) - 0.5) * 1.6);
      if (occ.get(x, z) !== 0) continue;
      const di = districtAt(x, z);
      if (di >= 0) {
        // ward gardens: an orchard tree here and there, flower beds, hedges,
        // benches and one well per ward
        const g = rnd("g" + k);
        if (!hasWell.has(di) && g < 0.04 && occ.free(x, z, 2)) {
          hasWell.add(di);
          occ.mark(x - 1.5, z - 1.5, 3, 3, 3);
          sc.add("well", x, z);
        } else if (g < 0.075 && occ.free(x, z, 1)) {
          occ.mark(x - 0.5, z - 0.5, 1, 1, 3);
          sc.add(rnd("o" + k) < 0.75 ? "oakS" : "birch", x, z, { rot: rot("gr" + k), col: shade("gs" + k) });
          treeCount++;
        } else if (g < 0.12) {
          const patch = hash(`gb${di},${Math.floor(x / 6)},${Math.floor(z / 6)}`);
            sc.add("flowers", x, z, { col: FLOWERS[patch % FLOWERS.length], rot: rot("fb" + k) });
          flowerCount += 5;
        } else if (g < 0.14 && occ.free(x, z, 0)) {
          sc.add("shrub", x, z, { rot: rot("hs" + k), col: shade("hc" + k) });
          bushCount++;
        } else if (g < 0.15 && occ.free(x, z, 1)) {
          sc.add("bench", x, z, { rot: rot("bn" + k) });
        } else if (g > 0.93) {
          sc.add("tuft", x, z, { col: [0x5d8f49, 0x699e51, 0x83b968][hash("tc" + k) % 3], rot: rot("tr" + k) });
        }
        continue;
      }
      const f = forestN(x, z);
      const dTown = distToBox(x, z, town);
      // forests keep a clearing round the walls
      // and thin out towards the edge of the map, where nobody looks closely
      const thr = 0.56 + Math.max(0, 16 - dTown) * 0.02 + Math.max(0, dTown - 60) * 0.0025;
      const r = rnd("r" + k);
      let tree: string | null = null;
      if (f > thr) {
        if (r < 0.36) {
          const deep = f - thr;
          const pick = rnd("v" + k);
          tree = deep > 0.1 ? (pick < 0.55 ? "pineT" : pick < 0.85 ? "pine" : "oakM")
            : pick < 0.3 ? "oakM" : pick < 0.48 ? "oakL" : pick < 0.66 ? "pine" : pick < 0.82 ? "birch" : "oakS";
        } else if (r < 0.42) {
          tree = rnd("b" + k) < 0.7 ? "bush" : "berry";
        }
      } else if (f > thr - 0.05) {
        // ragged forest edge: bushes and young trees
        if (r < 0.18) tree = rnd("e" + k) < 0.6 ? "bush" : rnd("e2" + k) < 0.5 ? "birch" : "oakS";
      } else if (dTown > 3) {
        if (r < 0.012) tree = rnd("m" + k) < 0.6 ? "oakM" : "oakS";
        else if (r < 0.022) tree = "bush";
      }
      if (tree) {
        const tr = radius.get(tree) ?? 1;
        if (!occ.free(x, z, tr)) continue;
        // canopies may touch but trunks keep a cell apart
        occ.mark(x - Math.max(0, tr - 1), z - Math.max(0, tr - 1), Math.max(1, 2 * tr - 1), Math.max(1, 2 * tr - 1), 3);
        sc.add(tree, x, z, { rot: rot("rt" + k), col: shade("sh" + k) });
        if (tree === "bush" || tree === "berry" || tree === "shrub") bushCount++;
        else treeCount++;
        continue;
      }
      // meadow ground cover: flowers grow in single-colour patches
      const fl = valueNoise(x / 9, z / 9, seed + 77);
      if (fl > 0.7 && r > 0.6) {
        const patch = hash(`fp${Math.floor(x / 9)},${Math.floor(z / 9)}`);
        sc.add("flowers", x, z, { col: FLOWERS[patch % FLOWERS.length], rot: rot("fr" + k) });
        flowerCount += 5;
      } else if (r > 0.94) {
        sc.add("tuft", x, z, { col: [0x5d8f49, 0x699e51, 0x83b968][hash("tc" + k) % 3], rot: rot("tr" + k) });
      } else if (r > 0.885 && f > 0.45) {
        sc.add("rock", x, z, { col: shade("rc" + k, 0.55, 0.7), rot: rnd("rr" + k) * Math.PI });
      }
    }
  }

  const soilMesh = soil.build(batchMaterial(furrow));
  if (soilMesh) parent.add(soilMesh);
  // chunks scale with the map so a huge kingdom stays a few hundred draw calls
  const mapSpan = Math.max(extent.maxX - extent.minX, extent.maxZ - extent.minZ);
  const meshes = sc.flush(parent, inp.vcMat, inp.plainMat, Math.max(56, Math.ceil(mapSpan / 5)));
  return { trees: treeCount, bushes: bushCount, fields, flowers: flowerCount, lod: meshes.filter((m) => m.userData.lod > 0) };
}

const FAR_TINT = new THREE.Color().setRGB(1.0, 1.02, 0.95);

/**
 * Ground with large-scale colour variation: lush meadow, darker forest floor
 * and sun-dried patches, multiplied over the grass texture.
 */
export function buildGround(extent: Box, seed: number, grassTex: THREE.Texture): THREE.Mesh[] {
  const W = extent.maxX - extent.minX;
  const D = extent.maxZ - extent.minZ;
  const segX = Math.min(220, Math.ceil(W / 3));
  const segZ = Math.min(220, Math.ceil(D / 3));
  const geo = new THREE.PlaneGeometry(W, D, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(extent.minX + W / 2, 0, extent.minZ + D / 2);
  const pos = geo.attributes.position;
  const col: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const f = fbm(x / 34, z / 34, seed);
    const dry = valueNoise(x / 47, z / 47, seed + 9);
    const forest = THREE.MathUtils.smoothstep(f, 0.45, 0.62);
    c.setRGB(1.04, 1.05, 0.98);
    c.lerp(new THREE.Color(0.78, 0.86, 0.8), forest);
    if (dry > 0.62) c.lerp(new THREE.Color(1.12, 1.06, 0.82), Math.min(1, (dry - 0.62) * 3) * (1 - forest));
    // break up the texture repetition a little
    const n = 0.96 + valueNoise(x / 5, z / 5, seed + 3) * 0.08;
    c.multiplyScalar(n);
    // fade into the far meadow's flat tint at the map edge: no seam
    const edge = Math.min(x - extent.minX, extent.maxX - x, z - extent.minZ, extent.maxZ - z);
    c.lerp(FAR_TINT, 1 - THREE.MathUtils.smoothstep(edge, 0, 24));
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const tex = grassTex.clone();
  tex.needsUpdate = true;
  tex.repeat.set(W / 8, D / 8);
  const mat = new THREE.MeshLambertMaterial({ map: tex, vertexColors: true });
  const ground = new THREE.Mesh(geo, mat);
  ground.receiveShadow = true;

  // endless meadow beyond the generated countryside
  const farTex = grassTex.clone();
  farTex.needsUpdate = true;
  farTex.repeat.set(400, 400);
  const far = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200), new THREE.MeshLambertMaterial({ map: farTex, color: FAR_TINT }));
  far.rotation.x = -Math.PI / 2;
  far.position.set(extent.minX + W / 2, -0.03, extent.minZ + D / 2);
  far.receiveShadow = true;
  return [ground, far];
}
