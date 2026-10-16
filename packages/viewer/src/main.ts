import * as THREE from "three";
import type { TownModel } from "@medieval-code/model";
import { setupFilters } from "./filters.js";
import { typeMeaning, type HitTarget } from "./interaction.js";
import { clamp, THEMES, type ThemeName } from "./scene/palette.js";
import { RtsCamera } from "./scene/rts-camera.js";
import { buildTownScene, type TownScene, type ViewMode } from "./scene/town-scene.js";
import { el } from "./ui/dom.js";
import { Minimap } from "./ui/minimap.js";
import { Overlay } from "./ui/overlay.js";
import { renderChoice, renderHeatScale, renderHotspots, renderSearch, renderSelection, renderStats } from "./ui/panels.js";

const THEME_DEFS: { id: ThemeName; label: string; sw: string }[] = [
  { id: "dawn", label: "Dawn", sw: "#f2b28c" },
  { id: "day", label: "Day", sw: "#8ecae6" },
  { id: "dusk", label: "Dusk", sw: "#e8926a" },
  { id: "night", label: "Night", sw: "#1b2440" },
];
const VIEW_DEFS: { id: ViewMode; label: string; sw: string }[] = [
  { id: "town", label: "Town", sw: "#74a85a" },
  { id: "heat", label: "Heat", sw: "#d96a35" },
];

const params = new URLSearchParams(location.search);

async function loadTown(): Promise<TownModel> {
  const res = await fetch("/town.json");
  if (!res.ok) throw new Error("Failed to load town.json. Run: medieval-code scan <repo> --open");
  const model = (await res.json()) as TownModel;
  const theme = params.get("theme");
  if (theme && THEMES[theme]) model.meta.theme = theme as TownModel["meta"]["theme"];
  return model;
}

/** Everything the running viewer needs, created once the town has loaded. */
interface Viewer {
  model: TownModel;
  town: TownScene;
  cam: RtsCamera;
  renderer: THREE.WebGLRenderer;
}

function start(m: TownModel): Viewer {
  const container = document.querySelector("main")!;
  const canvas = el<HTMLCanvasElement>("town-canvas");
  const tooltip = el("tooltip");
  const zoomLabel = el("zoom-label");
  const overlay = new Overlay(el<HTMLCanvasElement>("overlay-canvas"));
  const minimap = new Minimap(el<HTMLCanvasElement>("minimap"));
  const raycaster = new THREE.Raycaster();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap; // hard shadows read as pixel art

  const tBuild = performance.now();
  const town = buildTownScene(m);
  console.info(`[medieval-code] raised ${town.stats.buildings} buildings in ${Math.round(performance.now() - tBuild)} ms`);

  const cam = new RtsCamera(Math.max(container.clientWidth, 1), Math.max(container.clientHeight, 1));
  cam.setBounds(town.bounds.minX, town.bounds.minZ, town.bounds.maxX, town.bounds.maxZ);
  cam.setFitBox(town.townBox.minX, town.townBox.minZ, town.townBox.maxX, town.townBox.maxZ);

  let theme: ThemeName = (m.meta.theme as ThemeName) ?? "day";
  let viewMode: ViewMode = params.get("view") === "heat" ? "heat" : "town";
  let pixelScale = 1;
  let motion = true;
  let labelsOn = true;
  let hover: HitTarget | null = null;
  let selected: HitTarget | null = null;
  let searchHits: HitTarget[] = [];
  let cssW = 800;
  let cssH = 600;

  /* ---------------- pixel pipeline ----------------
     Render at native resolution / pixelScale and let CSS stretch the canvas
     with image-rendering: pixelated. pixelScale is in device pixels: 1 =
     full native (HiDPI-crisp) resolution, larger values = chunky retro
     pixels with big fill-rate savings. */
  function resize() {
    cssW = Math.max(container.clientWidth, 1);
    cssH = Math.max(container.clientHeight, 1);
    renderer.setSize(Math.max(1, Math.round((cssW * dpr) / pixelScale)), Math.max(1, Math.round((cssH * dpr) / pixelScale)), false);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    overlay.resize(cssW, cssH, dpr);
    cam.resize(cssW, cssH);
  }

  /* ---------------- selection ---------------- */
  function select(hit: HitTarget | null) {
    selected = hit;
    const routes = town.routes.focusFile(hit ? hit.neighborhood.file : null);
    renderSelection(hit, routes, selectFile);
    town.marker.visible = !!hit;
    if (!hit) return;
    town.marker.position.set(hit.center.x, hit.top + 2, hit.center.z);
    // swing the camera over; zoom in enough to read a courtyard
    cam.glideTo(hit.center.x, hit.center.z, hit.children.length > 0 ? 10 : 0);
  }

  /** Jump to a file: select its first building (the import stall, usually). */
  function selectFile(file: string) {
    const first = town.hits.find((h) => h.neighborhood.file === file && h.construct.span.startLine >= 0);
    if (first) select(first);
    else {
      const a = town.fileAnchors.get(file);
      if (a) cam.glideTo(a.x, a.z, 8);
    }
  }

  /** Saves what the camera sees, labels included, as a PNG. */
  function savePng() {
    renderer.render(town.scene, cam.camera);
    overlay.draw(town, cam.camera, cam.zoom, labelsOn, selected ?? hover);
    const out = document.createElement("canvas");
    out.width = overlay.canvas.width;
    out.height = overlay.canvas.height;
    const ctx = out.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    ctx.drawImage(overlay.canvas, 0, 0);
    const name = (m.meta.root.split(/[\\/]/).filter(Boolean).pop() ?? "town") + "-medieval-code.png";
    out.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
  }

  /* ---------------- pointer + keyboard ---------------- */
  function pick(ev: PointerEvent): HitTarget | null {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    return town.pick(ndc, cam.camera, raycaster);
  }

  function setHover(hit: HitTarget | null, ev: PointerEvent | null) {
    if (hover !== hit) {
      hover = hit;
      town.setHover(hit);
      canvas.style.cursor = hit ? "pointer" : "grab";
    }
    if (!hover || !ev) {
      tooltip.hidden = true;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const c = hover.construct;
    tooltip.hidden = false;
    tooltip.style.left = `${Math.min(ev.clientX - rect.left + 16, cssW - 230)}px`;
    tooltip.style.top = `${ev.clientY - rect.top + 16}px`;
    el("tooltip-name").textContent = c.name;
    el("tooltip-meta").textContent =
      `${typeMeaning(c.type)} · cx ${c.metrics.complexity ?? 1} · ${c.file}:${c.span.startLine}` +
      (hover.nested ? ` · ${hover.nested} inside` : "");
  }

  let dragging = false;
  let moved = 0;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    moved = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
    canvas.classList.add("dragging");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return setHover(pick(e), e);
    moved += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
    cam.pan(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
  });
  canvas.addEventListener("pointerup", (e) => {
    dragging = false;
    canvas.classList.remove("dragging");
    if (moved < 6) select(pick(e));
  });
  canvas.addEventListener("pointerleave", () => setHover(null, null));
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    cam.zoomBy(e.deltaY < 0 ? 1.15 : 0.87);
  }, { passive: false });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.style.cursor = "grab";

  const KEYS: Record<string, () => void> = {
    ArrowLeft: () => cam.pan(14, 0),
    ArrowRight: () => cam.pan(-14, 0),
    ArrowUp: () => cam.pan(0, 14),
    ArrowDown: () => cam.pan(0, -14),
    q: () => cam.rotate(-1),
    e: () => cam.rotate(1),
    f: () => cam.fit(),
    r: () => cam.reset(),
    p: () => savePng(),
    Escape: () => select(null),
  };
  window.addEventListener("keydown", (e) => {
    const tag = (e.target as HTMLElement | null)?.tagName ?? "";
    if (tag === "INPUT" || tag === "TEXTAREA" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "/") {
      e.preventDefault();
      el<HTMLInputElement>("search").focus();
      return;
    }
    KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key]?.();
  });

  /* ---------------- sidebar ---------------- */
  function renderThemes() {
    renderChoice("theme-buttons", THEME_DEFS, theme, (id) => {
      theme = id;
      town.setTheme(theme);
      renderThemes();
    });
  }
  function renderViews() {
    renderChoice("view-buttons", VIEW_DEFS, viewMode, (id) => {
      viewMode = id;
      town.setViewMode(viewMode);
      renderHeatScale(viewMode === "heat");
      renderViews();
    });
  }
  town.setTheme(theme);
  town.setViewMode(viewMode);
  renderStats(town.stats);
  renderThemes();
  renderViews();
  renderHeatScale(viewMode === "heat");

  const filters = setupFilters(m, (f) => {
    town.applyFilters(f);
    searchHits = renderSearch(town.hits, f.search, select);
  });
  town.applyFilters(filters);
  renderHotspots(town.hits, select);

  const searchEl = el<HTMLInputElement>("search");
  searchEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && searchHits.length > 0) select(searchHits[0]);
    if (e.key === "Escape") {
      searchEl.value = "";
      searchEl.dispatchEvent(new Event("input"));
      searchEl.blur();
    }
  });

  const pixelRange = el<HTMLInputElement>("pixel-range");
  const pixelValue = el("pixel-value");
  pixelRange.value = String(pixelScale);
  pixelValue.textContent = `${pixelScale}px`;
  pixelRange.oninput = () => {
    pixelScale = clamp(Math.round(+pixelRange.value), 1, 6);
    pixelValue.textContent = `${pixelScale}px`;
    resize();
  };
  const motionToggle = el<HTMLInputElement>("motion-toggle");
  motionToggle.checked = motion;
  motionToggle.onchange = () => (motion = motionToggle.checked);
  const labelsToggle = el<HTMLInputElement>("labels-toggle");
  labelsToggle.checked = labelsOn;
  labelsToggle.onchange = () => (labelsOn = labelsToggle.checked);
  const routesToggle = el<HTMLInputElement>("routes-toggle");
  routesToggle.checked = params.get("routes") === "1";
  town.routes.showOverview(routesToggle.checked);
  routesToggle.onchange = () => town.routes.showOverview(routesToggle.checked);
  routesToggle.closest("label")!.hidden = m.edges.length === 0;

  el("close-selection").onclick = () => select(null);
  el("btn-fit").onclick = () => cam.fit();
  el("btn-shot").onclick = () => savePng();
  el("btn-rot-left").onclick = () => cam.rotate(-1);
  el("btn-rot-right").onclick = () => cam.rotate(1);
  minimap.canvas.addEventListener("click", (e) => {
    const p = minimap.toWorld(e.clientX, e.clientY);
    cam.glideTo(p.x, p.z);
  });

  resize();
  cam.snapFit();
  new ResizeObserver(() => resize()).observe(container);

  // ?q=name opens the town focused on the best match (shareable links)
  const q = params.get("q");
  if (q) {
    searchEl.value = q;
    searchEl.dispatchEvent(new Event("input"));
    if (searchHits.length > 0) setTimeout(() => select(searchHits[0]), 50);
  }

  /* ---------------- render loop ----------------
     With animations off, frames are drawn only when something changed (the
     camera moved, or the user did anything): an idle town costs no GPU time. */
  let t = 0;
  let lastZoomPct = 0;
  let dirty = true;
  let lastCamKey = "";
  for (const ev of ["pointermove", "pointerdown", "pointerup", "wheel", "keydown", "input", "change", "click"]) {
    document.addEventListener(ev, () => (dirty = true), { capture: true, passive: true });
  }
  window.addEventListener("resize", () => (dirty = true));
  function loop() {
    requestAnimationFrame(loop);
    t++;
    cam.update();
    const camKey = `${cam.target.x.toFixed(3)},${cam.target.z.toFixed(3)},${cam.zoom.toFixed(4)},${cam.yaw.toFixed(4)},${cssW}x${cssH}`;
    if (camKey !== lastCamKey) dirty = true;
    lastCamKey = camKey;
    if (!motion && !dirty) return;
    dirty = false;
    town.updateView(cam.camera, cam.target, cam.groundHalfSize(), cam.zoom);
    if (motion) town.animate(t, theme);
    renderer.render(town.scene, cam.camera);
    // hovering OR selecting a courtyard names everything inside it
    overlay.draw(town, cam.camera, cam.zoom, labelsOn, selected ?? hover);
    minimap.draw(m, town, cam.camera, selected);
    const pct = Math.round(cam.zoom * 16.7);
    if (pct !== lastZoomPct) {
      lastZoomPct = pct;
      zoomLabel.textContent = `${pct}%`;
    }
  }
  loop();

  return { model: m, town, cam, renderer };
}

loadTown()
  .then((m) => {
    const v = start(m);
    // console / headless-test handle
    (window as unknown as { medievalCode: unknown }).medievalCode = { model: v.model, townScene: v.town, cam: v.cam, renderer: v.renderer };
    el("loading").classList.add("hidden");
  })
  .catch((err) => {
    console.error(err);
    el("loading").classList.add("hidden");
    el("error").hidden = false;
    el("error-msg").textContent = "Could not raise the kingdom: " + (err instanceof Error ? err.message : String(err));
  });
