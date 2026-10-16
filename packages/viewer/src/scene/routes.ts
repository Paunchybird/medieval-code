import * as THREE from "three";
import type { TownModel } from "@medieval-code/model";
import type { ThemeName } from "./palette.js";

/**
 * Import routes. Imports are drawn as arcs through the sky rather than roads
 * on the ground, so they never cut through walls or buildings:
 *
 * - the overview shows one arc per district pair (thicker = more imports),
 * - focusing a file shows its own routes: gold arcs to the files it imports,
 *   blue arcs from the files that import it.
 *
 * Little carts travel each arc from the importing file towards the file it
 * depends on, so the direction reads without arrowheads.
 */

export const OUT_COLOR = 0xf2c94c; // this file imports …
export const IN_COLOR = 0x6cc3f0; // … is imported by
const OVERVIEW_COLOR = 0xe8b04a;

interface Arc {
  curve: THREE.QuadraticBezierCurve3;
  mesh: THREE.Mesh;
  from: string;
  to: string;
  carts: number;
  speed: number;
  phase: number;
}

export interface FocusInfo {
  imports: string[];
  importedBy: string[];
}

export interface RouteSystem {
  /** number of resolved file-to-file imports */
  fileRouteCount: number;
  /** district-level arcs over the whole town */
  showOverview(on: boolean): void;
  /** show one file's routes (null clears); returns its neighbours */
  focusFile(file: string | null): FocusInfo;
  importsOf(file: string): string[];
  importedBy(file: string): string[];
  setVisibleDistricts(ids: Set<string>): void;
  setTheme(name: ThemeName): void;
  animate(t: number): void;
}

function arcCurve(a: THREE.Vector3, b: THREE.Vector3, lift: number): THREE.QuadraticBezierCurve3 {
  const dist = a.distanceTo(b);
  const h = Math.max(lift, Math.min(46, dist * 0.32));
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y = Math.max(a.y, b.y) + h * 2; // control point: the curve peaks at h
  return new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
}

export function createRoutes(
  scene: THREE.Scene,
  model: TownModel,
  fileAnchors: Map<string, THREE.Vector3>,
  fileDistrict: Map<string, string>,
  glowTex: THREE.Texture,
): RouteSystem {
  const group = new THREE.Group();
  scene.add(group);
  const overviewGroup = new THREE.Group();
  const focusGroup = new THREE.Group();
  group.add(overviewGroup, focusGroup);

  const fileEdges = (model.fileEdges ?? []).filter((e) => fileAnchors.has(e.from) && fileAnchors.has(e.to));
  const outMap = new Map<string, string[]>();
  const inMap = new Map<string, string[]>();
  for (const e of fileEdges) {
    if (!outMap.has(e.from)) outMap.set(e.from, []);
    outMap.get(e.from)!.push(e.to);
    if (!inMap.has(e.to)) inMap.set(e.to, []);
    inMap.get(e.to)!.push(e.from);
  }

  // district anchors: the middle of the district, a little above the roofs
  const districtAnchor = new Map<string, THREE.Vector3>();
  for (const d of model.districts) {
    districtAnchor.set(d.id, new THREE.Vector3((d.bounds.x + d.bounds.w / 2) / 16, 4, (d.bounds.y + d.bounds.h / 2) / 16));
  }

  const overviewMat = new THREE.MeshBasicMaterial({ color: OVERVIEW_COLOR, transparent: true, opacity: 0.8, depthWrite: false });
  const outMat = new THREE.MeshBasicMaterial({ color: OUT_COLOR, transparent: true, opacity: 0.92 });
  const inMat = new THREE.MeshBasicMaterial({ color: IN_COLOR, transparent: true, opacity: 0.92 });

  const overview: Arc[] = [];
  for (const e of model.edges) {
    const a = districtAnchor.get(e.from);
    const b = districtAnchor.get(e.to);
    if (!a || !b) continue;
    const curve = arcCurve(a, b, 10);
    const radius = 0.24 + 0.1 * Math.log2(e.weight + 1);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, radius, 5, false), overviewMat);
    overviewGroup.add(mesh);
    overview.push({ curve, mesh, from: e.from, to: e.to, carts: Math.min(3, 1 + Math.floor(Math.log2(e.weight))), speed: 0.0028, phase: (overview.length * 0.37) % 1 });
  }
  overviewGroup.visible = false;

  let focus: Arc[] = [];
  const endRings: THREE.Mesh[] = [];

  // carts: one instanced mesh for every visible arc; halos glow at night
  const MAX_CARTS = 400;
  const cartGeo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
  const carts = new THREE.InstancedMesh(cartGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_CARTS);
  carts.count = 0;
  carts.frustumCulled = false;
  group.add(carts);



  let visibleDistricts: Set<string> | null = null;
  const arcVisible = (a: Arc, fileLevel: boolean) => {
    if (!visibleDistricts) return true;
    const df = fileLevel ? fileDistrict.get(a.from) : a.from;
    const dt = fileLevel ? fileDistrict.get(a.to) : a.to;
    return !!df && !!dt && visibleDistricts.has(df) && visibleDistricts.has(dt);
  };

  function clearFocus() {
    for (const a of focus) {
      a.mesh.geometry.dispose();
      focusGroup.remove(a.mesh);
    }
    for (const r of endRings) {
      r.geometry.dispose();
      focusGroup.remove(r);
    }
    focus = [];
    endRings.length = 0;
  }

  function ring(at: THREE.Vector3, color: number) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 2.3, 4, 1).rotateX(-Math.PI / 2).rotateY(Math.PI / 4),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
    );
    m.position.set(at.x, 0.12, at.z);
    focusGroup.add(m);
    endRings.push(m);
  }

  function focusFile(file: string | null): FocusInfo {
    clearFocus();
    if (!file || !fileAnchors.has(file)) return { imports: [], importedBy: [] };
    const imports = outMap.get(file) ?? [];
    const importedBy = inMap.get(file) ?? [];
    const here = fileAnchors.get(file)!.clone().setY(1);
    const add = (from: string, to: string, mat: THREE.Material, color: number, other: string) => {
      const a = fileAnchors.get(from)!.clone().setY(1);
      const b = fileAnchors.get(to)!.clone().setY(1);
      const curve = arcCurve(a, b, 7);
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 36, 0.24, 5, false), mat);
      focusGroup.add(mesh);
      focus.push({ curve, mesh, from, to, carts: 2, speed: 0.004, phase: (focus.length * 0.29) % 1 });
      ring(fileAnchors.get(other)!, color);
    };
    for (const to of imports) add(file, to, outMat, OUT_COLOR, to);
    for (const from of importedBy) add(from, file, inMat, IN_COLOR, from);
    if (imports.length + importedBy.length > 0) ring(here, 0xffffff);
    return { imports, importedBy };
  }

  const m4 = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const col = new THREE.Color();

  function animate(t: number) {
    let n = 0;
    const lists: [Arc[], boolean, number][] = [];
    if (overviewGroup.visible) lists.push([overview, false, 0xfff1c4]);
    lists.push([focus, true, 0xffffff]);
    for (const [arcs, fileLevel, c] of lists) {
      for (const a of arcs) {
        const vis = arcVisible(a, fileLevel);
        a.mesh.visible = vis;
        if (!vis) continue;
        for (let k = 0; k < a.carts && n < MAX_CARTS; k++) {
          const u = (t * a.speed + a.phase + k / a.carts) % 1;
          a.curve.getPoint(u, p);
          m4.makeTranslation(p.x, p.y, p.z);
          carts.setMatrixAt(n, m4);
          carts.setColorAt(n, col.set(c));
          n++;
        }
      }
    }
    carts.count = n;
    carts.instanceMatrix.needsUpdate = true;
    if (carts.instanceColor) carts.instanceColor.needsUpdate = true;
    // focus rings breathe so the eye finds them
    const s = 1 + 0.12 * Math.sin(t * 0.08);
    for (const r of endRings) r.scale.set(s, 1, s);
  }

  return {
    fileRouteCount: fileEdges.length,
    showOverview(on: boolean) {
      overviewGroup.visible = on;
    },
    focusFile,
    importsOf: (f) => outMap.get(f) ?? [],
    importedBy: (f) => inMap.get(f) ?? [],
    setVisibleDistricts(ids: Set<string>) {
      visibleDistricts = ids;
    },
    setTheme(name: ThemeName) {
      const night = name === "night";
      overviewMat.opacity = night ? 0.9 : 0.8;

    },
    animate,
  };
}
