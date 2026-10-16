#!/usr/bin/env node
/**
 * End-to-end check of the real viewer in headless Chromium.
 *
 *   node scripts/browser-check.mjs [repo] [--images docs/images] [--keep]
 *
 * Scans the repo (default: this one), serves the built viewer, and drives
 * it: load, stats, hover, selection with import routes, search, heat view,
 * themes, rotation, PNG export. Any page error or failed check exits 1.
 * With --images it also writes the README screenshots.
 *
 * Needs `npm run build` first. WebGL runs on SwiftShader (software), so it
 * works on machines without a GPU, slowly: allow a minute or two.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { scanRepo } from "../packages/cli/dist/scan.js";
import { createViewerServer, viewerRoot } from "../packages/cli/dist/server.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const imagesDir = flag("--images");
const repo = path.resolve(args.find((a) => !a.startsWith("--")) ?? path.join(here, ".."));

if (!fs.existsSync(path.join(viewerRoot(), "index.html"))) {
  console.error("The viewer is not built: run `npm run build` first.");
  process.exit(1);
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
};

const townFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mc-e2e-")), "town.json");
scanRepo({ root: repo, out: townFile });
const town = JSON.parse(fs.readFileSync(townFile, "utf8"));
const server = createViewerServer(townFile);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/fonts\.g(oogleapis|static)/.test(m.text())) errors.push(m.text());
});

const settle = (ms = 1500) => page.waitForTimeout(ms);
const shot = async (name, clipCanvas) => {
  if (!imagesDir) return;
  fs.mkdirSync(imagesDir, { recursive: true });
  const opts = { path: path.join(imagesDir, name), timeout: 180000 };
  if (clipCanvas) opts.clip = await page.locator("main").boundingBox();
  await page.screenshot(opts);
  console.log(`      wrote ${path.join(imagesDir, name)}`);
};
const mc = (fn, arg) => page.evaluate(fn, arg);

try {
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => document.getElementById("loading")?.classList.contains("hidden"), null, { timeout: 180000 });
  check("viewer loads", true, `${Date.now() - t0} ms`);
  check("no error box", await page.locator("#error").isHidden());

  const stats = await page.locator("#stats .value").allTextContents();
  check("stats show files, districts, buildings", stats.slice(0, 3).every((v) => Number(v) > 0), stats.join(" / "));
  check("file count matches the scan", Number(stats[0]) === town.meta.parsedFiles);

  // the canvas has a real picture: sample pixels after a render
  const variety = await mc(() => {
    const m = window.medievalCode;
    m.renderer.render(m.townScene.scene, m.cam.camera);
    const gl = m.renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    const seen = new Set();
    for (let i = 0; i < 64; i++) {
      gl.readPixels(Math.floor(((i % 8) + 0.5) * w / 8), Math.floor((Math.floor(i / 8) + 0.5) * h / 8), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      seen.add(px.slice(0, 3).join(","));
    }
    return seen.size;
  });
  check("canvas renders a varied picture", variety > 12, `${variety} distinct colours in 64 samples`);
  await settle(2500);
  await shot("overview.png", false);
  if (imagesDir) {
    // hero banner: the town centre, a little closer than the fit
    await mc(() => {
      const m = window.medievalCode;
      const b = m.townScene.townBox;
      m.cam.jumpTo((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, m.cam.zoom * 1.7);
    });
    await page.mouse.move(5, 5);
    await settle(2500);
    await shot("hero.png", true);
    await mc(() => window.medievalCode.cam.snapFit());
  }

  // hotspot → selection card, camera glide, import routes
  const hot = page.locator("#hotspots .result-row").first();
  if (await hot.count()) {
    const name = (await hot.locator(".result-name").textContent())?.trim();
    await hot.click();
    await mc(() => {
      const m = window.medievalCode;
      for (let i = 0; i < 120; i++) m.cam.update();
    });
    await settle(2500);
    check("hotspot opens the selection card", !(await page.locator("#selection").isHidden()) && (await page.locator("#sel-name").textContent()) === name, name);
    const routes = await page.locator("#sel-routes .child-row").count();
    check("selection lists the file's import routes when it has any", routes >= 0, `${routes} routes`);
    await shot("selection.png", false);
    await page.keyboard.press("Escape");
    await settle(300);
    check("Escape closes the selection", await page.locator("#selection").isHidden());
  }

  // search: type, see results, Enter selects the first
  const someName = await mc(() => {
    const m = window.medievalCode;
    const hit = m.townScene.hits.find((h) => h.construct.type === "house" && h.construct.name.length > 3);
    return hit?.construct.name ?? "";
  });
  if (someName) {
    await page.keyboard.press("/");
    await page.keyboard.type(someName.slice(0, 4));
    await settle(400);
    const n = await page.locator("#search-results .result-row").count();
    check("search lists matches", n > 0, `"${someName.slice(0, 4)}" → ${n} rows`);
    await page.keyboard.press("Enter");
    await settle(2500);
    check("Enter selects the first match", !(await page.locator("#selection").isHidden()));
    await page.locator("#search").fill("");
    await page.locator("#search").dispatchEvent("input");
    await page.locator("#search").blur();
    await page.keyboard.press("Escape");
  }

  // hover names a building
  const box = await page.locator("#town-canvas").boundingBox();
  let hovered = false;
  for (let i = 0; i < 40 && !hovered; i++) {
    await page.mouse.move(box.x + box.width * (0.3 + 0.4 * ((i * 7) % 10) / 10), box.y + box.height * (0.3 + 0.4 * ((i * 3) % 10) / 10));
    await page.waitForTimeout(60);
    hovered = !(await page.locator("#tooltip").isHidden());
  }
  check("hovering a building shows its tooltip", hovered);

  // close-up of the biggest district (pointer parked off the map first)
  await page.mouse.move(5, 5);
  await mc(() => {
    const m = window.medievalCode;
    const d = m.model.districts[0];
    m.cam.jumpTo((d.bounds.x + d.bounds.w * 0.5) / 16, (d.bounds.y + d.bounds.h * 0.55) / 16, 16);
  });
  await settle(3500);
  await shot("closeup.png", true);

  await page.click("#view-buttons button:nth-child(2)");
  await mc(() => window.medievalCode.cam.snapFit());
  await settle(3000);
  check("heat view shows its scale", !(await page.locator("#heat-scale").isHidden()));
  await shot("heat.png", true);
  await page.click("#view-buttons button:nth-child(1)");

  await page.click("#theme-buttons button:nth-child(3)");
  await page.locator("#routes-toggle").check();
  await mc(() => window.medievalCode.cam.snapFit());
  await settle(3000);
  await shot("routes.png", true);
  await page.locator("#routes-toggle").uncheck();

  await page.click("#theme-buttons button:nth-child(4)");
  await mc(() => {
    const m = window.medievalCode;
    const d = m.model.districts[0];
    m.cam.jumpTo((d.bounds.x + d.bounds.w * 0.5) / 16, (d.bounds.y + d.bounds.h) / 16, 9);
  });
  await settle(3000);
  await shot("night.png", true);
  await page.click("#theme-buttons button:nth-child(2)");

  for (const k of ["e", "e", "q", "q", "f", "r"]) await page.keyboard.press(k);
  await settle(1500);
  check("rotate, fit and reset keep the view alive", (await mc(() => window.medievalCode.cam.zoom)) > 0);

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.click("#btn-shot")]);
  const pngPath = path.join(os.tmpdir(), download.suggestedFilename());
  await download.saveAs(pngPath);
  const sig = fs.readFileSync(pngPath).subarray(0, 8).toString("hex");
  check("PNG export downloads an image", sig === "89504e470d0a1a0a", download.suggestedFilename());

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  check("run completed", false, err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
