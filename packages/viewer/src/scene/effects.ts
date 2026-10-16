import * as THREE from "three";

/**
 * Batched animated effects. A big town has a thousand flags and lamps; one
 * mesh each would cost a thousand draw calls, so they are instanced here.
 * Every item carries two visibility handles: `vis` (a stand-in object kept
 * in its building's effects list, hidden by the filters) and `root` (its
 * district group). Call `sync()` after either changes.
 */

interface Handles {
  vis?: THREE.Object3D;
  root?: THREE.Object3D;
}
const shown = (h: Handles) => (h.vis ? h.vis.visible : true) && (h.root ? h.root.visible : true);

/** World position of a point given in `parent`'s local space, and its top-level group. */
export function worldOf(scene: THREE.Object3D, parent: THREE.Object3D, local: THREE.Vector3): { pos: THREE.Vector3; root: THREE.Object3D } {
  parent.updateWorldMatrix(true, false);
  const pos = parent.localToWorld(local.clone());
  let root: THREE.Object3D = parent;
  while (root.parent && root.parent !== scene) root = root.parent;
  return { pos, root };
}

/* ---------------- flags ---------------- */

const FLAG_PHASES = 4;

interface FlagItem extends Handles {
  pos: THREE.Vector3;
  color: number;
  pole: number;
}

export class FlagSystem {
  private items: FlagItem[] = [];
  private cloths: { geo: THREE.PlaneGeometry; base: Float32Array; mesh: THREE.InstancedMesh }[] = [];
  private poles: THREE.InstancedMesh | null = null;

  add(pos: THREE.Vector3, color: number, pole: number, h: Handles) {
    this.items.push({ pos, color, pole, ...h });
  }

  get count(): number {
    return this.items.length;
  }

  /** Creates the instanced meshes (call once, after every flag is added). */
  finalize(parent: THREE.Object3D) {
    const n = Math.max(1, this.items.length);
    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    for (let p = 0; p < FLAG_PHASES; p++) {
      const geo = new THREE.PlaneGeometry(2.4, 1.1, 6, 2);
      geo.translate(1.2, 0, 0);
      const mesh = new THREE.InstancedMesh(geo, mat, Math.ceil(n / FLAG_PHASES) + 1);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      parent.add(mesh);
      this.cloths.push({ geo, base: (geo.attributes.position.array as Float32Array).slice(), mesh });
    }
    const poleGeo = new THREE.BoxGeometry(0.25, 1, 0.25).translate(0, 0.5, 0);
    this.poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: 0x533625 }), n);
    this.poles.frustumCulled = false;
    this.poles.castShadow = true;
    parent.add(this.poles);
    this.sync();
  }

  /** Rebuilds instance transforms for the flags that are currently shown. */
  sync() {
    if (!this.poles) return;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 7);
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    const counts = new Array(FLAG_PHASES).fill(0);
    let poles = 0;
    this.items.forEach((f, i) => {
      if (!shown(f)) return;
      const ph = i % FLAG_PHASES;
      const cloth = this.cloths[ph].mesh;
      m4.compose(p.set(f.pos.x, f.pos.y + Math.max(f.pole - 1.2, 0.2), f.pos.z), q, one);
      cloth.setMatrixAt(counts[ph], m4);
      cloth.setColorAt(counts[ph], c.set(f.color));
      counts[ph]++;
      if (f.pole > 0) {
        m4.makeScale(1, f.pole, 1).setPosition(f.pos.x, f.pos.y - 0.5, f.pos.z);
        this.poles!.setMatrixAt(poles++, m4);
      }
    });
    this.cloths.forEach((cl, i) => {
      cl.mesh.count = counts[i];
      cl.mesh.instanceMatrix.needsUpdate = true;
      if (cl.mesh.instanceColor) cl.mesh.instanceColor.needsUpdate = true;
    });
    this.poles.count = poles;
    this.poles.instanceMatrix.needsUpdate = true;
  }

  /** Waves the cloth: four shared geometries, offset in phase. */
  animate(t: number) {
    this.cloths.forEach((cl, ph) => {
      const pos = cl.geo.attributes.position;
      const off = ph * 1.7;
      for (let i = 0; i < pos.count; i++) {
        const k = cl.base[i * 3] / 2.4;
        pos.setZ(i, Math.sin(t * 0.14 + off + k * 3.2) * 0.3 * k);
        pos.setY(i, cl.base[i * 3 + 1] + Math.sin(t * 0.1 + off + k * 2.5) * 0.08 * k);
      }
      pos.needsUpdate = true;
    });
  }
}

/* ---------------- lamp halos ---------------- */

interface HaloItem extends Handles {
  pos: THREE.Vector3;
  scale: number;
}

/**
 * Soft light pools round lamps and windows: camera-facing quads in one
 * instanced mesh, re-oriented only when the camera turns.
 */
export class HaloSystem {
  private items: HaloItem[] = [];
  private mesh: THREE.InstancedMesh | null = null;
  private mat: THREE.MeshBasicMaterial;
  private lastQuat = new THREE.Quaternion(2, 0, 0, 0);
  private dirty = true;
  private brightness: number[] = [];

  constructor(tex: THREE.Texture) {
    this.mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 });
  }

  add(pos: THREE.Vector3, scale: number, h: Handles = {}) {
    this.items.push({ pos, scale, ...h });
  }

  get count(): number {
    return this.items.length;
  }

  finalize(parent: THREE.Object3D) {
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.mat, Math.max(1, this.items.length));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.brightness = this.items.map(() => 1);
    parent.add(this.mesh);
  }

  setOpacity(o: number) {
    this.mat.opacity = o;
    if (this.mesh) this.mesh.visible = o > 0.01;
  }

  sync() {
    this.dirty = true;
  }

  /** Night lamps flicker a little: brightness per lamp, applied on the next update. */
  flicker(rand: (i: number) => number) {
    for (let i = 0; i < this.brightness.length; i++) this.brightness[i] = 0.82 + 0.18 * rand(i);
    this.dirty = true;
  }

  update(camera: THREE.Camera) {
    if (!this.mesh || !this.mesh.visible) return;
    if (!this.dirty && camera.quaternion.equals(this.lastQuat)) return;
    this.lastQuat.copy(camera.quaternion);
    this.dirty = false;
    const m4 = new THREE.Matrix4();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    let n = 0;
    this.items.forEach((h, i) => {
      if (!shown(h)) return;
      m4.compose(h.pos, camera.quaternion, s.set(h.scale, h.scale, 1));
      this.mesh!.setMatrixAt(n, m4);
      this.mesh!.setColorAt(n, c.setScalar(this.brightness[i]));
      n++;
    });
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
