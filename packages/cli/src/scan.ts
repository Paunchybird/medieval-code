import fs from "node:fs";
import path from "node:path";
import { discoverAliases, walkCodebase, parseFiles } from "@medieval-code/parser";
import { buildTownModel } from "@medieval-code/layout";
import type { ScanCaps, TownMeta } from "@medieval-code/model";
import { DEFAULT_CAPS } from "@medieval-code/model";
import { validateTownModel } from "@medieval-code/model";

export interface ScanConfig extends Partial<ScanCaps> {
  theme?: TownMeta["theme"];
  excludeGlobs?: string[];
}

export interface ScanOptions {
  root: string;
  out?: string;
  theme?: TownMeta["theme"];
  caps?: Partial<ScanCaps>;
  excludeGlobs?: string[];
}

function loadConfig(root: string): ScanConfig {
  const configPath = path.join(root, ".medieval-code.json");
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8")) as ScanConfig;
  } catch {
    return {};
  }
}

export function scanRepo(options: ScanOptions): string {
  const root = path.resolve(options.root);
  const fileConfig = loadConfig(root);
  const outPath = options.out ?? path.join(root, ".medieval-code", "town.json");

  const caps: ScanCaps = {
    ...DEFAULT_CAPS,
    ...fileConfig,
    ...options.caps,
  };

  const walk = walkCodebase({
    root,
    caps,
    excludeGlobs: options.excludeGlobs ?? fileConfig.excludeGlobs,
  });
  const parsed = parseFiles(walk.files, root, caps);

  const model = buildTownModel(parsed, {
    root,
    theme: options.theme ?? fileConfig.theme,
    caps,
    truncated: walk.truncated,
    totalFound: walk.totalFound,
    aliases: discoverAliases(root, walk.files),
  });

  model.meta.skippedFiles = walk.skipped.length;

  if (!validateTownModel(model)) {
    throw new Error("Failed to build valid TownModel");
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(model, null, 2), "utf8");

  return outPath;
}
