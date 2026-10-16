import * as THREE from "three";
import { typeColor, type HitTarget } from "../interaction.js";
import type { TownScene } from "../scene/town-scene.js";

/**
 * Labels drawn on a 2D canvas over the 3D view: district ribbons, file
 * signs when zoomed in, and "look inside" tags over every building in the
 * hovered or selected courtyard.
 */
export class Overlay {
  private ctx: CanvasRenderingContext2D;
  private v = new THREE.Vector3();
  w = 800;
  h = 600;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.w = cssW;
    this.h = cssH;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = cssW + "px";
    this.canvas.style.height = cssH + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private project(p: THREE.Vector3, camera: THREE.Camera): { x: number; y: number } {
    this.v.copy(p).project(camera);
    return { x: (this.v.x * 0.5 + 0.5) * this.w, y: (-this.v.y * 0.5 + 0.5) * this.h };
  }

  private offscreen(s: { x: number; y: number }, mx: number, my: number) {
    return s.x < -mx || s.x > this.w + mx || s.y < -my || s.y > this.h + my;
  }

  draw(scene: TownScene, camera: THREE.Camera, zoom: number, labels: boolean, focus: HitTarget | null) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    if (focus) this.drawChildLabels(focus, camera);
    if (!labels) return;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // district ribbons
    ctx.font = '600 13px "Pixelify Sans", monospace';
    for (const b of scene.banners) {
      if (!b.visible) continue;
      const s = this.project(b.anchor, camera);
      if (this.offscreen(s, 80, 30)) continue;
      const w = Math.round(ctx.measureText(b.text).width + 26), h = 20;
      const x = Math.round(s.x - w / 2), y = Math.round(s.y - h / 2);
      ctx.fillStyle = "rgba(51,36,24,0.92)";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#d9a441";
      ctx.fillRect(x, y, w, 2);
      ctx.fillRect(x, y + h - 2, w, 2);
      ctx.fillRect(x - 4, y + 4, 4, h - 8);
      ctx.fillRect(x + w, y + 4, 4, h - 8);
      ctx.fillStyle = "#f2d894";
      ctx.fillText(b.text, s.x, s.y + 1);
    }
    // file signs, only when zoomed in enough to read them
    if (zoom <= 7) return;
    ctx.font = "10px ui-monospace, monospace";
    for (const sg of scene.signs) {
      if (!sg.visible) continue;
      const s = this.project(sg.anchor, camera);
      if (this.offscreen(s, 60, 20)) continue;
      const w = Math.round(ctx.measureText(sg.text).width + 12), h = 15;
      const x = Math.round(s.x - w / 2), y = Math.round(s.y - h / 2);
      ctx.fillStyle = "rgba(243,231,201,0.94)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "#6d4a31";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.fillStyle = "#4a3524";
      ctx.fillText(sg.text, s.x, s.y + 1);
    }
  }

  /** A name tag with a connector tick over every first-level building in a courtyard. */
  private drawChildLabels(target: HitTarget, camera: THREE.Camera) {
    if (target.children.length === 0) return;
    const ctx = this.ctx;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = '600 11px "Pixelify Sans", monospace';
    const a = new THREE.Vector3();
    for (const kid of target.children) {
      const c = kid.construct;
      const s = this.project(a.set(kid.anchor.x, kid.anchor.y, kid.anchor.z), camera);
      if (this.offscreen(s, 80, 30)) continue;
      const text = c.name.length > 20 ? c.name.slice(0, 19) + "…" : c.name;
      const w = Math.round(ctx.measureText(text).width + 22), h = 17;
      const x = Math.round(s.x - w / 2), y = Math.round(s.y - h / 2);
      ctx.fillStyle = "rgba(51,36,24,0.9)";
      ctx.fillRect(Math.round(s.x) - 1, y + h, 2, 7);
      ctx.fillStyle = "rgba(51,36,24,0.94)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "#d9a441";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.fillStyle = typeColor(c.type);
      ctx.fillRect(x + 4, y + 5, 7, 7);
      ctx.fillStyle = "#f6e7c2";
      ctx.fillText(text, s.x + 7, s.y + 1);
    }
  }
}
