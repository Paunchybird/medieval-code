import fs from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import type { ScanCaps } from "@medieval-code/model";
import { DEFAULT_CAPS } from "@medieval-code/model";

const SOURCE_EXTS = new Set([
  ".js", ".jsx", ".mjs", ".cjs",
  ".ts", ".tsx",
  ".py",
]);

const BUILTIN_IGNORE = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".medieval-code",
  "coverage",
  ".next",
  ".nuxt",
  "target",
];

export interface WalkOptions {
  root: string;
  caps?: Partial<ScanCaps>;
  includeGlobs?: string[];
  excludeGlobs?: string[];
}

export interface WalkResult {
  files: string[];
  totalFound: number;
  truncated: boolean;
  /** generated or minified files that were left out */
  skipped: string[];
}

/** Larger source files are almost always generated (bundles, vendored libs). */
const MAX_FILE_BYTES = 768 * 1024;

/**
 * Minified or bundled code turns into a town of nonsense (functions called
 * `r` on line 1), so it is left out: `*.min.js`, `*.bundle.js`, files with
 * very long average lines, and anything over MAX_FILE_BYTES.
 */
export function isGeneratedFile(absPath: string): boolean {
  const base = path.basename(absPath).toLowerCase();
  if (/\.(min|bundle)\.[cm]?js$/.test(base) || base.endsWith(".d.ts")) return true;
  let fd: number | undefined;
  try {
    const size = fs.statSync(absPath).size;
    if (size > MAX_FILE_BYTES) return true;
    fd = fs.openSync(absPath, "r");
    const buf = Buffer.alloc(Math.min(size, 64 * 1024));
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const sample = buf.subarray(0, n).toString("utf8");
    const lines = sample.split("\n").length;
    return sample.length > 4000 && sample.length / lines > 200;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function loadGitignore(root: string): Ignore {
  const ig = ignore();
  ig.add(BUILTIN_IGNORE);

  const gitignorePath = path.join(root, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    ig.add(fs.readFileSync(gitignorePath, "utf8"));
  }

  return ig;
}

function walkDir(
  dir: string,
  root: string,
  ig: Ignore,
  out: string[],
  caps: ScanCaps,
  skipped: string[],
): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (out.length >= caps.maxFiles) return true;

    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs).replace(/\\/g, "/");

    if (ig.ignores(rel) || ig.ignores(rel + "/")) continue;

    if (entry.isDirectory()) {
      const truncated = walkDir(abs, root, ig, out, caps, skipped);
      if (truncated) return true;
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SOURCE_EXTS.has(ext)) {
        if (isGeneratedFile(abs)) {
          skipped.push(rel);
          continue;
        }
        out.push(abs);
        if (out.length >= caps.maxFiles) return true;
      }
    }
  }

  return false;
}

export function walkCodebase(options: WalkOptions): WalkResult {
  const root = path.resolve(options.root);
  const caps: ScanCaps = { ...DEFAULT_CAPS, ...options.caps };
  const ig = loadGitignore(root);

  if (options.excludeGlobs?.length) {
    ig.add(options.excludeGlobs);
  }

  const files: string[] = [];
  const skipped: string[] = [];
  const truncated = walkDir(root, root, ig, files, caps, skipped);

  return {
    files,
    totalFound: files.length,
    truncated,
    skipped,
  };
}

export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".py") return "python";
  if (ext === ".ts" || ext === ".tsx") return "typescript";
  return "javascript";
}

export function isTestFile(relPath: string): boolean {
  const base = path.basename(relPath);
  return (
    /\.test\.[jt]sx?$/.test(base) ||
    /\.spec\.[jt]sx?$/.test(base) ||
    /_test\.py$/.test(base) ||
    /test_.*\.py$/.test(base) ||
    relPath.includes("/__tests__/") ||
    relPath.includes("/tests/")
  );
}

export function isConfigFile(relPath: string): boolean {
  const base = path.basename(relPath);
  const configs = new Set([
    "package.json", "tsconfig.json", "vite.config.ts", "vite.config.js",
    "Dockerfile", "docker-compose.yml", "pyproject.toml", "setup.py",
    ".medieval-code.json",
  ]);
  return configs.has(base) || base.endsWith(".config.js") || base.endsWith(".config.ts");
}
