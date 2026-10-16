import * as THREE from "three";
import { hash, THEMES, type ThemeName } from "./palette.js";

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat = false): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function grassTexture(): THREE.CanvasTexture {
  return canvasTex(64, 64, (ctx) => {
    ctx.fillStyle = "#74a85a";
    ctx.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 260; i++) {
      const x = hash("gx" + i) % 64, y = hash("gy" + i) % 64;
      ctx.fillStyle = i % 3 === 0 ? "#5d8f49" : i % 3 === 1 ? "#83b968" : "#699e51";
      ctx.fillRect(x, y, 2, 1);
    }
  }, true);
}

/** Trodden yard ground — lighter than the wild grass, with worn dirt patches. */
export function plotTexture(): THREE.CanvasTexture {
  return canvasTex(64, 64, (ctx) => {
    ctx.fillStyle = "#83b168";
    ctx.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 150; i++) {
      const x = hash("px" + i) % 64, y = hash("py" + i) % 64;
      ctx.fillStyle = i % 4 === 0 ? "#a58f5f" : i % 4 === 1 ? "#8fbc74" : i % 4 === 2 ? "#77a35e" : "#96a262";
      ctx.fillRect(x, y, 2, 1);
    }
  }, true);
}

export function cobbleTexture(): THREE.CanvasTexture {
  return canvasTex(32, 32, (ctx) => {
    ctx.fillStyle = "#b99a6b";
    ctx.fillRect(0, 0, 32, 32);
    const shades = ["#a8875c", "#c8ab7c", "#9c7f55", "#bfa06f"];
    let k = 0;
    for (let ry = 0; ry < 4; ry++)
      for (let rx = 0; rx < 4; rx++) {
        const ox = rx * 8 + (ry % 2 ? 4 : 0);
        ctx.fillStyle = shades[hash("cb" + k++) % shades.length];
        ctx.fillRect((ox + 1) % 32, ry * 8 + 1, 6, 6);
      }
  }, true);
}

export function waterTexture(): THREE.CanvasTexture {
  return canvasTex(64, 32, (ctx) => {
    ctx.fillStyle = "#3f74a8";
    ctx.fillRect(0, 0, 64, 32);
    ctx.fillStyle = "#5a90c0";
    for (let y = 2; y < 32; y += 6)
      for (let x = 0; x < 64; x += 10) ctx.fillRect((x + y) % 64, y, 6, 1);
    ctx.fillStyle = "#a8d4ec";
    for (let i = 0; i < 12; i++) ctx.fillRect(hash("wx" + i) % 64, hash("wy" + i) % 32, 2, 1);
  }, true);
}

/** Banded vertical gradient + stars — pixel-art sky. */
export function skyTexture(theme: ThemeName): THREE.CanvasTexture {
  const t = THEMES[theme];
  return canvasTex(64, 256, (ctx) => {
    const top = new THREE.Color(t.skyTop), bot = new THREE.Color(t.skyBot);
    const bands = 7;
    for (let i = 0; i < bands; i++) {
      const c = top.clone().lerp(bot, i / (bands - 1));
      ctx.fillStyle = "#" + c.getHexString();
      ctx.fillRect(0, Math.floor((i * 256) / bands), 64, Math.ceil(256 / bands) + 1);
    }
    if (t.stars > 0) {
      ctx.fillStyle = "rgba(255,244,214," + (0.5 + 0.5 * t.stars) + ")";
      for (let i = 0; i < 90 * t.stars; i++) ctx.fillRect(hash("sx" + i) % 64, hash("sy" + i) % 150, 1, 1);
    }
  });
}

export function glowSpriteTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(255,216,130,0.85)");
  g.addColorStop(0.5, "rgba(255,196,100,0.28)");
  g.addColorStop(1, "rgba(255,196,100,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
