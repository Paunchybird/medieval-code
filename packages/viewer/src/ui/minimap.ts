import * as THREE from "three";
import type { TownModel } from "@medieval-code/model";
import type { HitTarget } from "../interaction.js";
import type { TownScene } from "../scene/town-scene.js";

const LANG_SWATCH: Record<string, string> = { typescript: "#6e93b8", javascript: "#dfa94b", python: "#83ab60" };
const W = 168;
const H = 120;

/**
 * The map in the corner: wards with a roof-coloured band for their
 * language, the selection, and the ground the camera currently sees.
 * Layout units are pixels on a 16px tile grid; world units are tiles.
 */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private view = { ox: 0, oy: 0, scale: 1, mbx: 0, mby: 0 };
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private pt = new THREE.Vector3();
  private ndc = new THREE.Vector2();

  constructor(readonly canvas: HTMLCanvasElement) {
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext("2d")!;
  }

  draw(model: TownModel, scene: TownScene, camera: THREE.Camera, selected: HitTarget | null) {
    const ctx = this.ctx;
    const mb = model.bounds;
    const scale = Math.min(W / mb.w, H / mb.h) * 0.88;
    const ox = (W - mb.w * scale) / 2;
    const oy = (H - mb.h * scale) / 2;
    this.view = { ox, oy, scale, mbx: mb.x, mby: mb.y };
    const px = (wx: number) => ox + (wx * 16 - mb.x) * scale;
    const py = (wz: number) => oy + (wz * 16 - mb.y) * scale;

    ctx.fillStyle = "#4e7a40";
    ctx.fillRect(0, 0, W, H);
    const shown = new Set(scene.banners.filter((b) => b.visible).map((b) => b.districtId));
    for (const d of model.districts) {
      if (!shown.has(d.id)) continue;
      const r = d.bounds;
      const x = ox + (r.x - mb.x) * scale, y = oy + (r.y - mb.y) * scale;
      ctx.fillStyle = "#8a7350";
      ctx.fillRect(x, y, r.w * scale, r.h * scale);
      ctx.fillStyle = LANG_SWATCH[d.language] ?? "#b98b5a";
      ctx.fillRect(x, y, r.w * scale, Math.max(2, r.h * scale * 0.18));
      ctx.strokeStyle = "#d9a441";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, r.w * scale, r.h * scale);
    }
    if (selected) {
      ctx.fillStyle = "#f2c94c";
      ctx.fillRect(px(selected.center.x) - 2, py(selected.center.z) - 2, 4, 4);
    }
    // the ground the camera sees: the screen corners projected onto y = 0
    ctx.strokeStyle = "#ffcc44";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([nx, ny], i) => {
      this.ray.setFromCamera(this.ndc.set(nx, ny), camera);
      const p = this.ray.ray.intersectPlane(this.plane, this.pt);
      if (!p) return;
      if (i === 0) ctx.moveTo(px(p.x), py(p.z));
      else ctx.lineTo(px(p.x), py(p.z));
    });
    ctx.closePath();
    ctx.stroke();
  }

  /** World position (tiles) under a click on the minimap. */
  toWorld(clientX: number, clientY: number): { x: number; z: number } {
    const r = this.canvas.getBoundingClientRect();
    const mx = ((clientX - r.left) / r.width) * W;
    const my = ((clientY - r.top) / r.height) * H;
    const v = this.view;
    return { x: ((mx - v.ox) / v.scale + v.mbx) / 16, z: ((my - v.oy) / v.scale + v.mby) / 16 };
  }
}
