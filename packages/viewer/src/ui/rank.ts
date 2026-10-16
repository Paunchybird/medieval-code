import type { HitTarget } from "../interaction.js";

const cx = (h: HitTarget) => h.construct.metrics.complexity ?? 1;

/**
 * The most complex functions and test cases. Their score already includes
 * every loop and branch inside them, so nested buildings would only repeat it.
 */
export function rankHotspots(hits: HitTarget[], limit = 8): HitTarget[] {
  return hits
    .filter((h) => (h.construct.type === "house" || h.construct.type === "training") && cx(h) > 2)
    .sort((a, b) => cx(b) - cx(a) || b.construct.metrics.loc - a.construct.metrics.loc)
    .slice(0, limit);
}

/**
 * Buildings matching a search: exact names first, then prefixes, then
 * substrings of the name, then file-path matches; shorter names rank higher.
 */
export function rankSearch(hits: HitTarget[], query: string): HitTarget[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return hits
    .filter((h) => h.construct.name.toLowerCase().includes(q) || h.construct.file.toLowerCase().includes(q))
    .map((h) => {
      const n = h.construct.name.toLowerCase();
      return { h, score: n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 3 };
    })
    .sort((a, b) => a.score - b.score || a.h.construct.name.length - b.h.construct.name.length)
    .map((x) => x.h);
}
