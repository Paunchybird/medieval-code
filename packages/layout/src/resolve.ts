import path from "node:path";

const JS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function tryFiles(base: string, known: Set<string>): string | null {
  const clean = path.posix.normalize(base);
  if (known.has(clean)) return clean;
  // "./foo.js" in TypeScript ESM source points at foo.ts
  const stripped = clean.replace(/\.(m?js|cjs|jsx)$/, "");
  for (const ext of JS_EXTS) {
    if (known.has(stripped + ext)) return stripped + ext;
  }
  for (const ext of JS_EXTS) {
    const idx = path.posix.join(clean, "index" + ext);
    if (known.has(idx)) return idx;
  }
  return null;
}

/** Index of python module paths ("pkg/mod") to files, built once per known-set. */
const pyIndexCache = new WeakMap<Set<string>, Map<string, string>>();
function pythonIndex(known: Set<string>): Map<string, string> {
  let idx = pyIndexCache.get(known);
  if (idx) return idx;
  idx = new Map();
  for (const f of known) {
    if (!f.endsWith(".py")) continue;
    const mod = f.endsWith("/__init__.py") ? f.slice(0, -"/__init__.py".length) : f.slice(0, -3);
    idx.set(mod, f);
  }
  pyIndexCache.set(known, idx);
  return idx;
}

function resolvePython(fromFile: string, spec: string, known: Set<string>): string | null {
  const idx = pythonIndex(known);
  const dots = /^\.+/.exec(spec)?.[0].length ?? 0;
  if (dots > 0) {
    let dir = path.posix.dirname(fromFile);
    for (let i = 1; i < dots; i++) dir = path.posix.dirname(dir);
    const rest = spec.slice(dots).replace(/\./g, "/");
    const mod = path.posix.normalize(rest ? path.posix.join(dir, rest) : dir);
    return idx.get(mod === "." ? "" : mod) ?? null;
  }
  const mod = spec.replace(/\./g, "/");
  // absolute import: from the repo root, from the importing file's folder
  // (scripts run in place), or from any source root that ends with it
  // ("src/pkg/mod" for a "pkg.mod" import).
  const local = path.posix.join(path.posix.dirname(fromFile), mod);
  if (idx.has(mod)) return idx.get(mod)!;
  if (idx.has(local)) return idx.get(local)!;
  for (const [m, f] of idx) if (m.endsWith("/" + mod)) return f;
  // "from pkg.mod import name" may name a module attribute: drop the tail
  const parent = mod.includes("/") ? mod.slice(0, mod.lastIndexOf("/")) : "";
  if (parent && idx.has(parent)) return idx.get(parent)!;
  return null;
}

export interface ImportAlias {
  /** "@/*", "@scope/pkg", "@scope/pkg/*": at most one `*` */
  pattern: string;
  /** repo-relative targets, `*` replaced by what the pattern's `*` matched */
  targets: string[];
}

function matchAlias(spec: string, a: ImportAlias): string | null {
  const star = a.pattern.indexOf("*");
  if (star < 0) return spec === a.pattern ? "" : null;
  const pre = a.pattern.slice(0, star), post = a.pattern.slice(star + 1);
  if (spec.length < pre.length + post.length || !spec.startsWith(pre) || !spec.endsWith(post)) return null;
  return spec.slice(pre.length, spec.length - post.length);
}

/**
 * Resolves an import specifier to a repo-relative source file, or null for
 * external packages and files outside the scan. Non-relative JS/TS imports
 * go through `aliases` (tsconfig paths, workspace package names).
 */
export function resolveImportTarget(
  fromFile: string,
  spec: string,
  language: string,
  known: Set<string>,
  aliases: ImportAlias[] = [],
): string | null {
  if (language === "python") return resolvePython(fromFile, spec, known);
  if (spec.startsWith(".")) return tryFiles(path.posix.join(path.posix.dirname(fromFile), spec), known);
  // the most specific (longest) pattern wins, as in TypeScript
  const ordered = [...aliases].sort((a, b) => b.pattern.length - a.pattern.length);
  for (const a of ordered) {
    const m = matchAlias(spec, a);
    if (m === null) continue;
    for (const t of a.targets) {
      const hit = tryFiles(t.replace("*", m), known);
      if (hit) return hit;
    }
  }
  return null;
}
