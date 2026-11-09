// A local stand-in for the NetworkBase API, so CLI tests never use the network.
// Routes answer in the 1.x `/api/v1/extension/*` shapes; Phase 1 adds the resource API.
import http from "node:http";
import crypto from "node:crypto";

/** @typedef {"drop" | "429" | "503" | "slow" | "corrupt"} Fault */
/** @typedef {{ method: string, path: string, query: URLSearchParams, headers: http.IncomingHttpHeaders, body: any }} FakeRequest */
/** @typedef {{ status?: number, headers?: Record<string, string>, body?: any, data?: any }} FakeResponse */
/** @typedef {(req: FakeRequest, state: FakeState) => FakeResponse | Promise<FakeResponse>} Handler */
/** @typedef {{ path: string, nodeId: string, version: number, content: Buffer }} FakeFile */
/** @typedef {{ workspace: { id: string, title: string, slug: string, role: string }, files: Map<string, FakeFile>, tasks: any[] }} FakeState */

export const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

const sha256 = (/** @type {Buffer} */ buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** @param {FakeState} state @param {string} path @param {Buffer} content */
export function putFile(state, path, content) {
  const prev = state.files.get(path);
  const file = { path, nodeId: prev?.nodeId ?? crypto.randomUUID(), version: (prev?.version ?? 0) + 1, content };
  state.files.set(path, file);
  return { file, prev };
}

/** @param {FakeFile} f */
const fileMeta = (f) => ({ id: f.nodeId, nodeId: f.nodeId, path: f.path, size: f.content.length, contentHash: sha256(f.content), currentVersion: f.version });

/** @type {Record<string, Handler>} */
const defaultRoutes = {
  "GET /api/v1/extension/session": (req) => {
    const token = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (!/^nb_(pat|dev)_/.test(token)) return { status: 401, body: { success: false, message: "Sign in to continue", errorCode: "UNAUTHORIZED" } };
    return { data: { sessionId: "s1", active: true, tokenType: token.startsWith("nb_pat_") ? "pat" : "device", user: { id: "u1", email: "t@example.com", username: "tester", fullName: "Test User" } } };
  },
  "GET /api/v1/extension/workspaces": (_req, state) => ({ data: { workspaces: [state.workspace] } }),
  "GET /api/v1/extension/workspace-tasks": (_req, state) => ({ data: { tasks: state.tasks } }),
  "GET /api/v1/extension/search": (_req, state) => ({ data: { files: [...state.files.values()].map(fileMeta), nextCursor: null } }),
  "GET /api/v1/extension/file": (req, state) => {
    const f = state.files.get(req.query.get("path") ?? "");
    if (!f) return { status: 404, body: { success: false, message: "File not found", errorCode: "NOT_FOUND" } };
    const hash = sha256(f.content);
    if (String(req.headers["if-none-match"] ?? "").replace(/"/g, "") === hash) return { status: 304 };
    return { data: { ...fileMeta(f), encoding: "base64", content: f.content.toString("base64") } };
  },
  "POST /api/v1/extension/fast-push": (req, state) => {
    const files = (req.body?.files ?? []).map((/** @type {any} */ item) => {
      const content = Buffer.from(item.contentBase64 ?? "", "base64");
      const prev = state.files.get(item.path);
      if (prev && sha256(prev.content) === sha256(content)) {
        return { ...fileMeta(prev), status: "unchanged", version: prev.version, versionTransition: `v${prev.version} (unchanged)` };
      }
      const { file } = putFile(state, item.path, content);
      return { ...fileMeta(file), status: prev ? "modified" : "new", version: file.version, versionTransition: prev ? `v${prev.version} -> v${file.version}` : "v1 (new)" };
    });
    const uploadedCount = files.filter((/** @type {any} */ f) => f.status !== "unchanged").length;
    return { data: { success: true, fastPath: true, projectId: req.body?.projectId, taskId: null, role: req.body?.role ?? "working", uploadedCount, unchangedCount: files.length - uploadedCount, taskPushReceipt: null, files } };
  },
};

/**
 * @param {{ routes?: Record<string, Handler>, fault?: Record<string, Fault> }} [options]
 */
export async function startFakeServer({ routes = {}, fault = {} } = {}) {
  /** @type {FakeState} */
  const state = { workspace: { id: WORKSPACE_ID, title: "Design Lab", slug: "design-lab", role: "owner" }, files: new Map(), tasks: [] };
  /** @type {FakeRequest[]} */
  const requests = [];
  const faults = new Map(Object.entries(fault));
  const table = { ...defaultRoutes, ...routes };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
    /** @type {FakeRequest} */
    const fakeReq = { method: req.method ?? "GET", path: url.pathname, query: url.searchParams, headers: req.headers, body };
    requests.push(fakeReq);

    const f = faults.get(url.pathname);
    if (f === "drop") { req.socket.destroy(); return; }
    if (f === "429") { res.writeHead(429, { "content-type": "application/json", "retry-after": "1" }); res.end(JSON.stringify({ success: false, message: "Too many requests", errorCode: "RATE_LIMITED" })); return; }
    if (f === "503") { res.writeHead(503, { "content-type": "text/plain" }); res.end("Service Unavailable"); return; }
    if (f === "corrupt") { res.writeHead(200, { "content-type": "application/json" }); res.end("{not json"); return; }
    if (f === "slow") await new Promise((r) => setTimeout(r, 2000));

    const handler = table[`${fakeReq.method} ${url.pathname}`];
    if (!handler) { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ success: false, message: `No fake route for ${fakeReq.method} ${url.pathname}`, errorCode: "NOT_FOUND" })); return; }
    const out = await handler(fakeReq, state);
    const status = out.status ?? 200;
    if (status === 304) { res.writeHead(304); res.end(); return; }
    res.writeHead(status, { "content-type": "application/json", ...out.headers });
    res.end(JSON.stringify(out.body ?? { success: true, data: out.data }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    state,
    requests,
    /** @param {string} path @param {Fault | null} value */
    setFault(path, value) { if (value) faults.set(path, value); else faults.delete(path); },
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve(undefined)); }),
  };
}
