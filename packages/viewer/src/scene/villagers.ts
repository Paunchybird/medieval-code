import * as THREE from "three";
import { hash, rnd } from "./palette.js";

/**
 * Inhabitants. Every district gets a population proportional to the amount
 * of code living there (one villager per few constructs), and the little
 * folk wander the cobble paths between the file blocks. Two instanced
 * meshes (bodies + heads) keep the whole crowd at two draw calls.
 */

export interface WalkArea {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface DistrictPopulation {
  id: string;
  /** cobble paths inside the district — villagers pick waypoints on these */
  paths: WalkArea[];
  /** how many constructs live here — drives the head count */
  constructCount: number;
}

interface Villager {
  districtId: string;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  speed: number;
  phase: number;
  yaw: number;
  wpCounter: number;
  seed: string;
}

const TUNICS = [0x8a4a3a, 0x4a6a8a, 0x5a7a42, 0x8a7a3a, 0x6a4a7a, 0x7a5a42];
const SKINS = [0xe8b98a, 0xd9a06e, 0xa9744c, 0x8a5c3c];
const MAX_VILLAGERS = 140;

export interface VillagerSystem {
  update(t: number): void;
  setVisibleDistricts(ids: Set<string>): void;
  count: number;
}

function pickPoint(paths: WalkArea[], seed: string, n: number): THREE.Vector3 {
  const p = paths[hash(seed + "r" + n) % paths.length];
  return new THREE.Vector3(
    p.x + rnd(seed + "x" + n) * p.w,
    0,
    p.z + rnd(seed + "z" + n) * p.d,
  );
}

export function createVillagers(scene: THREE.Scene, districts: DistrictPopulation[]): VillagerSystem {
  const villagers: Villager[] = [];

  for (const d of districts) {
    if (d.paths.length === 0) continue;
    const pop = Math.min(3 + Math.floor(d.constructCount / 4), 16);
    for (let i = 0; i < pop && villagers.length < MAX_VILLAGERS; i++) {
      const seed = d.id + "|villager" + i;
      const pos = pickPoint(d.paths, seed, 0);
      villagers.push({
        districtId: d.id,
        pos,
        target: pickPoint(d.paths, seed, 1),
        speed: 0.02 + rnd(seed + "spd") * 0.025,
        phase: rnd(seed + "ph") * Math.PI * 2,
        yaw: 0,
        wpCounter: 1,
        seed,
      });
    }
  }

  const n = villagers.length;
  const bodyGeo = new THREE.BoxGeometry(0.55, 0.85, 0.38);
  const headGeo = new THREE.BoxGeometry(0.42, 0.42, 0.38);
  const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshLambertMaterial(), Math.max(n, 1));
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshLambertMaterial(), Math.max(n, 1));
  bodies.castShadow = true;
  heads.castShadow = true;
  const color = new THREE.Color();
  villagers.forEach((v, i) => {
    bodies.setColorAt(i, color.set(TUNICS[hash(v.seed + "t") % TUNICS.length]));
    heads.setColorAt(i, color.set(SKINS[hash(v.seed + "s") % SKINS.length]));
  });
  bodies.count = n;
  heads.count = n;
  scene.add(bodies);
  scene.add(heads);

  const byId = new Map<string, DistrictPopulation>(districts.map((d) => [d.id, d]));
  let visible: Set<string> | null = null;

  const m4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const scl = new THREE.Vector3(1, 1, 1);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);

  function update(t: number) {
    for (let i = 0; i < n; i++) {
      const v = villagers[i];
      if (visible && !visible.has(v.districtId)) {
        bodies.setMatrixAt(i, zero);
        heads.setMatrixAt(i, zero);
        continue;
      }
      const dx = v.target.x - v.pos.x;
      const dz = v.target.z - v.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.25) {
        // linger a moment, then wander to the next spot on the paths
        if (rnd(v.seed + "go" + t) < 0.02) {
          v.wpCounter++;
          const d = byId.get(v.districtId)!;
          v.target = pickPoint(d.paths, v.seed, v.wpCounter);
        }
      } else {
        v.pos.x += (dx / dist) * v.speed;
        v.pos.z += (dz / dist) * v.speed;
        v.yaw = Math.atan2(dx, dz);
      }
      const bob = Math.abs(Math.sin(t * 0.18 + v.phase)) * 0.09;
      quat.setFromAxisAngle(up, v.yaw);
      m4.compose(new THREE.Vector3(v.pos.x, 0.45 + bob, v.pos.z), quat, scl);
      bodies.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(v.pos.x, 1.1 + bob, v.pos.z), quat, scl);
      heads.setMatrixAt(i, m4);
    }
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
  }

  update(0);

  return {
    update,
    setVisibleDistricts(ids: Set<string>) {
      visible = ids;
    },
    count: n,
  };
}
