/* eslint-disable @typescript-eslint/no-require-imports */
// Compiler-driven dead-code remover for the scratch copy.
// node reduce.cjs <mode> [scopeRegex]
//   mode "unused": strip what --noUnusedLocals reports (imports + top-level decls + pure locals), to fixpoint.
//   mode "exports:<json file>": remove the named exports listed in the json {file: [names]} first.
const ts = require("typescript");
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const cfgPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
const cfg = ts.getParsedCommandLineOfConfigFile(cfgPath, { noUnusedLocals: true, noEmit: true }, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
const scope = process.argv[3] ? new RegExp(process.argv[3]) : /^src\//;
const exclude = process.env.EXCLUDE ? new RegExp(process.env.EXCLUDE) : null;
const log = [];

function rel(f) { return path.relative(root, f); }
function removeRanges(file, ranges) {
  let text = fs.readFileSync(file, "utf8");
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const m = merged[merged.length - 1];
    if (m && r[0] <= m[1]) { m[1] = Math.max(m[1], r[1]); m[2] += "; " + r[2]; } else merged.push([...r]);
  }
  for (let i = merged.length - 1; i >= 0; i--) {
    const [s, e, why] = merged[i];
    const removed = text.slice(s, e);
    log.push({ file: rel(file), lines: removed.split("\n").length - (removed.endsWith("\n") ? 1 : 0), why });
    text = text.slice(0, s) + text.slice(e);
    // collapse the blank lines left around the cut
    let a2 = s; while (a2 > 0 && text[a2 - 1] === "\n") a2--;
    let b2 = s; while (b2 < text.length && text[b2] === "\n") b2++;
    if (b2 - a2 > 2) text = text.slice(0, a2) + "\n\n" + text.slice(b2);
  }
  fs.writeFileSync(file, text);
}
function stmtRange(sf, node) {
  const text = sf.text;
  const full = node.getFullStart();
  const lead = ts.getLeadingCommentRanges(text, full) || [];
  let s = lead.length ? lead[0].pos : node.getStart(sf);
  // back up to the beginning of this line, never into the previous statement
  while (s > full && text[s - 1] !== "\n") s--;
  let e = node.getEnd();
  while (e < text.length && text[e] !== "\n") e++;
  if (text[e] === "\n") e++;
  return [s, e];
}
function declName(st) {
  if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) return st.name && st.name.text;
  if (ts.isVariableStatement(st) && st.declarationList.declarations.length === 1 && ts.isIdentifier(st.declarationList.declarations[0].name)) return st.declarationList.declarations[0].name.text;
  return null;
}
function isPureInit(init) {
  if (!init) return true;
  return ts.isArrowFunction(init) || ts.isFunctionExpression(init) || ts.isLiteralExpression(init) || ts.isIdentifier(init) || ts.isObjectLiteralExpression(init) && init.properties.every(p => ts.isPropertyAssignment(p) && (ts.isLiteralExpression(p.initializer) || ts.isIdentifier(p.initializer))) || init.kind === ts.SyntaxKind.TrueKeyword || init.kind === ts.SyntaxKind.FalseKeyword || init.kind === ts.SyntaxKind.NullKeyword || ts.isArrayLiteralExpression(init) && init.elements.every(e => ts.isLiteralExpression(e));
}

function removeExports(spec) {
  for (const [file, names] of Object.entries(spec)) {
    const abs = path.join(root, file);
    if (!fs.existsSync(abs) || (exclude && exclude.test(file))) continue;
    const sf = ts.createSourceFile(abs, fs.readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true);
    const ranges = [];
    for (const st of sf.statements) {
      const n = declName(st);
      if (n && names.includes(n)) ranges.push([...stmtRange(sf, st), "dead export " + n]);
      if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
        const els = st.exportClause.elements;
        const drop = els.filter(e => names.includes(e.name.text));
        if (drop.length && drop.length === els.length) ranges.push([...stmtRange(sf, st), "dead re-export " + drop.map(e => e.name.text).join(",")]);
        else for (const e of drop) {
          let s = e.getFullStart(), en = e.getEnd();
          if (sf.text[en] === ",") en++;
          ranges.push([s, en, "dead re-export " + e.name.text]);
        }
      }
    }
    if (ranges.length) removeRanges(abs, ranges);
  }
}

function unusedPass() {
  const program = ts.createProgram(cfg.fileNames, cfg.options);
  const diags = ts.getPreEmitDiagnostics(program).filter(d => d.file && [6133, 6196, 6192, 6198, 6205].includes(d.code) && scope.test(rel(d.file.fileName)) && !(exclude && exclude.test(rel(d.file.fileName))));
  const byFile = new Map();
  for (const d of diags) {
    const sf = d.file;
    const tok = ts.getTokenAtPosition ? ts.getTokenAtPosition(sf, d.start) : null;
    let node = tok;
    // climb to a removable node
    while (node && !ts.isSourceFile(node)) {
      if (ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node) || ts.isImportDeclaration(node)) break;
      if (ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node) || ts.isBindingElement(node)) break;
      node = node.parent;
    }
    if (!node || ts.isSourceFile(node)) continue;
    const list = byFile.get(sf) || []; byFile.set(sf, list);
    if (ts.isImportSpecifier(node)) {
      const els = node.parent.elements;
      const decl = node.parent.parent.parent;
      list.push({ kind: "spec", node, decl, count: els.length });
    } else if (ts.isImportClause(node) || ts.isNamespaceImport(node) || ts.isImportDeclaration(node)) {
      let decl = node; while (decl && !ts.isImportDeclaration(decl)) decl = decl.parent;
      const clause = decl.importClause;
      if (d.code === 6133 && clause && clause.name && clause.namedBindings && ts.isImportClause(node)) {
        // only the default binding is unused: "React, { useState }" -> "{ useState }"
        list.push({ kind: "range", s: clause.name.getStart(sf), e: clause.namedBindings.getStart(sf), why: "unused default import " + clause.name.text });
      } else if (d.code === 6133 && clause && clause.name && clause.namedBindings && ts.isNamespaceImport(node)) {
        list.push({ kind: "range", s: clause.name.getEnd(), e: clause.namedBindings.getEnd(), why: "unused namespace import" });
      } else list.push({ kind: "decl", node: decl });
    } else if (ts.isVariableDeclaration(node)) {
      const st = node.parent && node.parent.parent;
      const top = st && ts.isVariableStatement(st) && ts.isSourceFile(st.parent);
      if (st && ts.isVariableStatement(st) && st.declarationList.declarations.length === 1 && (top ? isPureInit(node.initializer) || true : isPureInit(node.initializer)) && ts.isIdentifier(node.name)) {
        if (top && !isPureInit(node.initializer)) {
          // top-level with side-effecting init: only drop if it is a call of a known pure builder
          const txt = node.initializer.getText(sf);
          if (!/^(z\.|sql`|cache\(|dynamic\(|new Map|new Set|Object\.freeze|\[|\{)/.test(txt)) continue;
        }
        list.push({ kind: "stmt", node: st });
      }
    } else if (!ts.isBindingElement(node) && ts.isSourceFile(node.parent)) {
      list.push({ kind: "stmt", node });
    }
  }
  let changed = 0;
  for (const [sf, items] of byFile) {
    const ranges = [];
    const declGroups = new Map();
    for (const it of items) {
      if (it.kind === "spec") { const g = declGroups.get(it.decl) || []; g.push(it.node); declGroups.set(it.decl, g); }
      else if (it.kind === "decl") ranges.push([...stmtRange(sf, it.node), "unused import"]);
      else if (it.kind === "range") ranges.push([it.s, it.e, it.why]);
      else ranges.push([...stmtRange(sf, it.node), "unused " + (declName(it.node) || "local")]);
    }
    for (const [decl, specs] of declGroups) {
      const all = decl.importClause && decl.importClause.namedBindings && decl.importClause.namedBindings.elements;
      if (all && specs.length === all.length && !decl.importClause.name) ranges.push([...stmtRange(sf, decl), "unused import"]);
      else for (const s of specs) { let a = s.getFullStart(), b = s.getEnd(); if (sf.text[b] === ",") b++; ranges.push([a, b, "unused import " + s.name.text]); }
    }
    if (ranges.length) { removeRanges(sf.fileName, ranges); changed += ranges.length; }
  }
  return changed;
}

const mode = process.argv[2] || "unused";
if (mode.startsWith("exports:")) removeExports(JSON.parse(fs.readFileSync(mode.slice(8), "utf8")));
let n, iter = 0;
do { n = unusedPass(); iter++; } while (n > 0 && iter < 12);
fs.appendFileSync(path.join(root, "reduce-log.jsonl"), log.map(l => JSON.stringify(l)).join("\n") + (log.length ? "\n" : ""));
console.log(JSON.stringify({ iterations: iter, removals: log.length, lines: log.reduce((a, b) => a + b.lines, 0) }));
