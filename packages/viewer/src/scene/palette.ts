import * as THREE from "three";

/* ---------------- deterministic randomness ---------------- */
export function hash(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export const rnd = (seed: string | number) => (hash(String(seed)) % 100000) / 100000;

/** Fast deterministic value in [0, 1) for an integer seed and a voxel position. */
export function rnd3(seed: number, x: number, y: number, z: number): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(x | 0, 0x85ebca6b) ^ Math.imul(y | 0, 0xc2b2ae35) ^ Math.imul(z | 0, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Integer seed from any seed value. */
export const seedNum = (seed: string | number) => (typeof seed === "number" ? seed | 0 : hash(seed));
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/* ---------------- shared material colors ---------------- */
export const COL = {
  plaster: 0xf1e2bd,
  plasterLo: 0xe2cfa2,
  timber: 0x6d4a31,
  timberDk: 0x533625,
  stone: 0x9c9a90,
  stoneLo: 0x86847b,
  stoneHi: 0xb3b1a6,
  door: 0x452f1f,
  dark: 0x2f2013,
  brick: 0x8a5548,
  brickLo: 0x744538,
  window: 0xffe9a8,
  red: 0xc75146,
  gold: 0xd9a441,
} as const;

export const FLOWERS = [0xe86a6a, 0xf2c94c, 0xe88ab8, 0xf5f0e0, 0x9ad1f5, 0xd97b4f];

/* ---------------- language roof palettes ---------------- */
export interface RoofPalette {
  roof: number;
  roofLo: number;
  accent: number;
}

const LANG: Record<string, RoofPalette> = {
  typescript: { roof: 0x6e93b8, roofLo: 0x56789c, accent: 0x46628a },
  javascript: { roof: 0xdfa94b, roofLo: 0xbd8832, accent: 0x9c6f22 },
  python: { roof: 0x83ab60, roofLo: 0x68904a, accent: 0x4f7a3a },
  test: { roof: 0xa98fce, roofLo: 0x8d73b3, accent: 0x715a96 },
  config: { roof: 0x8f8f8f, roofLo: 0x757575, accent: 0x5c5c5c },
  default: { roof: 0xb98b5a, roofLo: 0x9c7146, accent: 0x7c5836 },
};

export function shiftHue(hex: number, dh: number): number {
  const c = new THREE.Color(hex);
  c.offsetHSL(dh, 0, 0);
  return c.getHex();
}

/** Per-district hue drift keeps same-language districts from looking cloned. */
export function langPal(lang: string, isTest: boolean, isConfig: boolean, districtSeed: number): RoofPalette {
  const base = isConfig ? LANG.config : isTest ? LANG.test : (LANG[lang] ?? LANG.default);
  const dh = (rnd(districtSeed + ":hue") - 0.5) * 0.09;
  return {
    roof: shiftHue(base.roof, dh),
    roofLo: shiftHue(base.roofLo, dh),
    accent: shiftHue(base.accent, dh),
  };
}

/* ---------------- sky / lighting themes ---------------- */
export interface Theme {
  skyTop: number;
  skyBot: number;
  sun: number;
  sunInt: number;
  hemiSky: number;
  hemiGnd: number;
  hemiInt: number;
  sunDir: [number, number, number];
  /** brightness multiplier for glowing windows */
  windows: number;
  /** lamp halo opacity 0..1 */
  lamps: number;
  /** star density 0..1 */
  stars: number;
  smoke: number;
}

export const THEMES: Record<string, Theme> = {
  dawn: { skyTop: 0x7f9cc9, skyBot: 0xf7c8a0, sun: 0xffd9b4, sunInt: 1.6, hemiSky: 0xffe3cc, hemiGnd: 0x7a6f57, hemiInt: 1.15, sunDir: [0.9, 0.42, -0.25], windows: 1.0, lamps: 0.45, stars: 0, smoke: 0xd8d0c8 },
  day: { skyTop: 0x74b6d8, skyBot: 0xbfe3ee, sun: 0xfff3da, sunInt: 1.9, hemiSky: 0xeaf4ff, hemiGnd: 0x8a9a6a, hemiInt: 1.35, sunDir: [0.45, 1.1, 0.35], windows: 0.9, lamps: 0, stars: 0, smoke: 0xe8e8e8 },
  dusk: { skyTop: 0x6a5a8e, skyBot: 0xf0965e, sun: 0xffb37a, sunInt: 1.5, hemiSky: 0xf5c9a0, hemiGnd: 0x6a5a48, hemiInt: 0.95, sunDir: [-0.95, 0.35, 0.3], windows: 1.15, lamps: 0.85, stars: 0.25, smoke: 0xcabcb0 },
  night: { skyTop: 0x0d1322, skyBot: 0x1d2a48, sun: 0x9fb6e8, sunInt: 0.62, hemiSky: 0x44557c, hemiGnd: 0x1e2636, hemiInt: 0.62, sunDir: [0.3, 0.9, -0.4], windows: 1.35, lamps: 1, stars: 1, smoke: 0x77808e },
};

export type ThemeName = keyof typeof THEMES;
