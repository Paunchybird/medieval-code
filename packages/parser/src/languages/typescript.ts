import ts from "typescript";

export interface RawConstruct {
  type: string;
  name: string;
  startLine: number;
  endLine: number;
  metrics: {
    loc: number;
    depth?: number;
    branches?: number;
    params?: number;
    members?: number;
    cases?: number;
    complexity?: number;
  };
  children?: RawConstruct[];
}

export interface ParseResult {
  constructs: RawConstruct[];
  imports: string[];
}

/** Constructs nested deeper inside one parent collapse into a tenement. */
const MAX_CHILDREN = 6;

function lineOf(pos: number, sf: ts.SourceFile): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function spanLines(node: ts.Node, sf: ts.SourceFile): { start: number; end: number; loc: number } {
  const start = lineOf(node.getStart(sf, false), sf);
  const end = lineOf(node.getEnd(), sf);
  return { start, end, loc: Math.max(1, end - start + 1) };
}

function countClassMembers(node: ts.ClassLikeDeclaration): number {
  let count = 0;
  for (const member of node.members) {
    if (
      ts.isMethodDeclaration(member) ||
      ts.isPropertyDeclaration(member) ||
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member)
    ) {
      count++;
    }
  }
  return count;
}

function countSwitchCases(node: ts.SwitchStatement): number {
  let cases = 0;
  for (const clause of node.caseBlock.clauses) {
    if (ts.isCaseClause(clause)) cases++;
  }
  return Math.max(1, cases);
}

function nestingDepth(node: ts.Node): number {
  let depth = 0;
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (
      ts.isForStatement(cur) ||
      ts.isForInStatement(cur) ||
      ts.isForOfStatement(cur) ||
      ts.isWhileStatement(cur) ||
      ts.isDoStatement(cur) ||
      ts.isIfStatement(cur) ||
      ts.isSwitchStatement(cur) ||
      ts.isTryStatement(cur)
    ) {
      depth++;
    }
    cur = cur.parent;
  }
  return depth;
}

function getName(node: ts.NamedDeclaration): string {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  return "(anonymous)";
}

function isFunctionLike(node: ts.Node | undefined): node is ts.ArrowFunction | ts.FunctionExpression {
  return !!node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
}

function propName(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isPrivateIdentifier(name)) return name.text;
  return "(computed)";
}

const TEST_FNS = new Set(["describe", "it", "test", "suite", "context", "bench"]);

/**
 * `describe("name", () => {…})`, `it.only("…", async () => {…})`,
 * `test.each(rows)("…", fn)`: returns the label and the callback.
 */
function testCall(node: ts.Node): { label: string; fn: ts.ArrowFunction | ts.FunctionExpression } | null {
  if (!ts.isCallExpression(node)) return null;
  let callee: ts.Expression = node.expression;
  if (ts.isCallExpression(callee)) callee = callee.expression; // test.each(rows)(…)
  while (ts.isPropertyAccessExpression(callee)) callee = callee.expression; // it.only, describe.skip
  if (!ts.isIdentifier(callee) || !TEST_FNS.has(callee.text)) return null;
  const [first, ...rest] = node.arguments;
  if (!first || !(ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first) || ts.isTemplateExpression(first))) return null;
  const fn = rest.find(isFunctionLike);
  if (!fn) return null;
  const label = ts.isTemplateExpression(first) ? first.getText().slice(1, -1) : first.text;
  return { label: `${callee.text}: ${label}`, fn };
}

function extractImports(sf: ts.SourceFile): string[] {
  const imports: string[] = [];
  sf.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier) {
      const spec = (node.moduleSpecifier as ts.StringLiteral).text;
      imports.push(spec);
    } else if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (
        ts.isIdentifier(expr) &&
        expr.text === "require" &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        imports.push(node.arguments[0].text);
      }
    }
  });
  return imports;
}

/**
 * Collects the constructs found inside `nodes`, in source order. Returned
 * list becomes the `children` of the surrounding construct — nested code
 * renders as buildings inside that construct's walled courtyard.
 */
function collectChildren(nodes: (ts.Node | undefined)[], sf: ts.SourceFile): RawConstruct[] | undefined {
  const kids: RawConstruct[] = [];
  for (const n of nodes) {
    if (n) visitConstructs(n, sf, kids, true);
  }
  return kids.length > 0 ? kids : undefined;
}

/**
 * Keeps courtyards readable: past MAX_CHILDREN the rest collapse into one
 * tenement. Applied after complexity scoring (in the parser index) so the
 * collapsed constructs still count toward their parent's score.
 */
export function capChildren(kids: RawConstruct[]): RawConstruct[] {
  if (kids.length <= MAX_CHILDREN) return kids;
  const kept = kids.slice(0, MAX_CHILDREN - 1);
  const hidden = kids.slice(MAX_CHILDREN - 1);
  kept.push({
    type: "tenement",
    name: `+${hidden.length} more`,
    startLine: hidden[0].startLine,
    endLine: hidden[hidden.length - 1].endLine,
    metrics: { loc: hidden.reduce((s, k) => s + k.metrics.loc, 0) },
  });
  return kept;
}

function functionConstruct(
  name: string,
  fn: ts.SignatureDeclarationBase & { body?: ts.Node },
  spanNode: ts.Node,
  sf: ts.SourceFile,
): RawConstruct {
  const { start, end, loc } = spanLines(spanNode, sf);
  return {
    type: "house",
    name,
    startLine: start,
    endLine: end,
    metrics: {
      loc,
      params: fn.parameters.length,
      depth: nestingDepth(spanNode),
      complexity: 1,
    },
    children: collectChildren([fn.body], sf),
  };
}

function visitConstructs(node: ts.Node, sf: ts.SourceFile, out: RawConstruct[], nested: boolean): void {
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    const { start, end, loc } = spanLines(node, sf);
    out.push({
      type: "castle",
      name: getName(node),
      startLine: start,
      endLine: end,
      metrics: { loc, members: countClassMembers(node) },
      children: collectChildren([...node.members], sf),
    });
    return;
  }

  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
    const { start, end, loc } = spanLines(node, sf);
    out.push({ type: "bridge", name: getName(node), startLine: start, endLine: end, metrics: { loc } });
    return;
  }

  if (ts.isEnumDeclaration(node)) {
    const { start, end, loc } = spanLines(node, sf);
    out.push({
      type: "castle",
      name: node.name.text,
      startLine: start,
      endLine: end,
      metrics: { loc, members: node.members.length },
    });
    return;
  }

  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    out.push(functionConstruct(getName(node), node, node, sf));
    return;
  }

  if (ts.isConstructorDeclaration(node)) {
    out.push(functionConstruct("constructor", node, node, sf));
    return;
  }

  if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    const prefix = ts.isGetAccessorDeclaration(node) ? "get " : "set ";
    out.push(functionConstruct(prefix + getName(node), node, node, sf));
    return;
  }

  // describe / it / test blocks are the training grounds of a test suite
  const test = testCall(node);
  if (test) {
    const { start, end, loc } = spanLines(node, sf);
    out.push({
      type: "training",
      name: test.label,
      startLine: start,
      endLine: end,
      metrics: { loc, params: 0 },
      children: collectChildren([test.fn.body], sf),
    });
    return;
  }

  // object literals full of functions (`const api = { get() {}, post: () => {} }`)
  // and methods inside them read as functions
  if (
    (ts.isPropertyAssignment(node) && isFunctionLike(node.initializer)) ||
    (ts.isMethodDeclaration(node) && ts.isObjectLiteralExpression(node.parent))
  ) {
    const fn = ts.isPropertyAssignment(node) ? (node.initializer as ts.ArrowFunction) : node;
    out.push(functionConstruct(propName(node.name), fn, node, sf));
    return;
  }

  // `const foo = () => {…}` and class properties holding functions read as
  // functions to a human, so they get houses rather than decor.
  if (ts.isPropertyDeclaration(node) && isFunctionLike(node.initializer)) {
    out.push(functionConstruct(getName(node), node.initializer, node, sf));
    return;
  }

  if (ts.isVariableStatement(node)) {
    const topLevel = ts.isSourceFile(node.parent);
    for (const decl of node.declarationList.declarations) {
      const name = decl.name && ts.isIdentifier(decl.name) ? decl.name.text : "var";
      if (isFunctionLike(decl.initializer)) {
        // `const helper = () => {…}` is a function wherever it is declared
        out.push(functionConstruct(name, decl.initializer, decl, sf));
      } else if (topLevel) {
        const { start, end, loc } = spanLines(decl, sf);
        out.push({
          type: "decor",
          name,
          startLine: start,
          endLine: end,
          metrics: { loc },
          // an object of functions becomes a little walled garden of houses
          children: decl.initializer ? collectChildren([decl.initializer], sf) : undefined,
        });
      } else if (decl.initializer) {
        visitConstructs(decl.initializer, sf, out, nested);
      }
    }
    return;
  }

  if (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node)
  ) {
    const { start, end, loc } = spanLines(node, sf);
    out.push({
      type: "factory",
      name: node.kind === ts.SyntaxKind.ForStatement ? "for-loop" :
        node.kind === ts.SyntaxKind.WhileStatement ? "while-loop" : "loop",
      startLine: start,
      endLine: end,
      metrics: { loc, depth: nestingDepth(node) },
      children: collectChildren([node.statement], sf),
    });
    return;
  }

  if (ts.isIfStatement(node)) {
    // An if / else-if / else chain is one church; every branch body feeds
    // the same children list so else-if links don't spawn extra churches.
    const bodies: ts.Node[] = [];
    let branches = 1;
    let link: ts.IfStatement = node;
    for (;;) {
      bodies.push(link.thenStatement);
      if (!link.elseStatement) break;
      branches++;
      if (ts.isIfStatement(link.elseStatement)) {
        link = link.elseStatement;
      } else {
        bodies.push(link.elseStatement);
        break;
      }
    }
    const { start, end, loc } = spanLines(node, sf);
    out.push({
      type: "church",
      name: "if-else",
      startLine: start,
      endLine: end,
      metrics: { loc, branches },
      children: collectChildren(bodies, sf),
    });
    return;
  }

  if (ts.isSwitchStatement(node)) {
    const { start, end, loc } = spanLines(node, sf);
    out.push({
      type: "cathedral",
      name: "switch",
      startLine: start,
      endLine: end,
      metrics: { loc, cases: countSwitchCases(node) },
      children: collectChildren([node.caseBlock], sf),
    });
    return;
  }

  if (ts.isTryStatement(node)) {
    const { start, end, loc } = spanLines(node, sf);
    out.push({
      type: "tower",
      name: "try-catch",
      startLine: start,
      endLine: end,
      metrics: { loc, branches: 1 },
      children: collectChildren([node.tryBlock, node.catchClause?.block, node.finallyBlock], sf),
    });
    return;
  }

  if (!nested && (ts.isExportAssignment(node) || ts.isExportDeclaration(node))) {
    const { start, end, loc } = spanLines(node, sf);
    out.push({ type: "flag", name: "export", startLine: start, endLine: end, metrics: { loc } });
    return;
  }

  ts.forEachChild(node, (child) => visitConstructs(child, sf, out, nested));
}

export function parseTypeScriptSource(source: string, fileName: string): ParseResult {
  const kind = fileName.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : fileName.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : fileName.endsWith(".js") || fileName.endsWith(".mjs") || fileName.endsWith(".cjs")
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;

  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const constructs: RawConstruct[] = [];
  const imports = extractImports(sf);

  // Shop for imports (one per file)
  if (imports.length > 0) {
    constructs.unshift({
      type: "shop",
      name: `imports (${imports.length})`,
      startLine: 1,
      endLine: 1,
      metrics: { loc: 1, branches: imports.length },
    });
  }

  visitConstructs(sf, sf, constructs, false);

  return { constructs, imports };
}
