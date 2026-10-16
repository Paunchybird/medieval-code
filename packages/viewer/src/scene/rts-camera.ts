import * as THREE from "three";
import { clamp } from "./palette.js";

const PITCH = 0.62; // ~35.5° — classic RTS isometric angle
const CAM_DIST = 500;

/**
 * Age-of-Empires-style isometric camera: orthographic, yaw snapped to 45°
 * steps, eased yaw/zoom targets, world units = voxels. `zoom` is pixels per
 * world unit (zoom 6 displays as "100%").
 */
export class RtsCamera {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 4000);
  target = new THREE.Vector3();
  yaw = Math.PI / 4;
  yawTarget = Math.PI / 4;
  zoom = 6;
  zoomTarget = 6;
  minZoom = 0.6;
  maxZoom = 40;

  private cssW = 800;
  private cssH = 600;
  private bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
  private fitBox = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
  private glideGoal: THREE.Vector3 | null = null;

  constructor(width: number, height: number) {
    this.resize(width, height);
    this.updateCamera();
  }

  resize(width: number, height: number) {
    this.cssW = Math.max(width, 1);
    this.cssH = Math.max(height, 1);
    this.applyProjection();
  }

  /** Pan limits, in world units (also the fit box until setFitBox is called). */
  setBounds(minX: number, minZ: number, maxX: number, maxZ: number) {
    this.bounds = { minX, maxX, minZ, maxZ };
    this.fitBox = { minX, maxX, minZ, maxZ };
  }

  /** What "fit" frames (the town), which may be smaller than the pan limits. */
  setFitBox(minX: number, minZ: number, maxX: number, maxZ: number) {
    this.fitBox = { minX, maxX, minZ, maxZ };
  }

  /** Half the ground width the view currently covers, in world units. */
  groundHalfSize(): number {
    return Math.max(this.cssW, this.cssH / Math.sin(PITCH)) / (2 * this.zoom);
  }

  private applyProjection() {
    const halfH = this.cssH / (2 * this.zoom);
    const halfW = this.cssW / (2 * this.zoom);
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  private updateCamera() {
    this.camera.position.set(
      this.target.x + CAM_DIST * Math.cos(PITCH) * Math.sin(this.yaw),
      this.target.y + CAM_DIST * Math.sin(PITCH),
      this.target.z + CAM_DIST * Math.cos(PITCH) * Math.cos(this.yaw),
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  /** Ease toward yaw/zoom/glide targets — call once per frame. */
  update() {
    this.yaw += (this.yawTarget - this.yaw) * 0.14;
    this.zoom += (this.zoomTarget - this.zoom) * 0.16;
    if (this.glideGoal) {
      this.target.lerp(this.glideGoal, 0.12);
      if (this.target.distanceToSquared(this.glideGoal) < 0.01) this.glideGoal = null;
    }
    this.applyProjection();
    this.updateCamera();
  }

  /** Glide the view toward a point (used when a building is selected). */
  glideTo(x: number, z: number, minZoom = 0) {
    this.glideGoal = new THREE.Vector3(
      clamp(x, this.bounds.minX, this.bounds.maxX),
      this.target.y,
      clamp(z, this.bounds.minZ, this.bounds.maxZ),
    );
    if (minZoom > 0 && this.zoomTarget < minZoom) this.zoomTarget = Math.min(minZoom, this.maxZoom);
  }

  /** Move instantly (no easing): deep links, screenshots, tests. */
  jumpTo(x: number, z: number, zoom?: number) {
    this.glideGoal = null;
    this.target.set(clamp(x, this.bounds.minX, this.bounds.maxX), this.target.y, clamp(z, this.bounds.minZ, this.bounds.maxZ));
    if (zoom !== undefined) this.zoom = this.zoomTarget = clamp(zoom, this.minZoom, this.maxZoom);
    this.yaw = this.yawTarget;
    this.applyProjection();
    this.updateCamera();
  }

  pan(dx: number, dy: number) {
    this.glideGoal = null; // manual panning wins over any glide in progress
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.target.addScaledVector(right, -dx / this.zoom);
    this.target.addScaledVector(fwd, (dy / this.zoom) / Math.sin(PITCH));
    this.target.x = clamp(this.target.x, this.bounds.minX, this.bounds.maxX);
    this.target.z = clamp(this.target.z, this.bounds.minZ, this.bounds.maxZ);
  }

  zoomBy(factor: number) {
    this.zoomTarget = clamp(this.zoomTarget * factor, this.minZoom, this.maxZoom);
  }

  /** Rotate the view by 45° steps: dir -1 = left, +1 = right. */
  rotate(dir: number) {
    this.yawTarget += dir * Math.PI / 4;
  }

  /** Frame the whole kingdom: project bound corners, pick the tightest zoom. */
  fit() {
    this.glideGoal = null;
    const b = this.fitBox;
    this.target.set((b.minX + b.maxX) / 2, 2, (b.minZ + b.maxZ) / 2);
    this.updateCamera();
    const inv = this.camera.matrixWorldInverse;
    let ex = 0, ey = 0;
    const v = new THREE.Vector3();
    for (const px of [b.minX, b.maxX])
      for (const pz of [b.minZ, b.maxZ])
        for (const py of [0, 16]) {
          v.set(px, py, pz).applyMatrix4(inv);
          ex = Math.max(ex, Math.abs(v.x));
          ey = Math.max(ey, Math.abs(v.y));
        }
    this.zoomTarget = clamp(
      Math.min(this.cssW / (2 * ex * 1.04), this.cssH / (2 * ey * 1.06)),
      this.minZoom,
      this.maxZoom,
    );
  }

  /** Fit and land there instantly (no easing) — used on load. */
  snapFit() {
    this.fit();
    this.zoom = this.zoomTarget;
    this.update();
  }

  reset() {
    this.yawTarget = Math.PI / 4;
    this.snapFit();
  }
}
