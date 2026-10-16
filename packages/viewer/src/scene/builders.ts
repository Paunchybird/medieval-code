import type { Construct } from "@medieval-code/model";
import { layoutCompound, voxelFootprint } from "@medieval-code/model";
import { clamp, COL, FLOWERS, hash, rnd, rnd3, type RoofPalette } from "./palette.js";
import { VoxelGrid } from "./voxel-grid.js";

/** Animated / glowing attachment points, in building-local voxel coords. */
export interface BuildEffects {
  flags: { p: [number, number, number]; c: number; pole: number }[];
  smoke: [number, number, number][];
  lamps: [number, number, number][];
}

/**
 * A construct nested inside a courtyard. Children stay separate builds
 * (not merged into the parent's voxels) so the scene can give every nested
 * loop / if / method its own mesh — individually hoverable, selectable and
 * heat-tinted.
 */
export interface ChildBuild {
  construct: Construct;
  built: Built;
  /** offset inside the parent, in voxels (y = courtyard floor height) */
  off: [number, number, number];
}

export interface Built {
  /** opaque body voxels (lit, casts shadow) */
  v: VoxelGrid;
  /** glowing voxels — windows, bells, lamps (unlit material) */
  g: VoxelGrid;
  out: BuildEffects;
  /** nested builds of a compound (empty for leaf buildings) */
  children: ChildBuild[];
  fw: number;
  fd: number;
  seed: number;
}

/* ---------------- shared building parts ---------------- */

function gabledRoof(v: VoxelGrid, fw: number, fd: number, baseY: number, pal: { roof: number; roofLo: number }): number {
  const alongX = fw >= fd;
  const span = alongX ? fd : fw;
  const run = alongX ? fw : fd;
  const half = Math.ceil(span / 2);
  const put = (l: number, y: number, s: number, c: number) => (alongX ? v.set(l, y, s, c) : v.set(s, y, l, c));
  for (let layer = 0; layer < half; layer++) {
    const y = baseY + layer;
    const s0 = layer, s1 = span - 1 - layer;
    const l0 = layer === 0 ? -1 : 0, l1 = layer === 0 ? run : run - 1;
    const c = layer % 2 === 0 ? pal.roof : pal.roofLo;
    for (let l = l0; l <= l1; l++) {
      put(l, y, s0, c);
      if (s1 !== s0) put(l, y, s1, c);
    }
    if (layer === 0) for (let l = -1; l <= run; l++) { put(l, y, -1, pal.roofLo); put(l, y, span, pal.roofLo); }
    // gable-end fill (plaster triangles)
    for (const l of [0, run - 1]) for (let s = s0 + 1; s < s1; s++) put(l, baseY + layer, s, COL.plasterLo);
  }
  const ridgeY = baseY + half;
  const m0 = Math.floor((span - 1) / 2), m1 = Math.ceil((span - 1) / 2);
  for (let l = -1; l <= run; l++) {
    put(l, ridgeY, m0, pal.roofLo);
    if (m1 !== m0) put(l, ridgeY, m1, pal.roofLo);
  }
  return baseY + half;
}

function pyramidRoof(v: VoxelGrid, x0: number, z0: number, w: number, baseY: number, c: number, cLo: number): number {
  let layer = 0;
  while (w - 2 * layer > 0) {
    const a = x0 + layer, b = x0 + w - 1 - layer;
    const az = z0 + layer, bz = z0 + w - 1 - layer;
    v.fill(a, baseY + layer, az, b, baseY + layer, bz, layer % 2 === 0 ? c : cLo);
    layer++;
  }
  return baseY + layer;
}

function timberFrame(v: VoxelGrid, fw: number, fd: number, h: number, seed: number) {
  v.speckle(0, 1, 0, fw - 1, h - 1, fd - 1, COL.plaster, COL.plasterLo, seed);
  v.fill(0, 0, 0, fw - 1, 0, fd - 1, COL.stoneLo);
  for (const [cx, cz] of [[0, 0], [fw - 1, 0], [0, fd - 1], [fw - 1, fd - 1]])
    v.fill(cx, 0, cz, cx, h - 1, cz, COL.timber);
  if (h >= 5) for (let x = 1; x < fw - 1; x++) v.set(x, Math.floor(h / 2), fd - 1, COL.timberDk);
}

function frontDoor(v: VoxelGrid, fw: number, fd: number, pal: RoofPalette) {
  const cx = Math.floor(fw / 2);
  v.set(cx, 0, fd - 1, COL.door);
  v.set(cx, 1, fd - 1, COL.dark);
  v.set(cx, 2, fd - 1, COL.timberDk);
  for (let x = cx - 1; x <= cx + 1; x++) v.set(x, 2, fd, pal.roofLo); // awning
}

function frontWindow(v: VoxelGrid, g: VoxelGrid, x: number, y: number, fd: number, pal: RoofPalette, shutters: boolean) {
  v.del(x, y, fd - 1);
  g.set(x, y, fd - 1, COL.window);
  if (shutters) {
    v.set(x - 1, y, fd - 1, pal.accent);
    v.set(x + 1, y, fd - 1, pal.accent);
  }
  v.set(x, y - 1, fd - 1, COL.timberDk); // sill
}

/* ---------------- building types ---------------- */

function buildHouse(v: VoxelGrid, g: VoxelGrid, out: BuildEffects, fw: number, fd: number, pal: RoofPalette, loc: number, seed: number) {
  const h = clamp(3 + Math.floor(loc / 14), 4, 7);
  timberFrame(v, fw, fd, h, seed);
  const wy = Math.min(2, h - 2);
  if (fw >= 5) {
    frontWindow(v, g, 1, wy, fd, pal, fw >= 7);
    frontWindow(v, g, fw - 2, wy, fd, pal, fw >= 7);
  }
  if (h >= 6 && fw >= 5) frontWindow(v, g, Math.floor(fw / 2), h - 2, fd, pal, false);
  frontDoor(v, fw, fd, pal);
  gabledRoof(v, fw, fd, h, pal);
  if (rnd(seed + "fl") < 0.55 && fw >= 5) {
    v.set(1, 0, fd, FLOWERS[hash(seed + "f1") % FLOWERS.length]);
    if (rnd(seed + "fl2") < 0.5) v.set(fw - 2, 0, fd, FLOWERS[hash(seed + "f2") % FLOWERS.length]);
  }
  if (rnd(seed + "ch") < 0.45) {
    const cx = fw - 2, cz = Math.floor(fd / 2);
    const top = h + Math.ceil(Math.min(fw, fd) / 2) + 1;
    v.fill(cx, h - 1, cz, cx, top, cz, COL.brick);
    v.set(cx, top + 1, cz, COL.brickLo);
    out.smoke.push([cx + 0.5, top + 2, cz + 0.5]);
  }
}

function buildCastle(v: VoxelGrid, g: VoxelGrid, out: BuildEffects, fw: number, fd: number, pal: RoofPalette, loc: number, members: number, seed: number) {
  const h = clamp(5 + Math.floor(loc / 40), 5, 8);
  v.speckle(1, 0, 1, fw - 2, h - 1, fd - 2, COL.stone, COL.stoneLo, seed);
  for (let x = 1; x < fw - 1; x += 2) { v.set(x, h, 1, COL.stoneHi); v.set(x, h, fd - 2, COL.stoneHi); }
  for (let z = 1; z < fd - 1; z += 2) { v.set(1, h, z, COL.stoneHi); v.set(fw - 2, h, z, COL.stoneHi); }
  // corner towers
  for (const [cx, cz] of [[0, 0], [fw - 2, 0], [0, fd - 2], [fw - 2, fd - 2]]) {
    v.speckle(cx, 0, cz, cx + 1, h + 1, cz + 1, COL.stoneHi, COL.stone, seed + cx + cz);
    v.fill(cx, h + 2, cz, cx + 1, h + 2, cz + 1, pal.roof);
  }
  // central keep
  const kx = Math.floor(fw / 2) - 1, kz = Math.floor(fd / 2) - 1;
  v.speckle(kx, h, kz, kx + 2, h + 3, kz + 2, COL.stone, COL.stoneLo, seed + "k");
  const keepTop = pyramidRoof(v, kx, kz, 3, h + 4, pal.roof, pal.roofLo);
  out.flags.push({ p: [kx + 1.5, keepTop + 0.5, kz + 1.5], c: pal.accent, pole: 3 });
  // gate
  const cx = Math.floor(fw / 2);
  for (let y = 0; y <= 2; y++)
    for (let x = cx - 1; x <= cx + 1; x++)
      v.set(x, y, fd - 2, y === 2 && x !== cx ? COL.stoneLo : COL.dark);
  v.del(cx - 2, 1, fd - 2); g.set(cx - 2, 1, fd - 2, COL.window);
  v.del(cx + 2, 1, fd - 2); g.set(cx + 2, 1, fd - 2, COL.window);
  // window slits
  for (const x of [2, fw - 3]) { v.del(x, h - 2, fd - 2); g.set(x, h - 2, fd - 2, COL.window); }
  if (members > 5) out.flags.push({ p: [1, h + 3.5, 1], c: COL.red, pole: 2 });
}

// Workshops read industrial: flat-roofed red-brick factory with a parapet,
// tall smokestacks, a wide double door and barrels — nothing like the gabled
// timber houses around them.
function buildWorkshop(v: VoxelGrid, g: VoxelGrid, out: BuildEffects, fw: number, fd: number, pal: RoofPalette, stacks: number, seed: number) {
  const h = 4;
  v.speckle(0, 0, 0, fw - 1, h - 1, fd - 1, COL.brick, COL.brickLo, seed, 0.28);
  v.fill(0, 0, 0, fw - 1, 0, fd - 1, COL.stoneLo); // stone footing
  // flat roof slab + brick parapet
  v.fill(0, h, 0, fw - 1, h, fd - 1, COL.timberDk);
  for (let x = 0; x < fw; x += 2) { v.set(x, h + 1, 0, COL.brickLo); v.set(x, h + 1, fd - 1, COL.brickLo); }
  for (let z = 0; z < fd; z += 2) { v.set(0, h + 1, z, COL.brickLo); v.set(fw - 1, h + 1, z, COL.brickLo); }
  // wide double door + glowing furnace window
  const cx = Math.floor(fw / 2);
  for (const dx of [0, 1]) { v.set(cx - 1 + dx, 0, fd - 1, COL.door); v.set(cx - 1 + dx, 1, fd - 1, COL.dark); }
  v.fill(cx - 2, 2, fd - 1, cx + 2, 2, fd - 1, COL.timberDk); // lintel beam
  v.del(1, 1, fd - 1);
  g.set(1, 1, fd - 1, 0xffb066); // furnace glow
  // smokestacks rise from the roof
  for (let i = 0; i < stacks; i++) {
    const sx = 1 + i * Math.max(2, Math.floor((fw - 2) / Math.max(stacks, 1)));
    const top = h + 5;
    v.fill(sx, h, 1, sx, top, 1, COL.brick);
    v.set(sx, top + 1, 1, COL.brickLo);
    out.smoke.push([sx + 0.5, top + 2, 1.5]);
  }
  // barrels and crates in the yard
  v.fill(fw - 2, 0, fd, fw - 1, 0, fd, COL.timberDk);
  v.set(fw - 1, 1, fd, COL.timber);
  v.set(-1, 0, fd - 1, COL.timber);
  v.set(-1, 1, fd - 1, COL.gold); // barrel hoop
}

// Churches are pale sanctuaries: whitewashed stone (no timber frame), an
// arched door, a rose window and a steeple crowned with a gold cross.
// Cathedrals double the towers and height.
function buildChurch(v: VoxelGrid, g: VoxelGrid, out: BuildEffects, fw: number, fd: number, pal: RoofPalette, seed: number, grand: boolean) {
  const h = grand ? 9 : 6;
  v.speckle(0, 0, 0, fw - 1, h - 1, fd - 1, 0xe8e0cc, 0xd6cbb0, seed, 0.14);
  v.fill(0, 0, 0, fw - 1, 0, fd - 1, COL.stoneLo);
  const cx = Math.floor(fw / 2);
  // rose window (bigger on cathedrals)
  v.del(cx, h - 3, fd - 1);
  g.set(cx, h - 3, fd - 1, COL.window);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) v.set(cx + dx, h - 3 + dy, fd - 1, COL.gold);
  if (grand) for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) v.set(cx + dx, h - 3 + dy, fd - 1, COL.timberDk);
  // tall arched doorway
  v.set(cx, 0, fd - 1, COL.door);
  v.set(cx, 1, fd - 1, COL.dark);
  v.set(cx, 2, fd - 1, COL.dark);
  v.set(cx - 1, 2, fd - 1, COL.gold);
  v.set(cx + 1, 2, fd - 1, COL.gold);
  // glowing side windows
  for (const z of [Math.floor(fd / 2)]) {
    v.del(0, h - 4, z); g.set(0, h - 4, z, COL.window);
    v.del(fw - 1, h - 4, z); g.set(fw - 1, h - 4, z, COL.window);
  }
  gabledRoof(v, fw, fd, h, pal);
  // bell tower(s) crowned with a gold cross
  const towers = grand ? [[0, 0], [fw - 3, 0]] : [[cx - 1, 0]];
  for (const [tx, tz] of towers) {
    const th = h + (grand ? 4 : 3);
    v.speckle(tx, 0, tz, tx + 2, th, tz + 2, 0xe8e0cc, 0xd6cbb0, seed + tx);
    v.fill(tx, 0, tz, tx, th, tz, COL.timber);
    v.fill(tx + 2, 0, tz, tx + 2, th, tz, COL.timber);
    v.del(tx + 1, th - 1, tz + 2);
    g.set(tx + 1, th - 1, tz + 2, COL.gold); // bell
    const top = pyramidRoof(v, tx, tz, 3, th + 1, pal.roof, pal.roofLo);
    // cross: upright + arms
    v.fill(tx + 1, top, tz + 1, tx + 1, top + 2, tz + 1, COL.gold);
    v.set(tx, top + 1, tz + 1, COL.gold);
    v.set(tx + 2, top + 1, tz + 1, COL.gold);
  }
  if (grand) out.flags.push({ p: [cx + 0.5, h + Math.ceil(Math.min(fw, fd) / 2) + 1, Math.floor(fd / 2) + 0.5], c: pal.accent, pole: 2 });
}

function buildTower(v: VoxelGrid, g: VoxelGrid, out: BuildEffects, pal: RoofPalette, seed: number) {
  const h = 9;
  v.speckle(0, 0, 0, 2, h, 2, COL.stone, COL.stoneLo, seed);
  v.fill(-1, h + 1, -1, 3, h + 1, 3, COL.stoneHi); // overhang ring
  for (let x = -1; x <= 3; x += 2) for (let z = -1; z <= 3; z += 2) v.set(x, h + 2, z, COL.stoneHi);
  const top = pyramidRoof(v, 0, 0, 3, h + 2, pal.roof, pal.roofLo);
  out.flags.push({ p: [1.5, top + 0.5, 1.5], c: pal.accent, pole: 3 });
  v.del(1, h - 2, 2);
  g.set(1, h - 2, 2, COL.window);
  v.set(1, 0, 2, COL.door);
  v.set(1, 1, 2, COL.dark);
}

// Shops (imports) are open market stalls: a striped canopy on timber poles
// over a counter piled with goods — instantly readable as "trade".
function buildShop(v: VoxelGrid, g: VoxelGrid, fw: number, fd: number, pal: RoofPalette, seed: number) {
  const h = 4;
  // wooden platform + back wall with shelves of goods
  v.fill(0, 0, 0, fw - 1, 0, fd - 1, COL.timberDk);
  v.fill(0, 1, 0, fw - 1, h - 1, 0, COL.plaster);
  const goods = [COL.gold, COL.red, 0x63a852, 0xe88ab8, 0x9ad1f5];
  for (let x = 1; x < fw - 1; x++) {
    if (rnd(seed + "g1" + x) < 0.75) v.set(x, 1, 0, goods[hash(seed + "ga" + x) % goods.length]);
    if (rnd(seed + "g2" + x) < 0.6) v.set(x, 2, 0, goods[hash(seed + "gb" + x) % goods.length]);
  }
  // corner poles hold up the canopy
  for (const [px, pz] of [[0, 0], [fw - 1, 0], [0, fd - 1], [fw - 1, fd - 1]])
    v.fill(px, 1, pz, px, h - 1, pz, COL.timber);
  // striped canopy with a slight overhang
  for (let x = -1; x <= fw; x++)
    for (let z = -1; z <= fd; z++)
      v.set(x, h, z, (x + z) % 2 === 0 ? COL.red : COL.plaster);
  v.set(Math.floor(fw / 2), h + 1, Math.floor(fd / 2), COL.gold); // pennant knob
  // counter with wares facing the street
  for (let x = 1; x < fw - 1; x++) {
    v.set(x, 1, fd - 1, COL.timber);
    if (rnd(seed + "c" + x) < 0.7) v.set(x, 2, fd - 1, goods[hash(seed + "gc" + x) % goods.length]);
  }
  // lantern hanging from the canopy corner
  g.set(fw - 1, h - 1, fd, COL.window);
}

// Interfaces are footbridges: stone abutments on both banks, a timber plank
// deck raised over the middle with railings, and open water flowing under it
// (the scene adds the animated stream, which runs along z beneath the deck).
function buildBridge(v: VoxelGrid, fw: number, fd: number) {
  for (const x of [0, 1, fw - 2, fw - 1]) {
    for (let z = 0; z < fd; z++) v.set(x, 0, z, (x + z) % 2 === 0 ? COL.stone : COL.stoneLo);
  }
  for (let x = 1; x < fw - 1; x++) {
    const y = x >= 2 && x <= fw - 3 ? 1 : 0;
    for (let z = 0; z < fd; z++) v.set(x, y, z, x % 2 === 0 ? COL.timber : 0x7d5a3c);
  }
  // railings: posts at the ends and the crown, a rail between them
  for (const z of [0, fd - 1]) {
    for (let x = 1; x < fw - 1; x++) {
      const y = x >= 2 && x <= fw - 3 ? 2 : 1;
      if (x === 1 || x === fw - 2 || x === Math.floor(fw / 2)) v.set(x, y, z, COL.timberDk);
    }
  }
  v.set(0, 1, 0, COL.stoneHi);
  v.set(fw - 1, 1, 0, COL.stoneHi);
  v.set(0, 1, fd - 1, COL.stoneHi);
  v.set(fw - 1, 1, fd - 1, COL.stoneHi);
}

/** Little stone well with a pitched cover — garden filler for district greens. */
export function buildWell(v: VoxelGrid) {
  for (let x = 0; x < 3; x++)
    for (let z = 0; z < 3; z++) {
      if (x === 1 && z === 1) v.set(1, 0, 1, 0x3f74a8); // water
      else v.set(x, 0, z, (x + z) % 2 === 0 ? COL.stone : COL.stoneLo);
    }
  v.fill(0, 1, 1, 0, 2, 1, COL.timber);
  v.fill(2, 1, 1, 2, 2, 1, COL.timber);
  for (let x = 0; x < 3; x++) v.set(x, 3, 1, COL.timberDk);
  v.set(1, 2, 1, COL.gold); // bucket on the beam
}

function buildTownhall(v: VoxelGrid, g: VoxelGrid, out: BuildEffects, fw: number, fd: number, pal: RoofPalette, seed: number) {
  const h = 6;
  v.fill(0, 0, 0, fw - 1, 1, fd - 1, COL.stoneLo);
  v.speckle(0, 2, 0, fw - 1, h - 1, fd - 1, COL.plaster, COL.plasterLo, seed);
  for (const [cx, cz] of [[0, 0], [fw - 1, 0], [0, fd - 1], [fw - 1, fd - 1]]) v.fill(cx, 0, cz, cx, h - 1, cz, COL.timber);
  const cx = Math.floor(fw / 2);
  v.set(cx - 1, 0, fd - 1, COL.door);
  v.set(cx, 0, fd - 1, COL.door);
  v.set(cx - 1, 1, fd - 1, COL.dark);
  v.set(cx, 1, fd - 1, COL.dark);
  for (let x = cx - 2; x <= cx + 1; x++) v.set(x, 2, fd, pal.roofLo);
  frontWindow(v, g, 1, 3, fd, pal, true);
  frontWindow(v, g, fw - 2, 3, fd, pal, true);
  // stone steps up to the double door
  for (let x = cx - 2; x <= cx + 1; x++) v.set(x, 0, fd, COL.stoneHi);
  gabledRoof(v, fw, fd, h, pal);
  // clock/bell tower
  const tx = cx - 1, th = h + 4;
  v.speckle(tx, h, Math.floor(fd / 2) - 1, tx + 2, th, Math.floor(fd / 2) + 1, COL.plasterLo, COL.plaster, seed + "t");
  v.del(tx + 1, th - 1, Math.floor(fd / 2) + 1);
  g.set(tx + 1, th - 1, Math.floor(fd / 2) + 1, COL.gold); // clock
  const top = pyramidRoof(v, tx, Math.floor(fd / 2) - 1, 3, th + 1, pal.roof, pal.roofLo);
  out.flags.push({ p: [tx + 1.5, top + 0.5, Math.floor(fd / 2) + 0.5], c: COL.gold, pole: 3 });
}

function buildTenement(v: VoxelGrid, g: VoxelGrid, fw: number, fd: number, seed: number) {
  const h = 8;
  for (let y = 0; y < h; y++)
    v.speckle(0, y, 0, fw - 1, y, fd - 1, y % 3 === 2 ? COL.stoneLo : COL.plasterLo, COL.stoneLo, seed + y, 0.2);
  v.fill(0, h, 0, fw - 1, h, fd - 1, COL.timberDk);
  for (let y = 1; y < h - 1; y += 2)
    for (let x = 1; x < fw - 1; x += 2) { v.del(x, y, fd - 1); g.set(x, y, fd - 1, COL.window); }
  v.set(Math.floor(fw / 2), 0, fd - 1, COL.door);
  v.set(Math.floor(fw / 2), 1, fd - 1, COL.dark);
}

// Test cases are training grounds: a fenced sand yard with straw dummies,
// an archery target and a weapon rack, flying the suite's pennant.
function buildTraining(v: VoxelGrid, g: VoxelGrid, out: BuildEffects, fw: number, fd: number, pal: RoofPalette, seed: number) {
  for (let x = 0; x < fw; x++)
    for (let z = 0; z < fd; z++) v.set(x, 0, z, rnd3(seed, x, 3, z) < 0.25 ? 0xcdb27a : 0xdcc38c);
  // low fence with an opening at the front
  const gate = Math.floor(fw / 2);
  for (let x = 0; x < fw; x++) {
    v.set(x, 1, 0, x % 2 === 0 ? COL.timber : COL.timberDk);
    if (Math.abs(x - gate) > 0) v.set(x, 1, fd - 1, x % 2 === 0 ? COL.timber : COL.timberDk);
  }
  for (let z = 1; z < fd - 1; z++) {
    v.set(0, 1, z, z % 2 === 0 ? COL.timber : COL.timberDk);
    v.set(fw - 1, 1, z, z % 2 === 0 ? COL.timber : COL.timberDk);
  }
  // straw dummies on posts
  for (const dx of [2, 4]) {
    if (dx >= fw - 1) continue;
    v.set(dx, 1, 2, COL.timber);
    v.set(dx, 2, 2, 0xe2c25e);
    v.set(dx - 1, 2, 2, 0xc9a748);
    v.set(dx + 1, 2, 2, 0xc9a748);
    v.set(dx, 3, 2, 0xe8d9a0);
  }
  // archery target: rings of red and white on a stand
  const tx = fw - 2;
  v.set(tx, 1, 1, COL.timberDk);
  v.set(tx, 2, 1, COL.plaster);
  v.set(tx, 3, 1, COL.red);
  v.set(tx, 4, 1, COL.plaster);
  g.set(tx, 3, 2, COL.gold); // the bullseye catches the light
  // weapon rack
  v.set(1, 1, fd - 2, COL.timberDk);
  v.set(1, 2, fd - 2, 0xb3b1a6);
  out.flags.push({ p: [0.5, 2, 0.5], c: pal.accent, pole: 3 });
}

function buildFlagPole(v: VoxelGrid, out: BuildEffects, pal: RoofPalette) {
  v.set(0, 0, 0, COL.stoneLo);
  v.fill(0, 1, 0, 0, 4, 0, COL.timberDk);
  out.flags.push({ p: [0.5, 5, 0.5], c: pal.accent, pole: 0 });
}

export function buildTree(v: VoxelGrid, seed: string | number, big: boolean) {
  const greens = [0x4e8f45, 0x63a852, 0x77bb60];
  const th = big ? 2 : 1;
  v.fill(0, 0, 0, 0, th, 0, COL.timber);
  const layers: [number, number][] = big
    ? [[2, th + 1], [2, th + 2], [1, th + 3], [0, th + 4]]
    : [[1, th + 1], [1, th + 2], [0, th + 3]];
  for (const [r, y] of layers) {
    for (let x = -r; x <= r; x++)
      for (let z = -r; z <= r; z++) {
        if (Math.abs(x) + Math.abs(z) > r + (r > 1 ? 1 : 0)) continue;
        const fruit = rnd(seed + "fr" + x + y + z) < 0.05;
        v.set(x, y, z, fruit ? COL.red : greens[hash(seed + "g" + x + y + z) % greens.length]);
      }
  }
}

export function buildLamp(v: VoxelGrid, g: VoxelGrid, out: BuildEffects) {
  v.set(0, 0, 0, COL.stoneLo);
  v.fill(0, 1, 0, 0, 2, 0, COL.timberDk);
  g.set(0, 3, 0, COL.window);
  v.set(0, 4, 0, COL.timberDk);
  out.lamps.push([0.5, 3.5, 0.5]);
}

export function countKids(c: Construct): number {
  let n = 0;
  for (const k of c.children ?? []) n += 1 + countKids(k);
  return n;
}

/* ---------------- courtyard compounds ---------------- */

// A construct with nested constructs becomes a walled courtyard in its own
// architectural style, with the children built inside — recursively. Deep
// nesting reads as rings of walls; big methods read as sprawling compounds.
// Only the courtyard itself (floor, walls, ornaments) lives in this build;
// children are returned separately so each gets its own mesh.
function buildCompound(v: VoxelGrid, out: BuildEffects, c: Construct, pal: RoofPalette, seed: number): { fw: number; fd: number; kids: ChildBuild[] } {
  const children = c.children ?? [];
  const kb = children.map((k) => makeBuilding(k, pal));
  const { fw, fd, slots } = layoutCompound(kb.map((b) => ({ fw: b.fw, fd: b.fd })));
  // courtyard floor: cobbles, or sand for a drill yard
  const sand = c.type === "training";
  for (let x = 0; x < fw; x++)
    for (let z = 0; z < fd; z++)
      v.set(x, 0, z, rnd3(seed, x, 7, z) < 0.3 ? (sand ? 0xcdb27a : 0xa8875c) : (sand ? 0xdcc38c : 0xb99a6b));
  const gate = Math.floor(fw / 2);
  const isGate = (x: number, z: number) => z === fd - 1 && x >= gate - 1 && x <= gate + 1;
  const t = c.type;
  let wallH = 2;
  let wallCol: (x: number, y: number, z: number) => number =
    (x, _y, z) => ((x + z) % 4 === 0 ? COL.timber : COL.plaster);
  if (t === "castle") {
    wallH = 4;
    wallCol = (x, y, z) => (rnd3(seed + 11, x, y, z) < 0.16 ? COL.stoneLo : COL.stone);
  } else if (t === "factory") {
    wallH = 3;
    wallCol = (x, y, z) => (rnd3(seed + 13, x, y, z) < 0.22 ? COL.brickLo : COL.brick);
  } else if (t === "tower") {
    wallH = 3;
    wallCol = () => COL.stoneLo;
  } else if (t === "church" || t === "cathedral") {
    wallH = 2;
    wallCol = (x, _y, z) => ((x + z) % 5 === 0 ? COL.timberDk : COL.plasterLo);
  } else if (t === "training") {
    // a test suite is a drill yard: sand floor, palisade of the suite's colour
    wallH = 1;
    wallCol = (x, _y, z) => ((x + z) % 3 === 0 ? pal.accent : COL.timber);
  }
  for (let x = 0; x < fw; x++)
    for (const z of [0, fd - 1]) {
      if (isGate(x, z)) continue;
      for (let y = 1; y <= wallH; y++) v.set(x, y, z, wallCol(x, y, z));
    }
  for (let z = 1; z < fd - 1; z++)
    for (const x of [0, fw - 1])
      for (let y = 1; y <= wallH; y++) v.set(x, y, z, wallCol(x, y, z));
  // gate posts
  for (const px of [gate - 2, gate + 2]) {
    v.fill(px, 1, fd - 1, px, wallH + 1, fd - 1, COL.timber);
    v.set(px, wallH + 2, fd - 1, COL.timberDk);
  }
  // corner ornaments per style
  if (t === "castle") {
    for (const [cx, cz] of [[0, 0], [fw - 2, 0], [0, fd - 2], [fw - 2, fd - 2]]) {
      v.speckle(cx, 1, cz, cx + 1, wallH + 2, cz + 1, COL.stoneHi, COL.stone, seed + cx + "-" + cz);
      v.fill(cx, wallH + 3, cz, cx + 1, wallH + 3, cz + 1, pal.roof);
    }
    for (let x = 2; x < fw - 2; x += 2) {
      v.set(x, wallH + 1, 0, COL.stoneHi);
      if (!isGate(x, fd - 1)) v.set(x, wallH + 1, fd - 1, COL.stoneHi);
    }
    out.flags.push({ p: [1, wallH + 4, 1], c: pal.accent, pole: 2 });
  } else if (t === "factory") {
    for (const [cx, cz] of [[0, 0], [fw - 1, 0]]) {
      v.fill(cx, 1, cz, cx, wallH + 4, cz, COL.brick);
      v.set(cx, wallH + 5, cz, COL.brickLo);
      out.smoke.push([cx + 0.5, wallH + 6, cz + 0.5]);
    }
  } else if (t === "church" || t === "cathedral") {
    for (const [cx, cz] of [[0, 0], [fw - 1, 0], [0, fd - 1], [fw - 1, fd - 1]]) {
      v.fill(cx, 1, cz, cx, wallH + 2, cz, COL.plaster);
      v.set(cx, wallH + 3, cz, COL.gold);
    }
  } else if (t === "tower") {
    v.fill(0, 1, 0, 0, wallH + 4, 0, COL.stoneLo);
    v.set(0, wallH + 5, 0, pal.roof);
    out.flags.push({ p: [0.5, wallH + 6, 0.5], c: pal.accent, pole: 1 });
  } else {
    for (const [cx, cz] of [[0, 0], [fw - 1, 0], [0, fd - 1], [fw - 1, fd - 1]]) {
      v.fill(cx, 1, cz, cx, wallH + 1, cz, COL.timber);
      v.set(cx, wallH + 2, cz, COL.timberDk);
    }
  }
  // children stand on the courtyard floor as separate builds
  const kids: ChildBuild[] = kb.map((b, i) => ({
    construct: children[i],
    built: b,
    off: [slots[i].x, 1, slots[i].z],
  }));
  return { fw, fd, kids };
}

/* ---------------- entry point ---------------- */

export function makeBuilding(c: Construct, pal: RoofPalette): Built {
  const seed = hash(c.name + "|" + c.type);
  const v = new VoxelGrid();
  const g = new VoxelGrid();
  const out: BuildEffects = { flags: [], smoke: [], lamps: [] };
  if (c.children && c.children.length > 0) {
    const fp = buildCompound(v, out, c, pal, seed);
    return { v, g, out, children: fp.kids, fw: fp.fw, fd: fp.fd, seed };
  }
  const { fw, fd } = voxelFootprint(c);
  const m = c.metrics;
  switch (c.type) {
    case "castle": buildCastle(v, g, out, fw, fd, pal, m.loc ?? 40, m.members ?? 0, seed); break;
    case "house": buildHouse(v, g, out, fw, fd, pal, m.loc ?? 10, seed); break;
    case "factory": buildWorkshop(v, g, out, fw, fd, pal, clamp(m.depth ?? 1, 1, 3), seed); break;
    case "church": buildChurch(v, g, out, fw, fd, pal, seed, false); break;
    case "cathedral": buildChurch(v, g, out, fw, fd, pal, seed, true); break;
    case "tower": buildTower(v, g, out, pal, seed); break;
    case "shop": buildShop(v, g, fw, fd, pal, seed); break;
    case "bridge": buildBridge(v, fw, fd); break;
    case "townhall": buildTownhall(v, g, out, fw, fd, pal, seed); break;
    case "tenement": buildTenement(v, g, fw, fd, seed); break;
    case "flag": buildFlagPole(v, out, pal); break;
    case "training": buildTraining(v, g, out, fw, fd, pal, seed); break;
    default:
      if (seed % 2 === 0) buildTree(v, seed, rnd(seed) < 0.4);
      else buildLamp(v, g, out);
  }
  return { v, g, out, children: [], fw, fd, seed };
}
