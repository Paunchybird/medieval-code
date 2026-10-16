import { describe, expect, it } from "vitest";
import type { Construct } from "@medieval-code/model";
import type { HitTarget } from "../packages/viewer/src/interaction";
import { rankHotspots, rankSearch } from "../packages/viewer/src/ui/rank";

function hit(name: string, type: Construct["type"], complexity: number, loc = 10, file = "src/a.ts"): HitTarget {
  const construct = { name, type, file, span: { startLine: 1, endLine: loc }, metrics: { loc, complexity }, sprite: { x: 0, y: 0, w: 0, h: 0 } } as Construct;
  return { construct, neighborhood: { file, absPath: "/" + file, language: "typescript", isTest: false, isConfig: false }, district: {} as HitTarget["district"], center: { x: 0, z: 0 }, top: 0, nested: 0, children: [] };
}

describe("hotspots", () => {
  it("ranks functions and tests by complexity, then size, skipping calm code and non-callables", () => {
    const hits = [
      hit("calm", "house", 2),
      hit("big", "house", 9, 200),
      hit("small", "house", 9, 20),
      hit("loop", "factory", 30),
      hit("suite", "training", 12),
      hit("klass", "castle", 40),
    ];
    expect(rankHotspots(hits).map((h) => h.construct.name)).toEqual(["suite", "big", "small"]);
    expect(rankHotspots(hits, 1)).toHaveLength(1);
  });
});

describe("search", () => {
  const hits = [hit("parseFileHeader", "house", 1), hit("parse", "house", 1), hit("reparse", "house", 1), hit("Other", "castle", 1, 10, "src/parser/x.ts")];
  it("puts exact names first, then prefixes, then substrings, then file matches", () => {
    expect(rankSearch(hits, "parse").map((h) => h.construct.name)).toEqual(["parse", "parseFileHeader", "reparse", "Other"]);
  });
  it("is case-insensitive and empty for blank queries", () => {
    expect(rankSearch(hits, "PARSEFILE").map((h) => h.construct.name)).toEqual(["parseFileHeader"]);
    expect(rankSearch(hits, "   ")).toEqual([]);
  });
});
