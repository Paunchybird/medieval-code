#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Command, InvalidArgumentError } from "commander";
import open from "open";
import type { TownModel } from "@medieval-code/model";
import { validateTownModel } from "@medieval-code/model";
import { scanRepo } from "./scan.js";
import { serveViewer } from "./server.js";
import { formatSummary } from "./summary.js";

const THEMES = ["dawn", "day", "dusk", "night"];

function intArg(name: string, min: number) {
  return (v: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min) throw new InvalidArgumentError(`${name} must be an integer ≥ ${min}`);
    return n;
  };
}

function themeArg(v: string) {
  if (!THEMES.includes(v)) throw new InvalidArgumentError(`choose one of ${THEMES.join(", ")}`);
  return v;
}

async function serveAndMaybeOpen(townPath: string, opts: { port: number; theme?: string; open: boolean }) {
  const { port } = await serveViewer(opts.port, townPath);
  const query = opts.theme ? `?theme=${opts.theme}` : "";
  const url = `http://localhost:${port}/${query}`;
  console.log(`Viewer at ${url}  (Ctrl+C to stop)`);
  if (opts.open) await open(url);
}

const program = new Command();

program
  .name("medieval-code")
  .description("Visualize a codebase as a medieval voxel town")
  .version("0.2.0");

program
  .command("scan")
  .description("Parse a repository, write town.json, and optionally show it")
  .argument("<path>", "Repository path to scan")
  .option("-o, --out <file>", "Output JSON path (default: <repo>/.medieval-code/town.json)")
  .option("--open", "Serve the viewer and open it in the browser")
  .option("--serve", "Serve the viewer without opening a browser")
  .option("-p, --port <number>", "Viewer port (the next free one is used if busy)", intArg("port", 1), 5179)
  .option("--theme <theme>", "Sky theme: dawn | day | dusk | night", themeArg)
  .option("--max-files <n>", "Max source files to parse", intArg("max-files", 1))
  .action(async (target: string, opts) => {
    const root = path.resolve(target);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      console.error(`Not a directory: ${root}`);
      process.exit(1);
    }
    const t0 = Date.now();
    const outPath = scanRepo({
      root,
      out: opts.out,
      theme: opts.theme,
      caps: opts.maxFiles ? { maxFiles: opts.maxFiles } : {},
    });
    const town = JSON.parse(fs.readFileSync(outPath, "utf8")) as TownModel;
    console.log(`Town written to ${outPath} in ${Date.now() - t0} ms`);
    console.log(formatSummary(town));

    if (opts.open || opts.serve) {
      await serveAndMaybeOpen(outPath, { port: opts.port, theme: opts.theme, open: !!opts.open });
    }
  });

program
  .command("serve")
  .description("Show an existing town.json in the viewer")
  .argument("[town]", "Path to town.json, or a scanned repo", ".")
  .option("-p, --port <number>", "Viewer port (the next free one is used if busy)", intArg("port", 1), 5179)
  .option("--theme <theme>", "Sky theme: dawn | day | dusk | night", themeArg)
  .option("--no-open", "Do not open a browser")
  .action(async (target: string, opts) => {
    let townPath = path.resolve(target);
    if (fs.existsSync(townPath) && fs.statSync(townPath).isDirectory()) {
      townPath = path.join(townPath, ".medieval-code", "town.json");
    }
    if (!fs.existsSync(townPath)) {
      console.error(`No town found at ${townPath}. Run "medieval-code scan <repo>" first.`);
      process.exit(1);
    }
    const town = JSON.parse(fs.readFileSync(townPath, "utf8"));
    if (!validateTownModel(town)) {
      console.error(`${townPath} is not a medieval-code town.json`);
      process.exit(1);
    }
    console.log(formatSummary(town));
    await serveAndMaybeOpen(townPath, { port: opts.port, theme: opts.theme, open: opts.open });
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
