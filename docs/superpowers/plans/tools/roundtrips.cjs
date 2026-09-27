/* eslint-disable @typescript-eslint/no-require-imports */
// Whole-app round-trip analyzer. Read-only: node roundtrips.cjs <repoRoot> <out.json>
// Builds a function-level call graph with the TS type checker and counts, per server entry,
// the data-access call sites reachable from it: SQL (Drizzle/postgres), Supabase REST/RPC,
// Supabase Auth network calls, Storage, Redis (Upstash) and external fetch.
// Client side: which server actions / API routes each client unit calls, and whether the call
// fires automatically (useQuery queryFn / useEffect) or on user interaction.
const ts = require(require.resolve("typescript", { paths: [process.argv[2]] }));
const fs = require("fs");
const path = require("path");

const root = path.resolve(process.argv[2]);
const outPath = process.argv[3];
const cfgPath = path.join(root, "tsconfig.json");
const cfg = ts.getParsedCommandLineOfConfigFile(cfgPath, { noEmit: true }, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
const files = cfg.fileNames.filter((f) => path.relative(root, f).startsWith("src/"));
const program = ts.createProgram(files, cfg.options);
const checker = program.getTypeChecker();
const rel = (f) => path.relative(root, f);

const DB_ROOTS = new Set(["db", "readDb", "tx", "trx"]);
const DB_METHODS = new Set(["select", "selectDistinct", "selectDistinctOn", "insert", "update", "delete", "execute", "query", "transaction"]);
const STORAGE_METHODS = new Set(["upload", "download", "createSignedUrl", "createSignedUrls", "createSignedUploadUrl", "remove", "list", "move", "copy", "uploadToSignedUrl"]);
const REDIS_METHODS = new Set(["get", "set", "del", "incr", "incrby", "expire", "eval", "evalsha", "mget", "mset", "hget", "hset", "hincrby", "hgetall", "zadd", "zrange", "zrem", "sadd", "srem", "smembers", "pipeline", "multi", "exec", "ttl", "pexpire", "setex", "getdel", "scan", "exists", "decr", "lpush", "rpush", "lrange", "ltrim", "publish"]);
const AUTH_NET = /^(getUser|signInWithPassword|signUp|signOut|refreshSession|exchangeCodeForSession|updateUser|verifyOtp|resetPasswordForEmail|getUserById|deleteUser|listFactors|challenge|verify|unenroll|enroll|signInWithOAuth|signInWithIdToken|resend|generateLink|inviteUserByEmail|createUser|listUsers|updateUserById)$/;

const units = new Map();
const nodeUnit = new Map();
function fileDirective(sf) {
  for (const st of sf.statements) {
    if (ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression)) {
      if (st.expression.text === "use server") return "server";
      if (st.expression.text === "use client") return "client";
    } else break;
  }
  return null;
}
function addUnit(sf, name, node, body, exported) {
  const id = rel(sf.fileName) + "#" + name;
  const u = { id, file: rel(sf.fileName), name, node, body, exported, directive: fileDirective(sf), effects: null, calls: [], clientCalls: [] };
  units.set(id, u);
  nodeUnit.set(node, id);
  if (body && body !== node) nodeUnit.set(body, id);
  return u;
}
function fnBody(init) {
  if (!init) return null;
  if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return init;
  if (ts.isCallExpression(init)) for (const a of init.arguments) if (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) return a;
  return null;
}
for (const sf of program.getSourceFiles()) {
  if (!rel(sf.fileName).startsWith("src/") || sf.isDeclarationFile) continue;
  for (const st of sf.statements) {
    const mods = st.modifiers || [];
    const exported = mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault = mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    if (ts.isFunctionDeclaration(st) && st.body) addUnit(sf, isDefault ? "default" : st.name ? st.name.text : "anon", st, st, exported);
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const b = fnBody(d.initializer);
        if (ts.isIdentifier(d.name) && b) addUnit(sf, d.name.text, d, b, exported);
      }
    } else if (ts.isClassDeclaration(st) && st.name) addUnit(sf, st.name.text, st, st, exported);
    else if (ts.isExportAssignment(st)) addUnit(sf, "default", st, fnBody(st.expression) || st.expression, true);
  }
}
function unitOfNode(n) {
  while (n) { if (nodeUnit.has(n)) return nodeUnit.get(n); n = n.parent; }
  return null;
}
function resolveCallee(expr) {
  let sym = checker.getSymbolAtLocation(expr);
  if (sym && sym.flags & ts.SymbolFlags.Alias) { try { sym = checker.getAliasedSymbol(sym); } catch {} }
  let decls = sym && sym.declarations;
  if (!decls || !decls.length || decls.every((d) => ts.isBindingElement(d) || ts.isParameter(d))) {
    const t = checker.getTypeAtLocation(expr);
    const td = t && t.symbol && t.symbol.declarations;
    if (td && td.length) decls = td;
  }
  const out = new Set();
  for (const d of decls || []) { const id = unitOfNode(d); if (id) out.add(id); }
  return [...out];
}
const localMemo = new Map();
// A function declared inside a component/hook body inherits the trigger of the places that call it.
function localFnTrigger(fn, stop) {
  let decl = fn.parent;
  if (decl && ts.isCallExpression(decl) && /^(React\.)?(useCallback|useMemo)$/.test(decl.expression.getText())) decl = decl.parent;
  if (!decl || !ts.isVariableDeclaration(decl) || !ts.isIdentifier(decl.name) || !stop) return undefined;
  if (localMemo.has(decl)) return localMemo.get(decl);
  localMemo.set(decl, "deferred");
  const sym = checker.getSymbolAtLocation(decl.name);
  let best = "deferred";
  const rank = { auto: 3, "auto-conditional": 3, prefetch: 3, render: 2, interaction: 1, deferred: 0 };
  const scan = (x) => {
    if (ts.isIdentifier(x) && x !== decl.name && x.text === decl.name.text && x.parent && ts.isCallExpression(x.parent) && x.parent.expression === x && checker.getSymbolAtLocation(x) === sym) {
      const t0 = triggerOf(x, stop);
      const t1 = t0 === null ? "render" : t0;
      if (rank[t1] > rank[best]) best = t1;
    }
    ts.forEachChild(x, scan);
  };
  scan(stop);
  const res = best === "render" ? null : best;
  localMemo.set(decl, res);
  return res;
}
const RENDER_TIME_HOOKS = /^(React\.)?(useMemo|useState|useReducer|useSyncExternalStore|useRef)$/;
function triggerOf(node, stop) {
  let n = node;
  while (n && !ts.isSourceFile(n) && n !== stop) {
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) {
      const p = n.parent;
      if (p && ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) {
        if (/^(queryFn|initialPageParam)$/.test(p.name.text)) {
          const obj = p.parent;
          const cond = obj && ts.isObjectLiteralExpression(obj) && obj.properties.some((q) => q.name && q.name.getText() === "enabled" && !(ts.isPropertyAssignment(q) && q.initializer.kind === ts.SyntaxKind.TrueKeyword));
          return cond ? "auto-conditional" : "auto";
        }
        if (/^(mutationFn|onSuccess|onError|onSettled|onMutate)$/.test(p.name.text)) return "interaction";
      }
      if (p && ts.isCallExpression(p)) {
        const c = p.expression.getText();
        if (/^(React\.)?use(Layout|Insertion)?Effect$/.test(c)) return "auto";
        if (/prefetchQuery|prefetchInfiniteQuery|ensureQueryData|fetchQuery/.test(c)) return "prefetch";
        if (RENDER_TIME_HOOKS.test(c)) { n = p; continue; }
      }
      if (p && ts.isJsxExpression(p) && p.parent && ts.isJsxAttribute(p.parent) && /^on[A-Z]/.test(p.parent.name.getText())) return "interaction";
      const local = localFnTrigger(n, stop);
      if (local !== undefined) return local;
      return "deferred";
    }
    if (ts.isJsxAttribute(n) && /^on[A-Z]/.test(n.name.getText())) return "interaction";
    n = n.parent;
  }
  return null;
}
function queryOpts(node) {
  let n = node;
  while (n && !ts.isSourceFile(n)) {
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "queryFn" && ts.isObjectLiteralExpression(n.parent)) {
      const o = {};
      for (const q of n.parent.properties) {
        const k = q.name && q.name.getText();
        if (k && /^(staleTime|refetchInterval|refetchOnWindowFocus|refetchOnMount|gcTime)$/.test(k)) o[k] = ts.isPropertyAssignment(q) ? q.initializer.getText().slice(0, 40) : k;
      }
      return o;
    }
    n = n.parent;
  }
  return null;
}
const line = (n) => n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line + 1;
for (const u of units.values()) {
  const eff = { sql: 0, rest: 0, authNet: 0, authLocal: 0, storage: 0, redis: 0, fetch: 0, tx: 0, fetchUrls: [] };
  const calls = new Set();
  const edges = [];
  const clientCalls = [];
  const visit = (n) => {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && DB_ROOTS.has(n.expression.text) && DB_METHODS.has(n.name.text)) {
      if (n.name.text === "transaction") eff.tx++; else eff.sql++;
    }
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        const m = callee.name.text, objTxt = callee.expression.getText();
        if ((m === "from" || m === "rpc") && !/\.storage$/.test(objTxt) && /(supabase|admin|adminClient|client|serviceClient)$/i.test(objTxt)) eff.rest++;
        if (/\.auth(\.admin|\.mfa)?$/.test(objTxt) && AUTH_NET.test(m)) eff.authNet++;
        if (/\.auth$/.test(objTxt) && m === "getSession") eff.authLocal++;
        if (STORAGE_METHODS.has(m) && /\.storage\.from\(/.test(objTxt)) eff.storage++;
        if (REDIS_METHODS.has(m) && (/\bredis\b|redisClient|getRedisClient\(\)/i.test(objTxt) || /^(pipe|pipeline|multi)$/.test(objTxt))) eff.redis++;
      }
      if (ts.isIdentifier(callee) && callee.text === "fetch") {
        eff.fetch++;
        if (n.arguments[0]) eff.fetchUrls.push(n.arguments[0].getText().slice(0, 140));
        if (u.directive === "client" || !u.directive) {
          const opts = n.arguments[1] ? n.arguments[1].getText() : "";
          const mm = opts.match(/method:\s*["'`](\w+)["'`]/);
          const url = n.arguments[0] ? n.arguments[0].getText().slice(0, 160) : "";
          if (/\/api\//.test(url)) clientCalls.push({ kind: "api", url, method: mm ? mm[1] : "GET", trigger: triggerOf(n, u.body), line: line(n), opts: queryOpts(n) });
        }
      }
      if (ts.isIdentifier(callee) && /^(resolveAuthSnapshot|verifySupabaseAccessToken)$/.test(callee.text)) eff.authLocal++;
      for (const id of resolveCallee(callee)) if (id !== u.id) {
        calls.add(id); edges.push([id, triggerOf(n, u.body)]);
        const tgt = units.get(id);
        if (tgt && tgt.directive === "server" && u.directive !== "server") clientCalls.push({ kind: "action", target: id, trigger: triggerOf(n, u.body), line: line(n), opts: queryOpts(n) });
      }
    }
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) for (const id of resolveCallee(n.tagName)) if (id !== u.id) { calls.add(id); edges.push([id, 'jsx']); }
    if (ts.isIdentifier(n) && n.parent && (ts.isCallExpression(n.parent) ? n.parent.expression !== n : true) && !ts.isPropertyAccessExpression(n.parent) && !ts.isImportSpecifier(n.parent) && !ts.isImportClause(n.parent) && !ts.isVariableDeclaration(n.parent) && !ts.isJsxOpeningElement(n.parent) && !ts.isJsxSelfClosingElement(n.parent) && !ts.isJsxClosingElement(n.parent)) {
      for (const id of resolveCallee(n)) {
        const tu = units.get(id);
        if (id !== u.id && tu && tu.body && (ts.isArrowFunction(tu.body) || ts.isFunctionDeclaration(tu.body) || ts.isFunctionExpression(tu.body))) {
          calls.add(id); edges.push([id, triggerOf(n, u.body) || 'ref']);
          if (tu.directive === "server" && u.directive !== "server") clientCalls.push({ kind: "action-ref", target: id, trigger: triggerOf(n, u.body), line: line(n) });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  if (u.body) visit(u.body);
  u.effects = eff;
  u.calls = [...calls];
  u.edges = edges;
  u.clientCalls = clientCalls;
}
function closure(id, seen) {
  if (seen.has(id)) return;
  seen.add(id);
  const u = units.get(id);
  if (!u) return;
  for (const c of u.calls) { const cu = units.get(c); if (cu && cu.directive !== "client") closure(c, seen); }
}
function totals(id) {
  const set = new Set(); closure(id, set);
  const t = { sql: 0, rest: 0, authNet: 0, authLocal: 0, storage: 0, redis: 0, fetch: 0, tx: 0, functions: set.size, contributors: [] };
  for (const x of set) {
    const e = units.get(x).effects;
    for (const k of ["sql", "rest", "authNet", "authLocal", "storage", "redis", "fetch", "tx"]) t[k] += e[k];
    if (e.sql || e.rest || e.authNet || e.storage || e.redis || e.fetch) t.contributors.push({ fn: x, sql: e.sql, rest: e.rest, authNet: e.authNet, storage: e.storage, redis: e.redis, fetch: e.fetch });
  }
  return t;
}
const entries = [];
for (const u of units.values()) {
  const f = u.file;
  if (u.directive === "server" && u.exported) entries.push({ kind: "action", id: u.id });
  if (/^src\/app\/.*\/route\.ts$/.test(f) && /^(GET|POST|PUT|PATCH|DELETE)$/.test(u.name)) entries.push({ kind: "route", id: u.id });
  if (/^src\/app\/(.*\/)?(page|layout)\.tsx$/.test(f) && (u.name === "default" || u.name === "generateMetadata") && u.directive !== "client") entries.push({ kind: /page\.tsx$/.test(f) ? "page" : "layout", id: u.id });
  if (/^src\/proxy\.ts$/.test(f) && u.name === "proxy") entries.push({ kind: "proxy", id: u.id });
}
function clientReach(id) {
  const seen = new Set(), acc = [];
  const walk = (x) => {
    if (seen.has(x)) return; seen.add(x);
    const u = units.get(x); if (!u || u.directive === "server") return;
    for (const c of u.clientCalls) acc.push({ from: x, ...c });
    for (const c of u.calls) walk(c);
  };
  walk(id);
  return acc;
}
const out = {
  generatedAt: new Date().toISOString(),
  units: units.size,
  entries: entries.map((e) => ({ ...e, ...totals(e.id) })),
  unitClientCalls: Object.fromEntries([...units.values()].filter((u) => u.clientCalls.length).map((u) => [u.id, u.clientCalls])),
  clientReach: Object.fromEntries([...units.values()].filter((u) => u.directive === "client" || /^src\/(hooks|components)\//.test(u.file)).map((u) => [u.id, clientReach(u.id)]).filter(([, v]) => v.length)),
  unitDirective: Object.fromEntries([...units.values()].map((u) => [u.id, u.directive])),
  callGraph: Object.fromEntries([...units.values()].map((u) => [u.id, u.calls])),
  edges: Object.fromEntries([...units.values()].map((u) => [u.id, u.edges])),
  unitFile: Object.fromEntries([...units.values()].map((u) => [u.id, u.file])),
};
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(JSON.stringify({ units: units.size, entries: entries.length }));
