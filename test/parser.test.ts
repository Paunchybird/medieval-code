import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ParsedConstruct } from "@medieval-code/model";
import { parseFile, walkCodebase, isTestFile, isConfigFile, detectLanguage, isGeneratedFile } from "@medieval-code/parser";
import { parsePythonSource } from "../packages/parser/src/languages/python";
import { parseTypeScriptSource, type RawConstruct } from "../packages/parser/src/languages/typescript";

const FIXTURE = fileURLToPath(new URL("./fixtures/kingdom", import.meta.url));

/** "type name" outline with indentation per nesting level. */
function outline(cs: (RawConstruct | ParsedConstruct)[], depth = 0): string[] {
  return cs.flatMap((c) => [`${"  ".repeat(depth)}${c.type} ${c.name}`, ...outline(c.children ?? [], depth + 1)]);
}

describe("TypeScript extractor", () => {
  it("maps classes, members, control flow and nesting", () => {
    const f = parseFile(path.join(FIXTURE, "src/core/engine.ts"), FIXTURE);
    expect(outline(f.constructs)).toEqual([
      "shop imports (2)",
      "castle Engine",
      "  house constructor",
      "    church if-else",
      "  house get name",
      "  house run",
      "    factory for-loop",
      "      church if-else",
      "  house mode",
      "    cathedral switch",
      "decor helpers",
      "  house double",
      "  house safe",
      "    tower try-catch",
    ]);
    expect(f.imports).toEqual(["./math.js", "../api/types"]);
  });

  it("scores complexity from the construct tree", () => {
    const f = parseFile(path.join(FIXTURE, "src/core/engine.ts"), FIXTURE);
    const engine = f.constructs.find((c) => c.name === "Engine")!;
    const run = engine.children!.find((c) => c.name === "run")!;
    // 1 (callable) + loop + 3 branches
    expect(run.metrics.complexity).toBe(5);
    const mode = engine.children!.find((c) => c.name === "mode")!;
    expect(mode.metrics.complexity).toBe(1 + 2);
    expect(run.metrics.params).toBe(2);
    // class = 1 + every decision of every method
    expect(engine.metrics.complexity).toBe(1 + 1 + 4 + 2);
  });

  it("turns describe / it / test blocks into training grounds", () => {
    const f = parseFile(path.join(FIXTURE, "tests/engine.test.ts"), FIXTURE);
    expect(f.isTest).toBe(true);
    expect(outline(f.constructs)).toEqual([
      "shop imports (2)",
      "training describe: engine",
      "  training it: runs",
      "  training it: picks a mode",
      "    factory loop",
    ]);
  });

  it("handles .each tables, template labels and modifiers", () => {
    const src = 'test.each([1])("case %s", (n) => {});\nit.only(`x ${1}`, async () => {});\ndescribe.skip("s", function () {});';
    expect(outline(parseTypeScriptSource(src, "a.test.ts").constructs)).toEqual([
      "training test: case %s",
      "training it: x ${1}",
      "training describe: s",
    ]);
  });

  it("finds nested arrow helpers and object methods but not plain nested consts", () => {
    const src = "function outer() { const n = 1; const helper = () => { if (n) {} }; return helper; }";
    expect(outline(parseTypeScriptSource(src, "a.ts").constructs)).toEqual([
      "house outer",
      "  house helper",
      "    church if-else",
    ]);
  });

  it("counts if / else-if / else chains as one church with every branch", () => {
    const src = "if (a) {} else if (b) {} else if (c) {} else {}";
    const [church] = parseTypeScriptSource(src, "a.ts").constructs;
    expect(church.type).toBe("church");
    expect(church.metrics.branches).toBe(4);
  });
});

describe("Python extractor", () => {
  const stats = () => parsePythonSource(
    fs.readFileSync(path.join(FIXTURE, "tools/pkg/stats.py"), "utf8"),
    "tools/pkg/stats.py",
  );

  it("ignores code-looking text in docstrings and survives black-style signatures", () => {
    const r = stats();
    expect(outline(r.constructs)).toEqual([
      "shop imports (2)",
      "castle Summary",
      "  house __init__",
      "  house spread",
      "    church if-else",
      "house report",
      "  tower try-except",
      "    factory for-loop",
    ]);
    const summary = r.constructs.find((c) => c.name === "Summary")!;
    expect(summary.startLine).toBe(9);
    expect(summary.endLine).toBe(26);
    expect(summary.metrics.members).toBe(3); // total, __init__, spread
  });

  it("counts parameters without self and branches across elif / else", () => {
    const r = stats();
    const init = r.constructs.find((c) => c.name === "Summary")!.children!.find((c) => c.name === "__init__")!;
    expect(init.metrics.params).toBe(2);
    const church = r.constructs.find((c) => c.name === "Summary")!.children![1].children![0];
    expect(church.metrics.branches).toBe(3);
    const tower = r.constructs.find((c) => c.name === "report")!.children![0];
    expect(tower.metrics.branches).toBe(2); // except + finally
    expect(tower.endLine).toBe(36);
  });

  it("reads imports, match / case and the main guard", () => {
    const src = fs.readFileSync(path.join(FIXTURE, "tools/cli.py"), "utf8");
    const r = parsePythonSource(src, "tools/cli.py");
    expect(r.imports).toEqual(["sys", "pkg.stats", "pkg"]);
    expect(outline(r.constructs)).toEqual([
      "shop imports (3)",
      "decor LEVEL",
      "house main",
      "  cathedral match",
      "church main guard",
    ]);
    const match = r.constructs[2].children![0];
    expect(match.metrics.cases).toBe(3);
  });

  it("makes test_ functions and Test classes training grounds in test files", () => {
    const src = "class TestThing:\n    def test_a(self):\n        assert 1\n\ndef helper():\n    pass\n";
    expect(outline(parsePythonSource(src, "tests/test_thing.py").constructs)).toEqual([
      "training TestThing",
      "  training test_a",
      "house helper",
    ]);
  });

  it("does not open blocks inside strings or comments", () => {
    const src = 's = "if x: for y in z:"  # while True:\nt = """\ndef ghost():\n    pass\n"""\n';
    expect(outline(parsePythonSource(src, "a.py").constructs)).toEqual(["decor s", "decor t"]);
  });
});

describe("walker", () => {
  it("finds source files in sorted order and honours the denylist", () => {
    const w = walkCodebase({ root: FIXTURE });
    const rel = w.files.map((f) => path.relative(FIXTURE, f));
    expect(rel).toEqual([
      "src/api/server.ts",
      "src/api/types.ts",
      "src/core/engine.ts",
      "src/core/math.ts",
      "tests/engine.test.ts",
      "tools/cli.py",
      "tools/pkg/__init__.py",
      "tools/pkg/stats.py",
      "tools/pkg/util.py",
    ]);
    expect(w.truncated).toBe(false);
  });

  it("stops at maxFiles and reports truncation", () => {
    const w = walkCodebase({ root: FIXTURE, caps: { maxFiles: 3 } });
    expect(w.files).toHaveLength(3);
    expect(w.truncated).toBe(true);
  });

  it("classifies files", () => {
    expect(isTestFile("src/a.test.ts")).toBe(true);
    expect(isTestFile("pkg/test_a.py")).toBe(true);
    expect(isTestFile("src/a.ts")).toBe(false);
    expect(isConfigFile("vite.config.ts")).toBe(true);
    expect(detectLanguage("x.py")).toBe("python");
    expect(detectLanguage("x.tsx")).toBe("typescript");
    expect(detectLanguage("x.mjs")).toBe("javascript");
  });

  it("leaves out minified, bundled, declaration and oversized files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gen-"));
    const write = (name: string, body: string) => {
      fs.writeFileSync(path.join(dir, name), body);
      return path.join(dir, name);
    };
    expect(isGeneratedFile(write("app.min.js", "var a=1;"))).toBe(true);
    expect(isGeneratedFile(write("vendor.bundle.js", "var a=1;"))).toBe(true);
    expect(isGeneratedFile(write("types.d.ts", "export {};"))).toBe(true);
    expect(isGeneratedFile(write("dist-x1.js", "function r(){return 1}".repeat(400)))).toBe(true);
    expect(isGeneratedFile(write("big.js", "// x\n".repeat(200_000)))).toBe(true);
    expect(isGeneratedFile(write("ok.ts", "export const a = 1;\n".repeat(400)))).toBe(false);
    const w = walkCodebase({ root: dir });
    expect(w.files.map((f) => path.basename(f))).toEqual(["ok.ts"]);
    expect(w.skipped.sort()).toEqual(["app.min.js", "big.js", "dist-x1.js", "types.d.ts", "vendor.bundle.js"]);
  });

  it("caps courtyards at six buildings, keeping the collapsed ones' score", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-"));
    const body = Array.from({ length: 9 }, (_, i) => `  for (const x${i} of y) {}`).join("\n");
    fs.writeFileSync(path.join(dir, "big.ts"), `function big() {\n${body}\n}\n`);
    const f = parseFile(path.join(dir, "big.ts"), dir);
    const big = f.constructs[0];
    expect(big.children).toHaveLength(6);
    expect(big.children![5].type).toBe("tenement");
    expect(big.children![5].name).toBe("+4 more");
    expect(big.metrics.complexity).toBe(10);
  });
});
