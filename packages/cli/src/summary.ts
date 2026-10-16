import type { Construct, TownModel } from "@medieval-code/model";

export interface Hotspot {
  name: string;
  file: string;
  line: number;
  complexity: number;
  loc: number;
}

function walk(cs: Construct[], fn: (c: Construct) => void) {
  for (const c of cs) {
    fn(c);
    if (c.children) walk(c.children, fn);
  }
}

/** Counts and the most complex functions of a town, for the terminal. */
export function summarize(town: TownModel, top = 5) {
  let buildings = 0;
  const byType = new Map<string, number>();
  const hot: Hotspot[] = [];
  for (const d of town.districts)
    for (const n of d.neighborhoods)
      walk(n.constructs, (c) => {
        buildings++;
        byType.set(c.type, (byType.get(c.type) ?? 0) + 1);
        if (c.type === "house" || c.type === "training") {
          hot.push({ name: c.name, file: c.file, line: c.span.startLine, complexity: c.metrics.complexity ?? 1, loc: c.metrics.loc });
        }
      });
  hot.sort((a, b) => b.complexity - a.complexity || b.loc - a.loc);
  return {
    districts: town.districts.length,
    files: town.meta.parsedFiles,
    buildings,
    routes: town.fileEdges?.length ?? 0,
    byType,
    hotspots: hot.slice(0, top).filter((h) => h.complexity > 1),
  };
}

export function formatSummary(town: TownModel): string {
  const s = summarize(town);
  const lines = [
    `  ${s.districts} districts · ${s.files} files · ${s.buildings} buildings · ${s.routes} import routes`,
  ];
  if (town.meta.truncated) lines.push(`  (stopped at the file cap: raise it with --max-files)`);
  if (town.meta.skippedFiles) lines.push(`  (${town.meta.skippedFiles} generated or minified files left out)`);
  if (s.hotspots.length > 0) {
    lines.push("  Hotspots (most complex functions):");
    const w = Math.max(...s.hotspots.map((h) => h.name.length));
    for (const h of s.hotspots) lines.push(`    cx ${String(h.complexity).padStart(3)}  ${h.name.padEnd(w)}  ${h.file}:${h.line}`);
  }
  return lines.join("\n");
}
