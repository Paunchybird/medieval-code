import fs from "node:fs";
import path from "node:path";
import type { ConstructType, ParsedConstruct, ParsedFile, ScanCaps } from "@medieval-code/model";
import { DEFAULT_CAPS } from "@medieval-code/model";
import { detectLanguage, isConfigFile, isTestFile } from "./walker.js";
import { parsePythonSource } from "./languages/python.js";
import { capChildren, parseTypeScriptSource, type RawConstruct } from "./languages/typescript.js";

export { walkCodebase, detectLanguage, isTestFile, isConfigFile, isGeneratedFile } from "./walker.js";
export { discoverAliases, type ImportAlias } from "./aliases.js";

/** Decision points a construct contributes to its enclosing scope's complexity. */
function decisionWeight(c: RawConstruct): number {
  switch (c.type) {
    case "church":
      return Math.max(1, c.metrics.branches ?? 1);
    case "cathedral":
      return Math.max(1, c.metrics.cases ?? 1);
    case "factory":
    case "tower":
      return 1;
    default:
      return 0;
  }
}

/**
 * Cyclomatic-style score, computed from the construct tree so it matches
 * what the town shows: every church/cathedral/workshop/guard-tower inside a
 * building raises its complexity. Callables start at 1; a plain `if` scores
 * its branch count. Returns the construct's decision contribution upward.
 */
function computeComplexity(c: RawConstruct): number {
  let decisions = decisionWeight(c);
  for (const k of c.children ?? []) decisions += computeComplexity(k);
  const callable = c.type === "house" || c.type === "castle" || c.type === "training";
  c.metrics.complexity = Math.max(1, decisions + (callable ? 1 : 0));
  return decisions;
}

/** Cap courtyard children after scoring, so collapsed constructs still count. */
function capNesting(list: RawConstruct[]): RawConstruct[] {
  for (const c of list) {
    if (c.children) c.children = capNesting(c.children);
  }
  return capChildren(list);
}

function mapType(raw: string): ConstructType {
  const map: Record<string, ConstructType> = {
    castle: "castle",
    house: "house",
    factory: "factory",
    church: "church",
    cathedral: "cathedral",
    tower: "tower",
    shop: "shop",
    bridge: "bridge",
    flag: "flag",
    decor: "decor",
    tenement: "tenement",
    townhall: "townhall",
    training: "training",
  };
  return map[raw] ?? "decor";
}

function mapConstruct(c: RawConstruct, relPath: string): ParsedConstruct {
  return {
    type: mapType(c.type),
    name: c.name,
    file: relPath,
    span: { startLine: c.startLine, endLine: c.endLine },
    metrics: c.metrics,
    children: c.children?.map((k) => mapConstruct(k, relPath)),
  };
}

export function parseFile(absPath: string, root: string, caps: ScanCaps = DEFAULT_CAPS): ParsedFile {
  const relPath = path.relative(root, absPath).replace(/\\/g, "/");
  const language = detectLanguage(absPath);
  const isTest = isTestFile(relPath);
  const isConfig = isConfigFile(relPath);
  const source = fs.readFileSync(absPath, "utf8");

  let constructs: ParsedFile["constructs"] = [];
  let imports: string[] = [];

  const result = language === "python"
    ? parsePythonSource(source, relPath)
    : parseTypeScriptSource(source, relPath);
  imports = result.imports;
  for (const c of result.constructs) computeComplexity(c);
  constructs = capNesting(result.constructs).map((c) => mapConstruct(c, relPath));

  if (isConfig && constructs.length === 0) {
    constructs.push({
      type: "townhall",
      name: path.basename(relPath),
      file: relPath,
      span: { startLine: 1, endLine: source.split("\n").length },
      metrics: { loc: source.split("\n").length },
    });
  }

  if (isTest) {
    constructs = constructs.map((c) =>
      c.type === "decor" || c.type === "training" || c.type === "shop" ? c : { ...c, name: `[test] ${c.name}` },
    );
  }

  if (constructs.length > caps.maxConstructsPerFile) {
    const kept = constructs.slice(0, caps.maxConstructsPerFile - 1);
    const hidden = constructs.length - kept.length;
    kept.push({
      type: "tenement",
      name: `+${hidden} more`,
      file: relPath,
      span: { startLine: 0, endLine: 0 },
      metrics: { loc: hidden },
    });
    constructs = kept;
  }

  return {
    absPath,
    relPath,
    language,
    isTest,
    isConfig,
    constructs,
    imports,
  };
}

export function parseFiles(
  files: string[],
  root: string,
  caps: ScanCaps = DEFAULT_CAPS,
): ParsedFile[] {
  return files.map((f) => parseFile(f, root, caps));
}
