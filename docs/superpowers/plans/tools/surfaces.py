"""Aggregate roundtrips.json into per-surface round-trip tables (read-only)."""
import json, re, os, sys, collections

# usage: python3 surfaces.py <roundtrips.json> <out-dir>
S = sys.argv[2] if len(sys.argv) > 2 else "."
os.makedirs(S, exist_ok=True)
d = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "roundtrips.json"))
E = {e["id"]: e for e in d["entries"]}
edges = d["edges"]
direc = d["unitDirective"]
ufile = d["unitFile"]
ucalls = d["unitClientCalls"]
JWKS = "src/lib/auth/snapshot.ts#fetchSupabaseJwks"

def cost(entry_id):
    e = E.get(entry_id)
    if not e:
        return None
    jw = sum(c["fetch"] for c in e["contributors"] if c["fn"] == JWKS)
    return dict(sql=e["sql"], rest=e["rest"], auth=e["authNet"], storage=e["storage"], redis=e["redis"], fetch=e["fetch"] - jw, fns=e["functions"])

# API url -> route entry
routes = {}
for e in d["entries"]:
    if e["kind"] == "route":
        f, m = e["id"].split("#")
        p = "/" + f[len("src/app/"):-len("/route.ts")]
        routes.setdefault(p, {})[m] = e["id"]
def route_for(url, method):
    u = url.strip().strip("`'\"")
    u = re.sub(r"\$\{[^}]*\}", "X", u).split("?")[0].rstrip("/")
    u = re.sub(r"^https?://[^/]+", "", u)
    if not u.startswith("/api/"):
        m = re.search(r"/api/[^\s'\"`]*", u)
        if not m:
            return None
        u = m.group(0)
    us = u.split("/")
    for p, ms in routes.items():
        ps = p.split("/")
        if len(ps) != len(us):
            continue
        if all(a == b or (a.startswith("[") and a.endswith("]")) or b == "X" for a, b in zip(ps, us)):
            return ms.get(method.upper()) or next(iter(ms.values()))
    return None

def is_client(uid):
    return direc.get(uid) == "client" or re.match(r"^src/(hooks|stores)/", ufile.get(uid, "")) or (direc.get(uid) is None and re.match(r"^src/components/", ufile.get(uid, "")))

def walk(roots):
    """Returns server-render units and client requests with resolved triggers."""
    requests = []  # (target_entry, trigger, via)
    seen = set()
    stack = [(r, "server", r) for r in roots]
    server_units = set()
    while stack:
        uid, ctx, via = stack.pop()
        key = (uid, ctx)
        if key in seen:
            continue
        seen.add(key)
        if ctx == "server":
            if is_client(uid) and direc.get(uid) != "server":
                stack.append((uid, "render", uid))
                continue
            server_units.add(uid)
            for tgt, trig in edges.get(uid, []):
                stack.append((tgt, "server", via))
            continue
        # client context
        for c in ucalls.get(uid, []):
            trig = c.get("trigger")
            t = "auto-conditional" if trig == "auto-conditional" else "auto" if trig in ("auto", "prefetch") else "interaction" if trig in ("interaction", "deferred") else ctx
            if c["kind"] in ("action", "action-ref"):
                requests.append((c["target"], t, uid, "action", c.get("opts")))
            elif c["kind"] == "api":
                rid = route_for(c["url"], c.get("method", "GET"))
                requests.append((rid or ("?" + c["url"]), t, uid, "api", c.get("opts")))
        for tgt, trig in edges.get(uid, []):
            if direc.get(tgt) == "server":
                continue
            if trig in ("auto", "prefetch"):
                nctx = "auto"
            elif trig == "auto-conditional":
                nctx = "auto-conditional"
            elif trig in ("interaction", "deferred"):
                nctx = "interaction"
            else:
                nctx = ctx
            stack.append((tgt, nctx, uid))
    return server_units, requests

def summarize(name, roots, server_entries):
    su, reqs = walk(roots)
    load = collections.OrderedDict()
    inter = set()
    for tgt, t, via, kind, opts in reqs:
        if t in ("auto", "render", "auto-conditional"):
            prev = load.get(tgt)
            cond = t == "auto-conditional" and (prev is None or prev[2])
            load[tgt] = (kind, via, cond, opts or (prev[3] if prev else None))
        elif t == "interaction":
            inter.add(tgt)
    rows = []
    for tgt, (kind, via, cond, opts) in load.items():
        c = cost(tgt) if not tgt.startswith("?") else None
        rows.append(dict(target=tgt, kind=kind, via=via, conditional=cond, opts=opts, **(c or dict(sql=None, rest=None, auth=None, storage=None, redis=None, fetch=None, fns=None))))
    srv = []
    for se in server_entries:
        c = cost(se)
        if c:
            srv.append(dict(target=se, **c))
    tot = dict(requests=1 + len(rows), sql=sum((r["sql"] or 0) for r in rows + srv), auth=sum((r["auth"] or 0) for r in rows + srv),
               storage=sum((r["storage"] or 0) for r in rows + srv), redis=sum((r["redis"] or 0) for r in rows + srv), rest=sum((r["rest"] or 0) for r in rows + srv),
               fetch=sum((r["fetch"] or 0) for r in rows + srv), actions=sum(1 for r in rows if r["kind"] == "action"), apis=sum(1 for r in rows if r["kind"] == "api"),
               interaction=len(inter - set(load)), conditional=sum(1 for r in rows if r.get("conditional")))
    return dict(name=name, server=srv, load=rows, totals=tot)

pages = sorted(e["id"] for e in d["entries"] if e["kind"] == "page" and e["id"].endswith("#default"))
def route_name(pid):
    f = pid.split("#")[0][len("src/app"):-len("/page.tsx")] or "/"
    f = re.sub(r"/\([^)]*\)", "", f) or "/"
    return f
def layouts_for(pid):
    f = pid.split("#")[0]
    out = []
    parts = f.split("/")[:-1]
    for i in range(2, len(parts) + 1):
        lp = "/".join(parts[:i]) + "/layout.tsx#default"
        if lp in E:
            out.append(lp)
    return out

surfaces = []
shell_roots = ["src/app/(main)/layout.tsx#default"]
shell = summarize("App shell (every signed-in page)", shell_roots, ["src/proxy.ts#proxy", "src/app/(main)/layout.tsx#default"])
surfaces.append(shell)
shell_targets = {r["target"] for r in shell["load"]}
for pid in pages:
    roots = [pid]
    se = [pid] + ([pid.replace("#default", "#generateMetadata")] if pid.replace("#default", "#generateMetadata") in E else [])
    s = summarize(route_name(pid), roots, se)
    s["layouts"] = layouts_for(pid)
    surfaces.append(s)
tabs = {
    "Project · Dashboard tab": "src/components/projects/tabs/DashboardTab.tsx#default",
    "Project · Docs tab": "src/components/projects/tabs/DocTab.tsx#default",
    "Project · Updates tab": "src/components/projects/tabs/UpdatesTab.tsx#default",
    "Project · Tasks tab": "src/components/projects/v2/TasksTab.tsx#default",
    "Project · Files tab": "src/components/projects/v2/files-tab/FilesTabRoot.tsx#FilesTabRoot",
    "Project · Sprints tab": "src/components/projects/tabs/SprintPlanning.tsx#default",
    "Project · Settings tab": "src/components/projects/tabs/ProjectSettingsTab.tsx#default",
}
for n, r in tabs.items():
    if r not in direc:
        alt = [k for k in direc if k.startswith(r.split("#")[0] + "#")]
        r = alt[0] if alt else r
    s = summarize(n, [r], [])
    s["totals"]["requests"] -= 1  # tabs mount client-side; the RSC refresh is counted on the project page
    surfaces.append(s)

json.dump(dict(surfaces=surfaces, shell_targets=sorted(shell_targets)), open(os.path.join(S, "surfaces.json"), "w"), indent=1)
for s in surfaces:
    t = s["totals"]
    print(f"{s['name'][:40]:40} req={t['requests']:3} actions={t['actions']:2} api={t['apis']:2} sql={t['sql']:4} auth={t['auth']:3} storage={t['storage']:2} redis={t['redis']:2} rest={t['rest']:2} fetch={t['fetch']:2} click={t['interaction']:3} cond={t['conditional']:2}")
