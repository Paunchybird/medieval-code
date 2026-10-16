import * as THREE from "three";

/**
 * Flat ground decals (cobble paths, file plots, field soil) batched into one
 * mesh per texture. UVs are world-space, so a repeating texture tiles
 * seamlessly across every quad, and hundreds of paths cost one draw call.
 */
export class GroundBatch {
  private pos: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];
  private n = 0;
  private c = new THREE.Color();

  constructor(private uvScale: number) {}

  /** Adds an axis-aligned quad on the ground at height y. */
  add(x: number, z: number, w: number, d: number, y: number, tint = 0xffffff) {
    const b = this.pos.length / 3;
    const s = this.uvScale;
    this.c.set(tint);
    for (const [px, pz] of [[x, z], [x, z + d], [x + w, z + d], [x + w, z]]) {
      this.pos.push(px, y, pz);
      this.uv.push(px / s, -pz / s);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.n++;
  }

  get count(): number {
    return this.n;
  }

  /** One mesh for every quad added so far (null when empty). */
  build(material: THREE.Material): THREE.Mesh | null {
    if (this.n === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    const normals = new Float32Array(this.pos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    return m;
  }
}

/** Material for a batch: repeating texture tinted by per-quad vertex colours. */
export function batchMaterial(tex: THREE.Texture): THREE.MeshLambertMaterial {
  const t = tex.clone();
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 1);
  return new THREE.MeshLambertMaterial({ map: t, vertexColors: true });
}
