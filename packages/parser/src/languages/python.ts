import type { RawConstruct } from "./typescript.js";

export interface PythonParseResult {
  constructs: RawConstruct[];
  imports: string[];
}

/**
 * Indentation-aware Python extractor. It is not a full parser, but it works
 * on *masked logical lines*: string literals (including triple-quoted
 * docstrings) and comments are blanked first, and lines that continue an
 * open bracket or a backslash are folded into the line that opened them. So
 * an `if` inside a docstring is not a church, and a black-style signature
 *
 *     def run(
 *         a,
 *     ) -> int:
 *
 * does not end the function at its closing parenthesis.
 */

interface Line {
  /** 1-based line number of the logical line's first physical line */
  no: number;
  /** last physical line (1-based) the logical line spans */
  lastNo: number;
  indent: number;
  /** masked code text of the whole logical line (strings blanked, comments gone) */
  code: string;
}

/**
 * Blank string contents and drop comments, keeping quotes so code shape
 * survives. `inString[i]` is true when line i starts inside a triple-quoted
 * string (its indentation means nothing).
 */
function maskSource(src: string): { lines: string[]; inString: boolean[] } {
  const out: string[] = [];
  const inString: boolean[] = [false];
  let cur = "";
  let i = 0;
  let quote: string | null = null; // ', ", ''' or """
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\n") {
      out.push(cur);
      cur = "";
      i++;
      // a single-quoted string cannot span lines (unless escaped; treat as closed)
      if (quote && quote.length === 1) quote = null;
      inString.push(quote !== null);
      continue;
    }
    if (quote) {
      if (ch === "\\") { cur += "  "; i += 2; continue; }
      if (src.startsWith(quote, i)) {
        cur += quote;
        i += quote.length;
        quote = null;
        continue;
      }
      cur += " ";
      i++;
      continue;
    }
    if (ch === "#") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const triple = src.startsWith(ch.repeat(3), i);
      quote = triple ? ch.repeat(3) : ch;
      cur += quote;
      i += quote.length;
      continue;
    }
    cur += ch;
    i++;
  }
  out.push(cur);
  return { lines: out, inString };
}

function logicalLines({ lines: masked, inString }: { lines: string[]; inString: boolean[] }): Line[] {
  const lines: Line[] = [];
  let depth = 0;
  let open: Line | null = null;
  let backslash = false;
  for (let i = 0; i < masked.length; i++) {
    const raw = masked[i];
    if (open && (depth > 0 || backslash || inString[i])) {
      open.code += " " + raw.trim();
      open.lastNo = i + 1;
    } else {
      if (raw.trim() === "") { backslash = false; continue; }
      open = { no: i + 1, lastNo: i + 1, indent: raw.length - raw.trimStart().length, code: raw.trim() };
      lines.push(open);
    }
    for (const ch of raw) {
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
    }
    backslash = raw.trimEnd().endsWith("\\");
  }
  return lines;
}

/** Index of the last logical line of the block opened at `start` (inclusive). */
function blockEnd(lines: Line[], start: number): number {
  const base = lines[start].indent;
  let end = start;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].indent <= base) break;
    end = i;
  }
  return end;
}

/** Extends a block over trailing sibling clauses (elif/else/except/finally/case). */
function clauseChainEnd(lines: Line[], start: number, clause: RegExp): { end: number; clauses: number } {
  const base = lines[start].indent;
  let end = blockEnd(lines, start);
  let clauses = 0;
  while (end + 1 < lines.length && lines[end + 1].indent === base && clause.test(lines[end + 1].code)) {
    clauses++;
    end = blockEnd(lines, end + 1);
  }
  return { end, clauses };
}

const CLASS_RE = /^class\s+(\w+)/;
const DEF_RE = /^(?:async\s+)?def\s+(\w+)\s*\((.*?)\)\s*(?:->.*)?:/;
const FOR_RE = /^(?:async\s+)?for\s+/;
const WHILE_RE = /^while\b/;
const IF_RE = /^if\b/;
const TRY_RE = /^try\s*:/;
const MATCH_RE = /^match\s+.*:$/;
const CASE_RE = /^case\b/;
const ASSIGN_RE = /^([A-Za-z_]\w*)\s*(?::[^=]*)?=(?!=)/;
const IMPORT_FROM_RE = /^from\s+(\S+)\s+import\b/;
const IMPORT_RE = /^import\s+(.+)$/;

function countParams(sig: string): number {
  // split on top-level commas only (defaults may hold tuples or calls)
  let depth = 0;
  const parts: string[] = [];
  let cur = "";
  for (const ch of sig) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  parts.push(cur);
  return parts
    .map((p) => p.trim().split(/[:=]/)[0].trim())
    .filter((p) => p && p !== "self" && p !== "cls" && p !== "*" && p !== "/").length;
}

export function parsePythonSource(source: string, fileName: string): PythonParseResult {
  const masked = maskSource(source);
  const lines = logicalLines(masked);
  const constructs: RawConstruct[] = [];
  const imports: string[] = [];
  const isTest = /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(fileName) || /(^|\/)tests?\//.test(fileName);

  // Indentation stack: a construct opened at a deeper indent, before its
  // enclosing construct's block ends, is a child (courtyard building).
  const stack: { c: RawConstruct; indent: number }[] = [];
  function place(c: RawConstruct, indent: number) {
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (indent > top.indent && c.startLine <= top.c.endLine) break;
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent) {
      parent.c.children = parent.c.children ?? [];
      parent.c.children.push(c);
      if (parent.c.type === "castle" && indent > parent.indent) {
        parent.c.metrics.members = (parent.c.metrics.members ?? 0) + 1;
      }
    } else {
      constructs.push(c);
    }
    stack.push({ c, indent });
  }
  const span = (i: number, end: number) => ({
    startLine: lines[i].no,
    endLine: lines[end].lastNo,
    loc: lines[end].lastNo - lines[i].no + 1,
  });

  for (let i = 0; i < lines.length; i++) {
    const { code, indent } = lines[i];
    let m: RegExpMatchArray | null;

    if ((m = code.match(IMPORT_FROM_RE))) {
      imports.push(m[1]);
      continue;
    }
    if ((m = code.match(IMPORT_RE))) {
      for (const part of m[1].split(",")) {
        const mod = part.trim().split(/\s+/)[0];
        if (mod) imports.push(mod);
      }
      continue;
    }

    if ((m = code.match(CLASS_RE))) {
      const end = blockEnd(lines, i);
      const s = span(i, end);
      const test = isTest && /^Test/.test(m[1]);
      place({ type: test ? "training" : "castle", name: m[1], startLine: s.startLine, endLine: s.endLine, metrics: { loc: s.loc, members: 0 } }, indent);
      continue;
    }

    if ((m = code.match(DEF_RE))) {
      const end = blockEnd(lines, i);
      const s = span(i, end);
      const test = isTest && /^test/.test(m[1]);
      place({
        type: test ? "training" : "house",
        name: m[1],
        startLine: s.startLine,
        endLine: s.endLine,
        metrics: { loc: s.loc, params: countParams(m[2]) },
      }, indent);
      continue;
    }

    if (FOR_RE.test(code) || WHILE_RE.test(code)) {
      // for/while may carry an else: clause
      const { end } = clauseChainEnd(lines, i, /^else\s*:/);
      const s = span(i, end);
      place({
        type: "factory",
        name: FOR_RE.test(code) ? "for-loop" : "while-loop",
        startLine: s.startLine,
        endLine: s.endLine,
        metrics: { loc: s.loc, depth: stack.filter((e) => e.c.type !== "castle" && e.c.type !== "house" && e.indent < indent).length },
      }, indent);
      continue;
    }

    if (IF_RE.test(code)) {
      const { end, clauses } = clauseChainEnd(lines, i, /^(elif\b|else\s*:)/);
      const s = span(i, end);
      place({
        type: "church",
        name: /__name__\s*==/.test(code) ? "main guard" : "if-else",
        startLine: s.startLine,
        endLine: s.endLine,
        metrics: { loc: s.loc, branches: 1 + clauses },
      }, indent);
      continue;
    }

    if (MATCH_RE.test(code)) {
      const end = blockEnd(lines, i);
      let cases = 0;
      const caseIndent = lines[i + 1]?.indent;
      for (let j = i + 1; j <= end; j++) if (lines[j].indent === caseIndent && CASE_RE.test(lines[j].code)) cases++;
      const s = span(i, end);
      place({
        type: "cathedral",
        name: "match",
        startLine: s.startLine,
        endLine: s.endLine,
        metrics: { loc: s.loc, cases: Math.max(1, cases) },
      }, indent);
      continue;
    }

    if (TRY_RE.test(code)) {
      const { end, clauses } = clauseChainEnd(lines, i, /^(except\b|else\s*:|finally\s*:)/);
      const s = span(i, end);
      place({
        type: "tower",
        name: "try-except",
        startLine: s.startLine,
        endLine: s.endLine,
        metrics: { loc: s.loc, branches: Math.max(1, clauses) },
      }, indent);
      continue;
    }

    if (indent === 0 && (m = code.match(ASSIGN_RE))) {
      const s = span(i, i);
      place({ type: "decor", name: m[1], startLine: s.startLine, endLine: s.endLine, metrics: { loc: s.loc } }, 0);
      continue;
    }

    // class-level attributes count as castle members
    const top = stack[stack.length - 1];
    if (top && top.c.type === "castle" && indent > top.indent && ASSIGN_RE.test(code) && lines[i].no <= top.c.endLine) {
      top.c.metrics.members = (top.c.metrics.members ?? 0) + 1;
    }
  }

  if (imports.length > 0) {
    constructs.unshift({
      type: "shop",
      name: `imports (${imports.length})`,
      startLine: lines.find((l) => IMPORT_FROM_RE.test(l.code) || IMPORT_RE.test(l.code))?.no ?? 1,
      endLine: 1,
      metrics: { loc: 1, branches: imports.length },
    });
    constructs[0].endLine = constructs[0].startLine;
  }

  return { constructs, imports };
}
