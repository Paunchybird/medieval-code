import fs from "node:fs";
import path from "node:path";

/**
 * A non-relative import prefix that points inside the repo: a tsconfig /
 * jsconfig `paths` entry ("@/*" → "src/*") or a workspace package
 * ("@scope/pkg" → "packages/pkg/src/index"). Targets are repo-relative and
 * may contain one `*`.
 */
export interface ImportAlias {
  pattern: string;
  targets: string[];
}

function readJson(file: string): any {
  try {
    // tsconfig allows comments and trailing commas
    const text = fs.readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'])\/\/.*$/gm, "$1")
      .replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const rel = (root: string, p: string) => path.relative(root, p).replace(/\\/g, "/") || ".";

/**
 * Finds the import aliases of a repo: `paths` in the root tsconfig.json or
 * jsconfig.json (following one level of `extends`), and the name of every
 * package.json that sits above a scanned source file (workspace packages).
 */
export function discoverAliases(root: string, files: string[]): ImportAlias[] {
  const aliases: ImportAlias[] = [];

  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const file = path.join(root, name);
    let cfg = readJson(file);
    if (!cfg) continue;
    let base = root;
    let opts = cfg.compilerOptions ?? {};
    if (!opts.paths && typeof cfg.extends === "string" && cfg.extends.startsWith(".")) {
      const parentFile = path.resolve(root, cfg.extends.endsWith(".json") ? cfg.extends : cfg.extends + ".json");
      const parent = readJson(parentFile);
      if (parent?.compilerOptions?.paths) {
        opts = parent.compilerOptions;
        base = path.dirname(parentFile);
      }
    }
    const baseUrl = path.resolve(base, opts.baseUrl ?? ".");
    for (const [pattern, targets] of Object.entries<string[]>(opts.paths ?? {})) {
      aliases.push({ pattern, targets: targets.map((t) => rel(root, path.resolve(baseUrl, t))) });
    }
    break;
  }

  // workspace packages: the nearest package.json above each source file
  const seen = new Set<string>();
  for (const f of files) {
    let dir = path.dirname(f);
    while (dir.startsWith(root) && dir !== root) {
      if (seen.has(dir)) break;
      seen.add(dir);
      const pkg = readJson(path.join(dir, "package.json"));
      if (pkg?.name) {
        const r = rel(root, dir);
        aliases.push({ pattern: pkg.name, targets: [`${r}/src/index`, `${r}/index`, `${r}/src/main`] });
        aliases.push({ pattern: `${pkg.name}/*`, targets: [`${r}/src/*`, `${r}/*`] });
        break;
      }
      dir = path.dirname(dir);
    }
  }
  return aliases;
}
