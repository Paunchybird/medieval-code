import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Construct, Rect, TownModel } from "@medieval-code/model";
import { voxelFootprint, layoutCompound, COMPOUND_PAD } from "@medieval-code/model";
import { discoverAliases, parseFiles, walkCodebase } from "@medieval-code/parser";
import fs from "node:fs";
import os from "node:os";
import { buildTownModel, packDistricts, resolveImportTarget, districtKey, DISTRICT_GAP_Z } from "@medieval-code/layout";

const FIXTURE = fileURLToPath(new URL("./fixtures/kingdom", import.meta.url));
const REPO = fileURLToPath(new URL("..", import.meta.url));

function town(root: string): TownModel {
  const w = walkCodebase({ root });
  return buildTownModel(parseFiles(w.files, root), { root });
}

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a: Rect, b: Rect) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/** Every structural guarantee the viewer relies on. */
function checkTown(t: TownModel) {
  const ds = t.districts;
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      expect(overlap(ds[i].bounds, ds[j].bounds), `${ds[i].id} overlaps ${ds[j].id}`).toBe(false);
    }
  }
  for (const d of ds) {
    // walls snap to the 16px tile grid
    expect(d.bounds.x % 16).toBe(0);
    expect(d.bounds.y % 16).toBe(0);
    const rows = d.neighborhoods.map((n) => n.row);
    for (const n of d.neighborhoods) {
      expect(inside(n.row, d.bounds), `${n.file} row outside ${d.id}`).toBe(true);
      const sprites = n.constructs.map((c) => c.sprite);
      for (const c of n.constructs) {
        expect(inside(c.sprite, n.row), `${c.name} outside ${n.file}`).toBe(true);
        // the sprite reserves exactly the voxel footprint the viewer builds
        const f = voxelFootprint(c);
        expect(c.sprite.w).toBe(f.fw * 16);
        expect(c.sprite.h).toBe(f.fd * 16);
      }
      for (let i = 0; i < sprites.length; i++)
        for (let j = i + 1; j < sprites.length; j++)
          expect(overlap(sprites[i], sprites[j]), `${n.file}: buildings ${i} and ${j} overlap`).toBe(false);
    }
    for (let i = 0; i < rows.length; i++)
      for (let j = i + 1; j < rows.length; j++) expect(overlap(rows[i], rows[j])).toBe(false);
  }
  // districts of one row share their south wall (gates open onto one avenue)
  const bottoms = new Map<number, number>();
  for (const d of ds) bottoms.set(d.bounds.y + d.bounds.h, (bottoms.get(d.bounds.y + d.bounds.h) ?? 0) + 1);
  const rowTops = [...new Set(ds.map((d) => d.bounds.y + d.bounds.h))].sort((a, b) => a - b);
  for (let i = 1; i < rowTops.length; i++) {
    const nextRow = ds.filter((d) => d.bounds.y + d.bounds.h === rowTops[i]);
    for (const d of nextRow) expect(d.bounds.y).toBeGreaterThanOrEqual(rowTops[i - 1] + DISTRICT_GAP_Z);
  }
}

describe("town layout", () => {
  it("lays out the fixture without overlaps", () => {
    const t = town(FIXTURE);
    expect(t.districts.map((d) => d.id).sort()).toEqual(["src/api", "src/core", "tests", "tools", "tools/pkg"]);
    checkTown(t);
  });

  it("lays out this repository without overlaps", () => {
    checkTown(town(REPO));
  });

  it("is deterministic apart from the timestamp", () => {
    const a = town(FIXTURE);
    const b = town(FIXTURE);
    a.meta.generatedAt = b.meta.generatedAt = "";
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("resolves file imports for TypeScript and Python", () => {
    const t = town(FIXTURE);
    const edges = (t.fileEdges ?? []).map((e) => `${e.from} -> ${e.to}`).sort();
    expect(edges).toEqual([
      "src/api/server.ts -> src/api/types.ts",
      "src/api/server.ts -> src/core/engine.ts",
      "src/api/server.ts -> src/core/math.ts",
      "src/core/engine.ts -> src/api/types.ts",
      "src/core/engine.ts -> src/core/math.ts",
      "tests/engine.test.ts -> src/core/engine.ts",
      "tools/cli.py -> tools/pkg/__init__.py",
      "tools/cli.py -> tools/pkg/stats.py",
      "tools/pkg/stats.py -> tools/pkg/util.py",
    ]);
    // district edges aggregate file edges between different districts
    const d = t.edges.map((e) => `${e.from}->${e.to}:${e.weight}`).sort();
    expect(d).toEqual([
      "src/api->src/core:2",
      "src/core->src/api:1",
      "tests->src/core:1",
      "tools->tools/pkg:2",
    ]);
  });
});

describe("district packing", () => {
  it("keeps rows centred, bottom-aligned and roughly 3:2", () => {
    const sizes = Array.from({ length: 9 }, (_, i) => ({ w: 160 + (i % 3) * 64, h: 128 + (i % 4) * 48 }));
    const placed = packDistricts(sizes);
    const rows = new Map<number, number[]>();
    placed.forEach((p, i) => rows.set(p.row, [...(rows.get(p.row) ?? []), i]));
    expect(rows.size).toBeGreaterThan(1);
    for (const idx of rows.values()) {
      const bottoms = idx.map((i) => placed[i].y + sizes[i].h);
      expect(new Set(bottoms).size).toBe(1);
    }
    const W = Math.max(...placed.map((p, i) => p.x + sizes[i].w));
    const H = Math.max(...placed.map((p, i) => p.y + sizes[i].h));
    expect(W / H).toBeGreaterThan(0.9);
    expect(W / H).toBeLessThan(3);
  });

  it("handles a single district and no districts", () => {
    expect(packDistricts([])).toEqual([]);
    expect(packDistricts([{ w: 100, h: 80 }])).toEqual([{ x: 0, y: 0, row: 0 }]);
  });
});

describe("import resolution", () => {
  const known = new Set(["src/a.ts", "src/b/index.ts", "src/c.tsx", "lib/x.js", "py/pkg/__init__.py", "py/pkg/mod.py", "py/app.py", "src/pkg2/deep.py"]);
  it.each([
    ["src/a.ts", "./b", "typescript", "src/b/index.ts"],
    ["src/a.ts", "./c.js", "typescript", "src/c.tsx"],
    ["src/b/index.ts", "../a.js", "typescript", "src/a.ts"],
    ["src/a.ts", "../lib/x.js", "typescript", "lib/x.js"],
    ["src/a.ts", "react", "typescript", null],
    ["src/a.ts", "./missing", "typescript", null],
    ["py/app.py", "pkg.mod", "python", "py/pkg/mod.py"],
    ["py/app.py", "pkg", "python", "py/pkg/__init__.py"],
    ["py/pkg/mod.py", ".", "python", "py/pkg/__init__.py"],
    ["py/pkg/mod.py", "..app", "python", "py/app.py"],
    ["py/app.py", "pkg2.deep", "python", "src/pkg2/deep.py"],
    ["py/app.py", "numpy", "python", null],
  ])("%s imports %s (%s)", (from, spec, lang, want) => {
    expect(resolveImportTarget(from, spec, lang, known)).toBe(want);
  });

  it("follows tsconfig paths and workspace package names", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-alias-"));
    const put = (f: string, body: string) => {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), body);
    };
    put("tsconfig.json", '{ // comments are allowed\n "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"], }, }, }');
    put("src/app.ts", 'import { a } from "@/lib/a";\nimport { b } from "@acme/b";\nimport { c } from "@acme/b/util/c";\nimport x from "lodash";');
    put("src/lib/a.ts", "export const a = 1;");
    put("packages/b/package.json", '{ "name": "@acme/b" }');
    put("packages/b/src/index.ts", "export const b = 1;");
    put("packages/b/src/util/c.ts", "export const c = 1;");
    const w = walkCodebase({ root: dir });
    const aliases = discoverAliases(dir, w.files);
    expect(aliases.map((a) => a.pattern).sort()).toEqual(["@/*", "@acme/b", "@acme/b/*"]);
    const t = buildTownModel(parseFiles(w.files, dir), { root: dir, aliases });
    expect((t.fileEdges ?? []).map((e) => `${e.from} -> ${e.to}`).sort()).toEqual([
      "src/app.ts -> packages/b/src/index.ts",
      "src/app.ts -> packages/b/src/util/c.ts",
      "src/app.ts -> src/lib/a.ts",
    ]);
  });

  it("names districts after the first two folders", () => {
    expect(districtKey("a.ts")).toBe("root");
    expect(districtKey("src/a.ts")).toBe("src");
    expect(districtKey("src/x/y/z.ts")).toBe("src/x");
  });
});

describe("courtyards", () => {
  it("fits children in at most two rows inside the padding", () => {
    const kids = [{ fw: 5, fd: 4 }, { fw: 7, fd: 5 }, { fw: 3, fd: 3 }, { fw: 5, fd: 4 }, { fw: 9, fd: 8 }];
    const c = layoutCompound(kids);
    const zs = new Set(c.slots.map((s, i) => s.z + kids[i].fd));
    expect(zs.size).toBeLessThanOrEqual(2);
    c.slots.forEach((s, i) => {
      expect(s.x).toBeGreaterThanOrEqual(COMPOUND_PAD - 1);
      expect(s.x + kids[i].fw).toBeLessThanOrEqual(c.fw - COMPOUND_PAD + 1);
      expect(s.z + kids[i].fd).toBeLessThanOrEqual(c.fd - COMPOUND_PAD);
    });
    for (let i = 0; i < kids.length; i++)
      for (let j = i + 1; j < kids.length; j++) {
        const a = { x: c.slots[i].x, y: c.slots[i].z, w: kids[i].fw, h: kids[i].fd };
        const b = { x: c.slots[j].x, y: c.slots[j].z, w: kids[j].fw, h: kids[j].fd };
        expect(overlap(a, b)).toBe(false);
      }
  });

  it("gives every construct type a footprint", () => {
    const types: Construct["type"][] = ["castle", "house", "factory", "church", "cathedral", "tower", "shop", "bridge", "flag", "decor", "tenement", "townhall", "training"];
    for (const type of types) {
      const f = voxelFootprint({ type, metrics: { loc: 10 } });
      expect(f.fw).toBeGreaterThan(0);
      expect(f.fd).toBeGreaterThan(0);
    }
  });
});
