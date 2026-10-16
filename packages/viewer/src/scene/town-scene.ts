import * as THREE from "three";
import type { Construct, TownModel } from "@medieval-code/model";
import type { FilterState, HitTarget } from "../interaction.js";
import { heatBucket, matchesFilter } from "../interaction.js";
import { countKids, makeBuilding, type BuildEffects, type Built } from "./builders.js";
import { buildBridgeVoxels, buildCountryside, buildGround, buildRiverMeshes, lampPostGeo, makeRiver, type CountrysideStats } from "./countryside.js";
import { Occupancy, seedOf } from "./noise.js";
import { COL, FLOWERS, hash, langPal, rnd, THEMES, type ThemeName } from "./palette.js";
import { FlagSystem, HaloSystem, worldOf } from "./effects.js";
import { batchMaterial, GroundBatch } from "./ground-batch.js";
import { buildRoadNetwork, type Box, type DistrictFoot } from "./roads.js";
import { createRoutes, type RouteSystem } from "./routes.js";
import { cobbleTexture, glowSpriteTexture, grassTexture, plotTexture, skyTexture, waterTexture } from "./textures.js";
import { createVillagers, type DistrictPopulation, type WalkArea } from "./villagers.js";
import { VoxelGrid } from "./voxel-grid.js";

/** Layout units are pixels on a 16px tile grid; world units are voxels. */
const LAYOUT_TILE = 16;
const toWorld = (v: number) => v / LAYOUT_TILE;

interface SmokeAnim {
  /** world position of the chimney top */
  anchor: THREE.Vector3;
  phase: number;
  /** stand-in carried in the building's effects list: filters hide it */
  flag: THREE.Object3D;
  /** the district group the chimney belongs to */
  root: THREE.Object3D;
}

interface BirdAnim {
  grp: THREE.Group;
  w1: THREE.Mesh;
  w2: THREE.Mesh;
  off: number;
  r: number;
  h: number;
}

export interface Label {
  text: string;
  anchor: THREE.Vector3;
  districtId: string;
  visible: boolean;
}

interface BuildingEntry {
  group: THREE.Group;
  /** voxel body and window glow, in the building's local space */
  bodyGeo: THREE.BufferGeometry;
  glowGeo: THREE.BufferGeometry | null;
  /** building-local → world */
  matrix: THREE.Matrix4;
  districtId: string;
  effects: THREE.Object3D[];
  hit: HitTarget;
  /** instance ids in the batched body / glow meshes */
  id: number;
  glowId: number;
  /** passes the current filters (pickable, not ghosted) */
  matching: boolean;
  heat: number;
}

export type ViewMode = "town" | "heat";

export interface TownScene {
  scene: THREE.Scene;
  /** every building, street-level and nested */
  hits: HitTarget[];
  /** front-most building under the pointer that passes the filters */
  pick(ndc: THREE.Vector2, camera: THREE.Camera, raycaster?: THREE.Raycaster): HitTarget | null;
  /** highlight one building (null clears) */
  setHover(hit: HitTarget | null): void;
  banners: Label[];
  signs: Label[];
  /** pan limits: the whole generated countryside */
  bounds: Box;
  /** what "fit" frames: the walled town */
  townBox: Box;
  stats: { files: number; districts: number; buildings: number; routes: number; country: Omit<CountrysideStats, "lod"> };
  /** import routes between districts and files */
  routes: RouteSystem;
  /** centre of every file plot (world units), keyed by repo-relative path */
  fileAnchors: Map<string, THREE.Vector3>;
  /** keep the sun's shadow map focused on what the camera sees */
  updateView(camera: THREE.Camera, target: THREE.Vector3, halfSize: number, zoom: number): void;
  marker: THREE.Mesh;
  setTheme(name: ThemeName): void;
  applyFilters(f: FilterState): void;
  /** "heat" tints every building by its complexity score */
  setViewMode(mode: ViewMode): void;
  animate(t: number, theme: ThemeName): void;
  dispose(): void;
}


export function buildTownScene(model: TownModel): TownScene {
  const scene = new THREE.Scene();
  const worldSeed = seedOf(model.meta.root);

  // Voxel meshes are closed and the camera always looks down, so single-sided
  // materials let the GPU skip every face turned away (about half of them).
  // Their back faces go into the shadow map, so lit faces never shadow
  // themselves (no saw-tooth acne on the walls).
  const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  bodyMat.shadowSide = THREE.BackSide;
  const plainMat = new THREE.MeshLambertMaterial();
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });

  // Every building is one instance of a single BatchedMesh, tinted per
  // instance: complexity heat (multiplicative, so a "burning" building keeps
  // its baked voxel shading), hover (a warm brighten) and the filters' ghost
  // (buildings that do not match fall into shadow).
  const HEAT_TINTS = [
    new THREE.Color(1, 1, 1),
    new THREE.Color(0xcfe08a).convertSRGBToLinear(),
    new THREE.Color(0xf0b060).convertSRGBToLinear(),
    new THREE.Color(0xef7d4a).convertSRGBToLinear().multiplyScalar(1.15),
    new THREE.Color(0xe84b38).convertSRGBToLinear().multiplyScalar(1.3),
  ];
  const WHITE = new THREE.Color(1, 1, 1);
  const GHOST = new THREE.Color(0.2, 0.21, 0.24);
  const HOVER = new THREE.Color(1.45, 1.25, 0.9);

  const glowTex = glowSpriteTexture();
  const grassTex = grassTexture();
  const cobbleTex = cobbleTexture();
  const waterTex = waterTexture();
  const plotTexBase = plotTexture();


  const entries: BuildingEntry[] = [];
  const entryOf = new Map<HitTarget, BuildingEntry>();
  let hovered: BuildingEntry | null = null;
  const flagSys = new FlagSystem();
  const smokePuffs: SmokeAnim[] = [];
  const halos = new HaloSystem(glowTex);
  const banners: Label[] = [];
  const signs: Label[] = [];
  const districtGroups = new Map<string, THREE.Group>();
  /** centre of every file plot, for import routes */
  const fileAnchors = new Map<string, THREE.Vector3>();
  const fileDistrict = new Map<string, string>();

  let buildings = 0;
  let filesCount = 0;

  /* ---- world extents ---- */
  const town: Box = {
    minX: toWorld(model.bounds.x),
    maxX: toWorld(model.bounds.x + model.bounds.w),
    minZ: toWorld(model.bounds.y),
    maxZ: toWorld(model.bounds.y + model.bounds.h),
  };
  if (model.districts.length > 0) {
    town.minX = Math.min(...model.districts.map((d) => toWorld(d.bounds.x)));
    town.maxX = Math.max(...model.districts.map((d) => toWorld(d.bounds.x + d.bounds.w)));
    town.minZ = Math.min(...model.districts.map((d) => toWorld(d.bounds.y)));
    town.maxZ = Math.max(...model.districts.map((d) => toWorld(d.bounds.y + d.bounds.h)));
  }
  const townCx = (town.minX + town.maxX) / 2;
  const townCz = (town.minZ + town.maxZ) / 2;
  const span = Math.max(town.maxX - town.minX, town.maxZ - town.minZ, 40);
  const margin = Math.round(Math.min(110, Math.max(44, span * 0.32)));
  const extent: Box = {
    minX: Math.floor(town.minX - margin),
    maxX: Math.ceil(town.maxX + margin),
    minZ: Math.floor(town.minZ - margin),
    maxZ: Math.ceil(town.maxZ + Math.max(margin, 52)),
  };
  const occ = new Occupancy(extent.minX, extent.minZ, extent.maxX - extent.minX, extent.maxZ - extent.minZ);

  /* ---- helpers that attach effects to a parent (local coords) ---- */

  /** A lamp's light pool; returns the stand-in that filters toggle. */
  function addGlowSprite(parent: THREE.Object3D, pos: THREE.Vector3, scale: number): THREE.Object3D {
    const { pos: world, root } = worldOf(scene, parent, pos);
    const vis = new THREE.Object3D();
    halos.add(world, scale, { vis, root: root === scene ? undefined : root });
    return vis;
  }

  /** A waving flag (instanced); returns the stand-in that filters toggle. */
  function addFlag(parent: THREE.Object3D, pos: THREE.Vector3, colorHex: number, poleLen: number): THREE.Object3D[] {
    const { pos: world, root } = worldOf(scene, parent, pos);
    const vis = new THREE.Object3D();
    flagSys.add(world, colorHex, poleLen, { vis, root: root === scene ? undefined : root });
    return [vis];
  }

  // all chimney smoke is one instanced mesh, animated in animate()
  function addSmokeStack(parent: THREE.Object3D, anchor: THREE.Vector3): THREE.Object3D[] {
    parent.updateWorldMatrix(true, false);
    const world = parent.localToWorld(anchor.clone());
    let root: THREE.Object3D = parent;
    while (root.parent && root.parent !== scene) root = root.parent;
    const flag = new THREE.Object3D();
    for (let i = 0; i < 3; i++) {
      smokePuffs.push({ anchor: world, phase: (i * 44 + (smokePuffs.length * 17) % 30), flag, root });
    }
    return [flag];
  }

  function attachEffects(parent: THREE.Object3D, out: BuildEffects, ox = 0, oy = 0, oz = 0): THREE.Object3D[] {
    const added: THREE.Object3D[] = [];
    for (const f of out.flags) added.push(...addFlag(parent, new THREE.Vector3(f.p[0] + ox, f.p[1] + oy, f.p[2] + oz), f.c, f.pole));
    for (const s of out.smoke) added.push(...addSmokeStack(parent, new THREE.Vector3(s[0] + ox, s[1] + oy, s[2] + oz)));
    for (const l of out.lamps) added.push(addGlowSprite(parent, new THREE.Vector3(l[0] + ox, l[1] + oy, l[2] + oz), 5));
    return added;
  }

  const pathRects: WalkArea[] = [];
  const pathMat = batchMaterial(cobbleTex);
  const plotMat = batchMaterial(plotTexBase);
  const plainGroundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  function addPath(batch: GroundBatch, x: number, z: number, w: number, d: number, tint = 0xffffff): WalkArea {
    // tiny per-path height step so crossing paths never z-fight
    batch.add(x, z, w, d, 0.03 + (pathRects.length % 40) * 0.0008, tint);
    const rect = { x, z, w, d };
    pathRects.push(rect);
    occ.mark(x, z, w, d, 4);
    return rect;
  }
  function addBatch(parent: THREE.Object3D, batch: GroundBatch, mat: THREE.Material) {
    const m = batch.build(mat);
    if (m) parent.add(m);
  }

  // every flowing-water texture shares the same scroll animation
  const flowTexs: THREE.Texture[] = [waterTex];
  function addWaterStrip(parent: THREE.Object3D, x: number, z: number, w: number, d: number, along: "x" | "z"): THREE.Object3D[] {
    const sand = new THREE.Mesh(
      new THREE.PlaneGeometry(w + 1.4, d + 1.4),
      new THREE.MeshLambertMaterial({ color: 0xd9c08a }),
    );
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(x + w / 2, 0.015, z + d / 2);
    sand.receiveShadow = true;
    parent.add(sand);
    const tex = waterTexture();
    const len = along === "x" ? w : d;
    const wid = along === "x" ? d : w;
    tex.repeat.set(Math.max(1, Math.round(len / 4)), Math.max(1, Math.round(wid / 2)));
    flowTexs.push(tex);
    const geo = new THREE.PlaneGeometry(len, wid);
    if (along === "z") geo.rotateZ(Math.PI / 2); // ripples flow down the strip
    const water = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(x + w / 2, 0.045, z + d / 2);
    parent.add(water);
    return [sand, water];
  }

  /**
   * Places a build and, recursively, every nested build inside it. Each
   * level gets its own mesh and hit target, so a loop inside a method inside
   * a class is individually hoverable, selectable and heat-tinted.
   */
  function addBuiltRec(
    c: Construct,
    b: Built,
    parent: THREE.Object3D,
    rel: [number, number, number],
    abs: [number, number, number],
    n: HitTarget["neighborhood"],
    d: HitTarget["district"],
    depth: number,
    parentC?: Construct,
  ): HitTarget {
    const group = new THREE.Group();
    group.position.set(rel[0], rel[1], rel[2]);
    parent.add(group);
    const bodyGeo = b.v.build(b.seed);
    const glowGeo = b.g.size > 0 ? b.g.build(b.seed) : null;
    group.updateWorldMatrix(true, false);
    const matrix = group.matrixWorld.clone();
    const effects = attachEffects(group, b.out);
    const localTop = b.v.maxY() + 1;

    // a bridge needs something to bridge: a stream runs from the grass
    // behind the plot, under the arch, and down to the street in front,
    // with reeds on the banks so it sits naturally in the yard
    if (depth === 0 && c.type === "bridge" && b.children.length === 0) {
      effects.push(...addWaterStrip(group, 2, -1.5, b.fw - 4, b.fd + 3, "z"));
      const rv = new VoxelGrid();
      for (const [px, pz] of [[1, -2], [b.fw - 2, -1], [1, b.fd + 1], [b.fw - 2, b.fd]]) {
        rv.set(px, 0, pz, 0x4e8f45);
        rv.set(px, 1, pz, 0x63a852);
        rv.set(px, 2, pz, 0x7a5a32);
      }
      const rm = new THREE.Mesh(rv.build(b.seed + 9), bodyMat);
      rm.castShadow = true;
      group.add(rm);
      effects.push(rm);
    }
    // hot code flies a warning pennant even in plain town view
    const cxBucket = heatBucket(c.metrics.complexity ?? 1);
    if (depth === 0 && cxBucket >= 3) {
      effects.push(...addFlag(
        group,
        new THREE.Vector3(b.fw / 2, localTop + 0.5, b.fd / 2),
        cxBucket === 4 ? 0xc73b2d : 0xd96a35,
        3,
      ));
    }

    const hit: HitTarget = {
      construct: c,
      neighborhood: n,
      district: d,
      center: { x: abs[0] + b.fw / 2, z: abs[2] + b.fd / 2 },
      top: abs[1] + localTop,
      nested: countKids(c),
      children: [],
      parent: parentC,
    };
    for (const kid of b.children) {
      const kHit = addBuiltRec(
        kid.construct,
        kid.built,
        group,
        kid.off,
        [abs[0] + kid.off[0], abs[1] + kid.off[1], abs[2] + kid.off[2]],
        n,
        d,
        depth + 1,
        c,
      );
      hit.children.push({
        construct: kid.construct,
        anchor: { x: kHit.center.x, y: kHit.top + 2, z: kHit.center.z },
      });
    }
    entries.push({
      group, bodyGeo, glowGeo, matrix, districtId: d.id, effects, hit,
      id: -1, glowId: -1, matching: true, heat: heatBucket(c.metrics.complexity ?? 1),
    });
    return hit;
  }

  /* ---- districts, rows, buildings ---- */

  const populations: DistrictPopulation[] = [];
  const foots: DistrictFoot[] = [];
  const districtRects: { x: number; z: number; w: number; d: number }[] = [];

  for (const d of model.districts) {
    const dGroup = new THREE.Group();
    districtGroups.set(d.id, dGroup);
    scene.add(dGroup);
    const districtPaths: WalkArea[] = [];
    const pathBatch = new GroundBatch(4);
    const plotBatch = new GroundBatch(6);
    const edgeBatch = new GroundBatch(1);
    let districtConstructs = 0;
    let topPathZ = Infinity;

    const dSeed = hash(d.path);
    const dx = toWorld(d.bounds.x);
    const dz = toWorld(d.bounds.y);
    const W = Math.max(4, Math.round(toWorld(d.bounds.w)) - 1);
    const D = Math.max(4, Math.round(toWorld(d.bounds.h)) - 1);
    const gate = Math.floor(W / 2);
    foots.push({ id: d.id, x: dx, z: dz, W, D, gateX: dx + gate });
    districtRects.push({ x: dx + 1, z: dz + 1, w: W - 1, d: D - 1 });

    banners.push({ text: d.path, anchor: new THREE.Vector3(dx + W / 2, 11, dz + 1), districtId: d.id, visible: true });

    // low stone wall + gate + lanterns + flower beds
    const wallV = new VoxelGrid();
    const wallG = new VoxelGrid();
    for (let i = 0; i <= W; i++) { wallV.set(i, 0, 0, COL.stoneLo); wallV.set(i, 0, D, COL.stoneLo); }
    for (let j = 1; j < D; j++) { wallV.set(0, 0, j, COL.stoneLo); wallV.set(W, 0, j, COL.stoneLo); }
    for (let i = 0; i <= W; i += 5) { wallV.set(i, 1, 0, COL.stoneHi); wallV.set(i, 1, D, COL.stoneHi); }
    for (let j = 0; j <= D; j += 5) { wallV.set(0, 1, j, COL.stoneHi); wallV.set(W, 1, j, COL.stoneHi); }
    // corner watch pillars anchor the ward visually
    for (const [px, pz] of [[0, 0], [W, 0], [0, D], [W, D]]) {
      wallV.fill(px, 0, pz, px, 3, pz, COL.stone);
      wallV.set(px, 2, pz, COL.stoneHi);
      wallV.set(px, 4, pz, COL.stoneHi);
    }
    for (let gx = gate - 1; gx <= gate + 1; gx++) { wallV.del(gx, 0, D); wallV.del(gx, 1, D); }
    for (const px of [gate - 2, gate + 2]) {
      wallV.fill(px, 0, D, px, 2, D, COL.timber);
      wallV.set(px, 3, D, COL.timberDk);
      wallG.set(px, 2, D + 1, COL.window);
      addGlowSprite(dGroup, new THREE.Vector3(dx + px + 0.5, 2.6, dz + D + 1.5), 5);
    }
    // flower beds inside the front wall
    for (let i = 3; i < W - 2; i += 4) {
      if (Math.abs(i - gate) < 3) continue;
      if (rnd(dSeed + "bed" + i) < 0.6) wallV.set(i, 0, D - 1, FLOWERS[hash(dSeed + "bf" + i) % FLOWERS.length]);
    }
    if (wallG.size > 0) {
      const wallGlow = new THREE.Mesh(wallG.build(dSeed), glowMat);
      wallGlow.position.set(dx, 0, dz);
      dGroup.add(wallGlow);
    }
    // the walls themselves are taken ground
    occ.mark(dx, dz, W + 1, 1);
    occ.mark(dx, dz + D, W + 1, 1);
    occ.mark(dx, dz, 1, D + 1);
    occ.mark(dx + W, dz, 1, D + 1);
    occ.mark(dx + 1, dz + D - 1, W - 1, 1); // flower beds

    for (const n of d.neighborhoods) {
      filesCount++;
      const pal = langPal(n.language, n.isTest, n.isConfig, dSeed);
      const rowX = toWorld(n.row.x);
      const rowZ = toWorld(n.row.y);
      const rowW = toWorld(n.row.w);
      const rowD = toWorld(n.row.h);
      signs.push({
        text: n.file.split("/").pop() ?? n.file,
        anchor: new THREE.Vector3(rowX + rowW / 2, 0.5, rowZ + rowD + 1.2),
        districtId: d.id,
        visible: true,
      });
      fileAnchors.set(n.file, new THREE.Vector3(rowX + rowW / 2, 0, rowZ + rowD / 2));
      fileDistrict.set(n.file, d.id);
      // cobble path in front of the file block, stretched to meet the
      // district spine so every street joins one connected network
      const spineX = dx + gate - 1;
      const px0 = Math.min(rowX, spineX);
      const px1 = Math.max(rowX + rowW, spineX + 3);
      districtPaths.push(addPath(pathBatch, px0, rowZ + rowD + 0.2, px1 - px0, 2.4));
      topPathZ = Math.min(topPathZ, rowZ + rowD + 0.2);

      // the file itself is a visible plot: trodden ground with boundary
      // stones and corner posts (folder walls > file plots > buildings)
      plotBatch.add(rowX, rowZ, rowW, rowD, 0.012);
      occ.mark(rowX - 1, rowZ - 1, rowW + 2, rowD + 2);
      // a worn earth border outlines the plot; low posts mark its corners
      edgeBatch.add(rowX - 0.35, rowZ - 0.35, rowW + 0.7, rowD + 0.7, 0.006, 0x9c8452);
      const pw = Math.max(2, Math.round(rowW) - 1);
      const pd = Math.max(2, Math.round(rowD) - 1);
      const lx = Math.round(rowX - dx), lz = Math.round(rowZ - dz);
      for (const [cxp, czp] of [[0, 0], [pw, 0], [0, pd], [pw, pd]]) wallV.set(lx + cxp, 0, lz + czp, COL.timberDk);

      // constructs share sub-rows (same sprite.y); align fronts per sub-row
      const subRowDepth = new Map<number, number>();
      for (const c of n.constructs) {
        const dep = toWorld(c.sprite.h);
        subRowDepth.set(c.sprite.y, Math.max(subRowDepth.get(c.sprite.y) ?? 0, dep));
      }

      for (const c of n.constructs) {
        buildings += 1 + countKids(c);
        districtConstructs += 1 + countKids(c);
        const b = makeBuilding(c, pal);
        const frontShift = (subRowDepth.get(c.sprite.y) ?? b.fd) - b.fd;
        // deterministic ±1 voxel jitter so streets settle organically
        // instead of parade rows (the layout gap guarantees no overlap)
        const jx = Math.round((rnd(b.seed + "jx") - 0.5) * 2);
        const jz = Math.round((rnd(b.seed + "jz") - 0.5) * 2);
        const bx = toWorld(c.sprite.x) + jx;
        const bz = toWorld(c.sprite.y) + frontShift + jz;
        addBuiltRec(c, b, dGroup, [bx, 0, bz], [bx, 0, bz], n, d, 0);
      }
    }

    // spine street: gate up to the northernmost row, one connected network
    if (topPathZ < Infinity) {
      districtPaths.push(addPath(pathBatch, dx + gate - 1, topPathZ, 3, dz + D + 1 - topPathZ));
    }
    addBatch(dGroup, pathBatch, pathMat);
    addBatch(dGroup, plotBatch, plotMat);
    addBatch(dGroup, edgeBatch, plainGroundMat);
    // walls, flower beds and plot corner posts: one mesh per district
    const wallMesh = new THREE.Mesh(wallV.build(dSeed), bodyMat);
    wallMesh.position.set(dx, 0, dz);
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    dGroup.add(wallMesh);

    // canal along the west wall, with little stone footbridges
    const hasCanal = W >= 16 && D >= 14 && occ.free(dx + 2.5, dz + D / 2, 1);
    if (hasCanal) {
      addWaterStrip(dGroup, dx + 1.2, dz + 2, 2.6, D - 4, "z");
      occ.mark(dx + 1, dz + 1, 5, D - 1);
      for (let bz = dz + 6; bz < dz + D - 6; bz += 14) {
        const fb = new VoxelGrid();
        for (let x = 0; x < 5; x++) {
          const lift = x >= 1 && x <= 3 ? 1 : 0;
          fb.set(x, lift, 0, COL.stone);
          fb.set(x, lift, 1, COL.stoneHi);
        }
        const fbm = new THREE.Mesh(fb.build(bz), bodyMat);
        fbm.castShadow = true;
        fbm.position.set(dx + 0.5, 0, bz);
        dGroup.add(fbm);
      }
    }

    populations.push({ id: d.id, paths: districtPaths, constructCount: districtConstructs });
  }

  /* ---- roads: avenues, ring roads, main road, country roads ---- */
  const roadsGroup = new THREE.Group();
  scene.add(roadsGroup);
  const net = buildRoadNetwork(foots, extent);
  const roadBatch = new GroundBatch(4);
  for (const r of net.rects) {
    const area = addPath(roadBatch, r.x, r.z, r.w, r.d, r.kind === "country" ? 0xe6dccb : 0xffffff);
    occ.mark(r.x - 0.5, r.z - 0.5, r.w + 1, r.d + 1, 4);
    // townsfolk stroll the gate aprons and avenues of their own ward
    if (r.kind === "gate" || r.kind === "avenue") {
      const owner = foots.find((f) => r.kind === "gate" ? Math.abs(f.gateX - 1 - r.x) < 0.01 : false);
      if (owner) populations.find((p) => p.id === owner.id)?.paths.push(area);
    }
  }
  addBatch(roadsGroup, roadBatch, pathMat);

  /* ---- river + bridge south of town ---- */
  const river = makeRiver(net.mainX, net.townSouth + 13);
  const riverX0 = extent.minX - 300, riverX1 = extent.maxX + 300;
  const sandMat = new THREE.MeshLambertMaterial({ color: 0xd9c08a });
  for (const m of buildRiverMeshes(river, riverX0, riverX1, waterTex, sandMat)) scene.add(m);
  for (let x = extent.minX; x < extent.maxX; x++) {
    const zc = river.zAt(x + 0.5);
    occ.mark(x, zc - river.halfW - 2, 1, river.halfW * 2 + 4, 5);
  }
  const bridgeLen = Math.ceil(river.halfW * 2) + 6;
  const bridgeMesh = new THREE.Mesh(buildBridgeVoxels(bridgeLen).build(7), bodyMat);
  bridgeMesh.castShadow = true;
  bridgeMesh.receiveShadow = true;
  bridgeMesh.position.set(net.mainX - 2.5, 0, Math.round(river.crossZ - bridgeLen / 2));
  scene.add(bridgeMesh);

  /* ---- street lamps: along the avenues, ring road, and the main road down to the river ---- */
  const lampSpots = [...net.lamps];
  for (let z = net.mainZ0 + 3; z < river.crossZ - river.halfW - 4; z += 7) {
    lampSpots.push([net.mainX - 2.4, z], [net.mainX + 2.4, z]);
  }
  lampSpots.push([net.mainX - 3.4, river.crossZ - bridgeLen / 2 - 0.5], [net.mainX + 3.4, river.crossZ - bridgeLen / 2 - 0.5]);
  if (lampSpots.length > 0) {
    const lp = lampPostGeo();
    const posts = new THREE.InstancedMesh(lp.body, bodyMat, lampSpots.length);
    const heads = new THREE.InstancedMesh(lp.glow, glowMat, lampSpots.length);
    const m4 = new THREE.Matrix4();
    lampSpots.forEach(([x, z], i) => {
      m4.makeTranslation(x, 0, z);
      posts.setMatrixAt(i, m4);
      heads.setMatrixAt(i, m4);
      addGlowSprite(scene, new THREE.Vector3(x, 3.5, z), 5.5);
      occ.mark(x - 0.5, z - 0.5, 1, 1, 4);
    });
    posts.castShadow = true;
    posts.computeBoundingSphere();
    heads.computeBoundingSphere();
    scene.add(posts, heads);
  }

  /* ---- terrain, fields, forests, gardens ---- */
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
  for (const g of buildGround(extent, worldSeed, grassTex)) scene.add(g);
  const country = buildCountryside({
    parent: scene,
    extent,
    town,
    districts: districtRects,
    occ,
    river,
    seed: worldSeed,
    vcMat: bodyMat,
    plainMat,
  });

  /* ---- every building in one batched mesh, every lit window in another ---- */
  const sizeOf = (gs: THREE.BufferGeometry[]) => ({
    v: gs.reduce((a, g) => a + g.attributes.position.count, 0),
    i: gs.reduce((a, g) => a + (g.index?.count ?? 0), 0),
  });
  const bodySize = sizeOf(entries.map((e) => e.bodyGeo));
  const bodies = new THREE.BatchedMesh(Math.max(1, entries.length), Math.max(1, bodySize.v), Math.max(1, bodySize.i), bodyMat);
  bodies.castShadow = true;
  bodies.receiveShadow = true;
  const glowList = entries.filter((e) => e.glowGeo);
  const glowSize = sizeOf(glowList.map((e) => e.glowGeo!));
  const glows = new THREE.BatchedMesh(Math.max(1, glowList.length), Math.max(1, glowSize.v), Math.max(1, glowSize.i), glowMat);
  const byInstance: BuildingEntry[] = [];
  for (const e of entries) {
    e.id = bodies.addInstance(bodies.addGeometry(e.bodyGeo));
    bodies.setMatrixAt(e.id, e.matrix);
    byInstance[e.id] = e;
    entryOf.set(e.hit, e);
    if (e.glowGeo) {
      e.glowId = glows.addInstance(glows.addGeometry(e.glowGeo));
      glows.setMatrixAt(e.glowId, e.matrix);
    }
  }
  scene.add(bodies, glows);
  const burning = entries.filter((e) => e.heat === 4);
  const smoulder = new THREE.Color();

  /* ---- chimney smoke: one instanced mesh for every puff ---- */
  const smokeMat = new THREE.MeshBasicMaterial({ color: 0xe8e8e8, transparent: true, opacity: 0.42, depthWrite: false });
  const smoke = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), smokeMat, Math.max(1, smokePuffs.length));
  smoke.count = 0;
  smoke.frustumCulled = false;
  scene.add(smoke);

  /* ---- birds ---- */
  const birds: BirdAnim[] = [];
  for (let i = 0; i < 5; i++) {
    const grp = new THREE.Group();
    const wingGeo = new THREE.BoxGeometry(0.9, 0.1, 0.3);
    const wingMat = new THREE.MeshBasicMaterial({ color: 0x3a352e });
    const w1 = new THREE.Mesh(wingGeo, wingMat);
    w1.position.x = -0.45;
    const w2 = new THREE.Mesh(wingGeo, wingMat);
    w2.position.x = 0.45;
    grp.add(w1);
    grp.add(w2);
    scene.add(grp);
    birds.push({ grp, w1, w2, off: i * 1.7, r: span * (0.3 + 0.08 * i), h: 24 + i * 3 });
  }

  /* ---- inhabitants ---- */
  const villagers = createVillagers(scene, populations);

  /* ---- import routes ---- */
  const routes = createRoutes(scene, model, fileAnchors, fileDistrict, glowTex);

  /* ---- selection marker ---- */
  const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.9), new THREE.MeshBasicMaterial({ color: 0xf2c94c }));
  marker.visible = false;
  scene.add(marker);

  /* ---- lights ---- */
  const hemi = new THREE.HemisphereLight(0xffffff, 0x445533, 1);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 1200;
  scene.add(hemi);
  scene.add(sun);
  scene.add(sun.target);
  const sunDir = new THREE.Vector3(0.45, 1.1, 0.35).normalize();
  let shadowHalf = -1;
  const shadowCenter = new THREE.Vector3(townCx, 0, townCz);

  /**
   * The shadow map covers only what the camera sees (plus a margin), so a
   * 2048² map stays crisp at any zoom. The centre snaps to whole shadow
   * texels so shadows do not shimmer while panning.
   */
  function updateView(target: THREE.Vector3, halfSize: number) {
    const half = THREE.MathUtils.clamp(Math.ceil(halfSize * 1.25 / 8) * 8, 24, span + 80);
    if (half !== shadowHalf) {
      shadowHalf = half;
      const cam = sun.shadow.camera;
      cam.left = -half;
      cam.right = half;
      cam.top = half;
      cam.bottom = -half;
      cam.updateProjectionMatrix();
    }
    const texel = (2 * shadowHalf) / sun.shadow.mapSize.x;
    shadowCenter.set(Math.round(target.x / texel) * texel, 0, Math.round(target.z / texel) * texel);
    sun.target.position.copy(shadowCenter);
    sun.position.copy(shadowCenter).addScaledVector(sunDir, 400);
    sun.target.updateMatrixWorld();
  }
  let lastLodZoom = -1;
  function updateViewFull(camera: THREE.Camera, target: THREE.Vector3, halfSize: number, zoom: number) {
    updateView(target, halfSize);
    halos.update(camera);
    // level of detail: ground clutter too small to see is not drawn
    if (Math.abs(zoom - lastLodZoom) > 0.05) {
      lastLodZoom = zoom;
      for (const m of country.lod) m.visible = zoom >= m.userData.lod;
    }
  }
  updateView(shadowCenter, span / 2);

  /* ---- theme ---- */
  let skyTex: THREE.Texture | null = null;
  function setTheme(name: ThemeName) {
    const t = THEMES[name];
    if (!t) return;
    if (skyTex) skyTex.dispose();
    skyTex = skyTexture(name);
    scene.background = skyTex;
    hemi.color.set(t.hemiSky);
    hemi.groundColor.set(t.hemiGnd);
    hemi.intensity = t.hemiInt;
    sun.color.set(t.sun);
    sun.intensity = t.sunInt;
    sunDir.set(t.sunDir[0], t.sunDir[1], t.sunDir[2]).normalize();
    sun.position.copy(shadowCenter).addScaledVector(sunDir, 400);
    glowMat.color.setScalar(t.windows);
    halos.setOpacity(t.lamps * 0.9);
    smokeMat.color.set(t.smoke);
    for (const b of birds) b.grp.visible = name !== "night";
    routes.setTheme(name);
  }

  /* ---- filters + view mode ---- */
  let viewMode: ViewMode = "town";
  let lastFilters: FilterState | null = null;

  function baseColor(e: BuildingEntry): THREE.Color {
    if (!e.matching) return GHOST;
    return viewMode === "heat" ? HEAT_TINTS[e.heat] : WHITE;
  }

  /** Re-applies filters, heat and hover to every building instance. */
  function refreshMaterials() {
    for (const e of entries) {
      const shownDistrict = !lastFilters || lastFilters.districts.has(e.districtId);
      e.matching = shownDistrict && (!lastFilters || matchesFilter(e.hit.construct, e.hit.neighborhood, e.hit.district, lastFilters));
      bodies.setVisibleAt(e.id, shownDistrict);
      bodies.setColorAt(e.id, e === hovered && e.matching ? HOVER : baseColor(e));
      if (e.glowId >= 0) glows.setVisibleAt(e.glowId, e.matching && viewMode === "town");
      for (const fx of e.effects) fx.visible = e.matching;
    }
    flagSys.sync();
    halos.sync();
  }

  function setHover(hit: HitTarget | null) {
    const next = hit ? entryOf.get(hit) ?? null : null;
    if (next === hovered) return;
    const prev = hovered;
    hovered = next;
    if (prev) bodies.setColorAt(prev.id, baseColor(prev));
    if (next && next.matching) bodies.setColorAt(next.id, HOVER);
  }

  function pick(ndc: THREE.Vector2, camera: THREE.Camera, raycaster = new THREE.Raycaster()): HitTarget | null {
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(bodies, false);
    for (const h of hits) {
      const e = byInstance[h.batchId ?? -1];
      if (e && e.matching) return e.hit;
    }
    return null;
  }

  function applyFilters(f: FilterState) {
    lastFilters = f;
    for (const [id, g] of districtGroups) g.visible = f.districts.has(id);
    refreshMaterials();
    for (const b of banners) b.visible = f.districts.has(b.districtId);
    for (const s of signs) s.visible = f.districts.has(s.districtId);
    villagers.setVisibleDistricts(f.districts);
    routes.setVisibleDistricts(f.districts);
  }

  function setViewMode(mode: ViewMode) {
    viewMode = mode;
    refreshMaterials();
  }

  /* ---- animation ---- */
  const smokeM4 = new THREE.Matrix4();
  function animate(t: number, theme: ThemeName) {
    flagSys.animate(t);
    // puffs rise, drift, swell, then shrink away (instances cannot fade one by one)
    let sn = 0;
    for (const p of smokePuffs) {
      if (!p.flag.visible || !p.root.visible) continue;
      const age = (t * 0.6 + p.phase) % 130;
      const k = age / 130;
      const s = (0.5 + k * 1.3) * (k < 0.7 ? Math.min(1, k / 0.05) : (1 - k) / 0.3);
      smokeM4.makeScale(s, s, s);
      smokeM4.setPosition(p.anchor.x + Math.sin(age * 0.09 + p.phase) * 0.6 * k, p.anchor.y + age * 0.055, p.anchor.z);
      smoke.setMatrixAt(sn++, smokeM4);
    }
    smoke.count = sn;
    smoke.instanceMatrix.needsUpdate = true;
    for (const b of birds) {
      const a = t * 0.004 + b.off;
      b.grp.position.set(townCx + Math.cos(a) * b.r, b.h + Math.sin(t * 0.02 + b.off) * 2.5, townCz + Math.sin(a) * b.r * 0.6);
      b.grp.rotation.y = -a;
      const flap = Math.sin(t * 0.3 + b.off) * 0.55;
      b.w1.rotation.z = flap;
      b.w2.rotation.z = -flap;
    }
    villagers.update(t);
    routes.animate(t);
    for (const tex of flowTexs) tex.offset.x = (t * 0.0006) % 1;
    if (marker.visible) marker.position.y += Math.sin(t * 0.1) * 0.02;
    marker.rotation.y = t * 0.03;
    // the hottest buildings smoulder in heat view
    if (viewMode === "heat" && t % 3 === 0) {
      const glowK = 1 + 0.22 * Math.sin(t * 0.12);
      for (const e of burning) {
        if (e.matching && e !== hovered) bodies.setColorAt(e.id, smoulder.copy(HEAT_TINTS[4]).multiplyScalar(glowK));
      }
    }
    if (theme === "night" && t % 7 === 0) halos.flicker((i) => rnd(t + ":" + i));
  }

  /* ---- batched effects: flags, light pools ---- */
  flagSys.finalize(scene);
  halos.finalize(scene);
  refreshMaterials();

  return {
    scene,
    hits: entries.map((e) => e.hit),
    pick,
    setHover,
    banners,
    signs,
    bounds: extent,
    townBox: { minX: town.minX, maxX: town.maxX, minZ: town.minZ, maxZ: net.townSouth || town.maxZ },
    stats: {
      files: filesCount || model.meta.parsedFiles,
      districts: model.districts.length,
      buildings,
      routes: routes.fileRouteCount,
      country: { trees: country.trees, bushes: country.bushes, fields: country.fields, flowers: country.flowers },
    },
    routes,
    fileAnchors,
    updateView: updateViewFull,
    marker,
    setTheme,
    applyFilters,
    setViewMode,
    animate,
    dispose() {
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
      grassTex.dispose();
      cobbleTex.dispose();
      waterTex.dispose();
      glowTex.dispose();
      if (skyTex) skyTex.dispose();
    },
  };
}
