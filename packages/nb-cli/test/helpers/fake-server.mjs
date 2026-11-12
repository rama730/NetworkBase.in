// A local stand-in for the NetworkBase API, so CLI tests never use the network. It follows the real routes'
// shapes (Phase 1: /me, /files/place, /workspaces/:id/manifest, /tasks/count, docs; and the extension routes).
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";

import { validate } from "./json-schema.mjs";

/** The real server's request schemas (generated, schema/api.json): a body it would refuse is refused here too. */
const API_SCHEMAS = JSON.parse(fs.readFileSync(new URL("../../schema/api.json", import.meta.url), "utf8")).operations;

/** @typedef {"drop" | "429" | "503" | "slow" | "corrupt"} Fault */
/** @typedef {{ method: string, path: string, query: URLSearchParams, headers: http.IncomingHttpHeaders, body: any, params: string[] }} FakeRequest */
/** @typedef {{ status?: number, headers?: Record<string, string>, body?: any, data?: any, raw?: Buffer }} FakeResponse */
/** @typedef {(req: FakeRequest, state: FakeState) => FakeResponse | Promise<FakeResponse>} Handler */
/** @typedef {{ path: string, nodeId: string, version: number, content: Buffer, updatedAt: string }} FakeFile */
/** @typedef {{ id: string, taskNumber: number, title: string, status: string, reviewStatus: string, updatedAt: string, description: string, priority: string, assigneeUsername: string | null, dueDate?: string | null, subtasks: any[], files: any[], comments: any[] }} FakeTask */
/** @typedef {{ workspace: { id: string, title: string, slug: string, role: string }, files: Map<string, FakeFile>, tasks: FakeTask[], docs: Array<{ slug: string, filename: string, nodePath: string | null, starter?: string }>, reviewRequired: boolean, canWrite: boolean, revoked: Set<string>, undos: Map<string, any>, undone: any[], questions: any[], autoAnswer: string | null, sessionsEnded: number, fileOps: any[], fileComments: any[], updates: string[], assignments: any[], inbox: any[], events: any[], agentAccess?: any, lastCreate?: any, device: { answer: "approve" | "deny" | "never", afterPolls: number, polls: number, lastBody: any, tokenType: "device" | "agent" } }} FakeState */

export const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
export const TOKEN = "nb_pat_test0123456789abcdef";

const sha256 = (/** @type {Buffer} */ buf) => crypto.createHash("sha256").update(buf).digest("hex");
const now = () => new Date().toISOString();

/** @param {FakeState} state @param {string} path @param {Buffer} content */
export function putFile(state, path, content) {
  const prev = state.files.get(path);
  const file = { path, nodeId: prev?.nodeId ?? crypto.randomUUID(), version: (prev?.version ?? 0) + 1, content, updatedAt: now() };
  state.files.set(path, file);
  return { file, prev };
}

/** @param {FakeState} state @param {Partial<FakeTask>} task */
export function addTask(state, task) {
  const t = { id: crypto.randomUUID(), taskNumber: state.tasks.length + 1, title: "Task", status: "todo", reviewStatus: "none", updatedAt: now(), description: "", priority: "medium", assigneeUsername: "tester", subtasks: [], files: [], comments: [], ...task };
  state.tasks.push(t);
  return t;
}

/** @param {FakeFile} f */
const meta = (f) => ({ nodeId: f.nodeId, path: f.path, version: f.version, contentHash: sha256(f.content), size: f.content.length, updatedAt: f.updatedAt });
const fail = (/** @type {number} */ status, /** @type {string} */ errorCode, /** @type {string} */ message, /** @type {any} */ details = undefined) => ({ status, body: { success: false, errorCode, message, ...(details ? { details } : {}) } });

/** @param {FakeState} state @param {string} ref */
const findTask = (state, ref) => state.tasks.find((t) => t.id === ref || String(t.taskNumber) === ref);

/** @type {Record<string, Handler>} */
const exact = {
  "GET /api/v1/health": () => ({ data: { status: "ok" } }),
  "GET /api/v1/extension/session": (req, state) => {
    const token = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (!/^nb_(pat|dev|agt)_/.test(token)) return fail(401, "UNAUTHORIZED", "Sign in to continue");
    return { data: { sessionId: "s1", active: !state.revoked.has(token), tokenType: "pat", user: { id: "u1", email: "t@example.com", username: "tester", fullName: "Test User" } } };
  },
  "POST /api/v1/extension/session": (req, state) => {
    state.revoked.add(String(req.headers.authorization ?? "").replace(/^Bearer /, ""));
    return { data: { revoked: true } };
  },
  "POST /api/v1/extension/auth-code": (req) => (req.body?.code === "good-code" && req.body?.codeVerifier ? { data: { token: TOKEN } } : fail(401, "UNAUTHORIZED", "Bad code")),
  "POST /api/v1/agent-sessions/end": (_req, state) => { state.sessionsEnded += 1; return { data: { sent: 0 } }; },
  "POST /api/v1/questions": (req, state) => {
    const q = { schema: "nb.question/1", id: crypto.randomUUID(), workspaceId: req.body.projectId, taskId: req.body.taskId ?? null, to: req.body.to ?? "me", agentName: null, context: req.body.context ?? null, questions: req.body.questions, status: "open", answer: /** @type {any} */ (null), polls: 0 };
    state.questions.push(q);
    return { data: q };
  },
  "GET /api/v1/assignments": (_req, state) => ({ data: { copies: state.assignments.map((a) => ({ id: a.id, number: a.number, title: a.title, org: "Physics 101", orgId: WORKSPACE_ID, workspaceId: WORKSPACE_ID, due: a.due, state: a.state, late: false, submissionType: a.submissionType, aiPolicy: a.aiPolicy, team: null })) } }),
  "GET /api/v1/reviews": (req, state) => (req.query.get("org") ? { data: { rows: state.assignments.filter((a) => a.state === "submitted").map((a) => ({ kind: "copy", mine: true, copyId: a.id, masterId: a.id, title: a.title, who: "Sam Lee", submittedBy: "u2", submittedAt: now(), late: false, href: "", projectId: WORKSPACE_ID, updatedAt: now(), version: 1, link: null, text: null, note: null, files: [], versions: [] })), total: 1, nextCursor: null } } : fail(400, "BAD_REQUEST", "Which organization?")),
  "GET /api/v1/inbox": (_req, state) => ({ data: { items: state.inbox, nextCursor: null, hasMore: false, unreadCount: state.inbox.filter((i) => !i.readAt).length, unreadImportantCount: 0 } }),
  "POST /api/v1/inbox/read": (req, state) => {
    const ids = req.body.all ? state.inbox.filter((i) => !i.readAt).map((i) => i.id) : req.body.ids;
    for (const i of state.inbox) if (ids.includes(i.id)) i.readAt = now();
    return { data: { read: ids.length } };
  },
  "GET /api/v1/events": async (req, state) => {
    // Hands out queued events once; with none, waits a little like the real long-poll and answers empty. It never
    // takes an event after the wait: nb exits at once on Ctrl+C, and a dead client's held request would swallow the
    // next test's event (seen on fast macOS runners).
    const next = state.events.shift();
    if (next) return { data: { cursor: now(), ...next } };
    await new Promise((r) => setTimeout(r, 150));
    return { data: { cursor: now(), notifications: [], files: [] } };
  },
  "GET /api/v1/tokens": (req) => {
    const current = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
    return { data: { tokens: [
      { id: "aaaa1111-0000-4000-8000-000000000001", type: "device", name: "laptop", agentName: null, workspace: null, lastUsedAt: now(), current: current === TOKEN },
      { id: "bbbb2222-0000-4000-8000-000000000002", type: "agent", name: "laptop", agentName: "Claude Code", workspace: "Design Lab", lastUsedAt: null, current: false, access: "Claude Code can work in Design Lab for 30 days. It does small things itself and can't finish tasks, change final files or edit docs." },
    ] } };
  },
  "GET /api/v1/questions": (_req, state) => ({ data: { questions: state.questions.filter((q) => q.status === "open") } }),
  "POST /api/v1/device/code": (req, state) => {
    state.device.lastBody = req.body;
    state.device.polls = 0;
    return { data: { deviceCode: "dc_0123456789abcdefghijklmnop", userCode: "ABCD-EFGH", verificationUri: "http://fake/device", verificationUriComplete: "http://fake/device?code=ABCD-EFGH", interval: 0, expiresIn: 600 } };
  },
  "POST /api/v1/device/token": (_req, state) => {
    const d = state.device;
    d.polls += 1;
    if (d.polls < d.afterPolls || d.answer === "never") return { data: { status: d.polls === 1 ? "slow_down" : "pending" } };
    if (d.answer === "deny") return fail(403, "FORBIDDEN", "Sign-in was denied in the browser", { status: "denied" });
    return { data: { status: "approved", token: d.tokenType === "agent" ? "nb_agt_0123456789abcdef0123" : TOKEN, tokenType: d.tokenType, workspaceId: d.tokenType === "agent" ? WORKSPACE_ID : null } };
  },
  "GET /api/v1/me": (req, state) => {
    const agent = String(req.headers.authorization ?? "").startsWith("Bearer nb_agt_");
    const access = agent ? state.agentAccess ?? { agentName: "Claude Code", preset: "small", sentence: "Claude Code can work in Design Lab for 30 days. It does small things itself and can't finish tasks, change final files or edit docs.", workspaceId: WORKSPACE_ID, workspaceTitle: "Design Lab", allWorkspaces: false, expiresAt: "2026-12-11T00:00:00.000Z" } : null;
    return { data: { user: { id: "aaaaaaaa-1111-4111-8111-111111111111", username: "tester", fullName: "Test User", email: "t@example.com" }, credential: { kind: "token", type: agent ? "agent" : String(req.headers.authorization ?? "").startsWith("Bearer nb_dev_") ? "device" : "pat", expiresAt: "2027-11-06T09:34:59.663Z", workspaceId: agent ? WORKSPACE_ID : null, scopes: ["file:read", "file:write", "task:read", "task:write", "workspace:read"] }, limits: { largestFileBytes: 10 * 1024 * 1024 }, access } };
  },
  "GET /api/v1/extension/workspaces": (_req, state) => ({ data: { workspaces: [state.workspace] } }),
  "GET /api/v1/extension/workspace-tasks": (req, state) => ({ data: { tasks: state.tasks.filter((t) => req.query.get("scope") !== "mine" || t.assigneeUsername === "tester").map((t) => ({ ...t, subtaskSummary: { completed: t.subtasks.filter((s) => s.completed).length, total: t.subtasks.length } })) } }),
  "GET /api/v1/extension/task-detail": (req, state) => {
    const t = findTask(state, req.query.get("taskId") ?? req.query.get("taskNumber") ?? "");
    if (!t) return fail(404, "NOT_FOUND", "Task not found");
    state.detailReads = [...(state.detailReads ?? []), req.query.get("brief") === "1" ? "brief" : "full"];
    // Like the server's brief=1 (C16 #9): the task row only.
    if (req.query.get("brief") === "1") return { data: { task: { id: t.id, taskNumber: t.taskNumber, title: t.title, status: t.status, reviewStatus: t.reviewStatus, updatedAt: t.updatedAt, assigneeId: t.assigneeUsername ? "aaaaaaaa-1111-4111-8111-111111111111" : null } } };
    return { data: { task: t, subtasks: t.subtasks, files: t.files, comments: t.comments, pushes: [] } };
  },
  "GET /api/v1/tasks/count": (_req, state) => {
    const open = state.tasks.filter((t) => t.status !== "done" || t.reviewStatus === "pending");
    const by = (/** @type {string} */ s) => open.filter((t) => t.status === s).length;
    return { data: { open: open.length, byStatus: { todo: by("todo"), in_progress: by("in_progress"), blocked: by("blocked"), in_review: open.filter((t) => t.reviewStatus === "pending").length }, overdue: 0, dueThisWeek: 0 } };
  },
  "POST /api/v1/extension/create-task": (req, state) => {
    state.lastCreate = req.body;
    // Like the server (C16 #3): left out, the task is the caller's; null leaves it unassigned.
    const who = req.body.assigneeId === undefined ? "tester" : req.body.assigneeId?.startsWith("bbbbbbbb") ? "sam" : req.body.assigneeId ? "tester" : null;
    return { data: { task: addTask(state, { title: req.body.title, description: req.body.description ?? "", priority: req.body.priority ?? "medium", assigneeUsername: who, dueDate: req.body.dueDate ?? null }) } };
  },
  "POST /api/v1/extension/task-subtask": (req, state) => {
    const t = findTask(state, req.body.taskId);
    if (!t) return fail(404, "NOT_FOUND", "Task not found");
    const s = { id: crypto.randomUUID(), title: req.body.title, completed: false, index: t.subtasks.length + 1, updatedAt: now() };
    t.subtasks.push(s);
    return { data: { subtask: s } };
  },
  "PATCH /api/v1/extension/task-update": (req, state) => {
    // Like the real server (report A5): a Small agent finishing a task asks the person for the permission first.
    if (state.agentAccess?.preset === "small" && String(req.headers.authorization ?? "").startsWith("Bearer nb_agt_") && req.body.kind === "status" && req.body.status === "done") {
      return fail(403, "ACCESS_REQUESTED", "This agent needs the task:complete permission, so it asked you in NetworkBase.", { requestId: "req-1", scope: "task:complete" });
    }
    // Like the real server (report §26.6): an agent finishing a task needs the person's yes.
    if (String(req.headers.authorization ?? "").startsWith("Bearer nb_agt_") && req.body.kind === "status" && req.body.status === "done") {
      if (req.headers["x-nb-confirm"] !== "srv.yes-token") return fail(428, "NEEDS_CONFIRMATION", "Needs the person's yes: Finish the task", { summary: "Finish the task", confirmToken: "srv.yes-token", header: "x-nb-confirm" });
    }
    const t = findTask(state, req.body.taskId);
    if (!t) return fail(404, "NOT_FOUND", "Task not found");
    if (req.body.kind === "subtask") {
      const s = t.subtasks.find((x) => x.id === req.body.subtaskId);
      if (!s || s.updatedAt !== req.body.expectedUpdatedAt) return fail(409, "CONFLICT", "Subtask changed elsewhere");
      s.completed = req.body.completed;
      s.updatedAt = now();
      return { data: { subtask: s } };
    }
    if (req.body.kind === "edit") { /** @type {any} */ (t)[req.body.field === "dueDate" ? "dueDate" : req.body.field] = req.body.value; t.updatedAt = now(); return { data: { success: true, undoToken: crypto.randomUUID() } }; }
    if (req.body.kind === "assign") { t.assigneeUsername = req.body.assigneeId?.startsWith("aaaaaaaa") ? "tester" : req.body.assigneeId?.startsWith("bbbbbbbb") ? "sam" : null; t.updatedAt = now(); return { data: { success: true } }; }
    if (req.body.kind === "delete") { state.tasks.splice(state.tasks.indexOf(t), 1); return { data: { deleted: true } }; }
    if (req.body.kind === "subtask_edit") { const s = t.subtasks.find((x) => x.id === req.body.subtaskId); if (!s) return fail(404, "NOT_FOUND", "Subtask not found"); s.title = req.body.title; return { data: { success: true } }; }
    if (req.body.kind === "subtask_delete") { t.subtasks = t.subtasks.filter((x) => x.id !== req.body.subtaskId); return { data: { deleted: true } }; }
    if (req.body.kind === "subtask_move") {
      const s = t.subtasks.find((x) => x.id === req.body.subtaskId);
      if (!s) return fail(404, "NOT_FOUND", "Subtask not found");
      t.subtasks = t.subtasks.filter((x) => x !== s);
      t.subtasks.splice(req.body.position, 0, s);
      return { data: { order: t.subtasks.map((x) => x.id) } };
    }
    if (t.updatedAt !== req.body.expectedUpdatedAt) return fail(409, "CONFLICT", "Task changed elsewhere. Reload before retrying.");
    if (req.body.kind === "status") {
      t.status = req.body.status;
      t.reviewStatus = req.body.status === "done" && state.reviewRequired ? "pending" : "none";
      t.updatedAt = now();
      return { data: { status: t.status, reviewStatus: t.reviewStatus, outcome: t.reviewStatus === "pending" ? "submitted" : req.body.status === "done" ? "completed" : "moved", evidence: req.body.evidence ?? null, warnings: [] } };
    }
    if (req.body.kind === "approve") { t.reviewStatus = "none"; t.updatedAt = now(); return { data: { success: true } }; }
    if (req.body.kind === "request_changes") { t.status = "in_progress"; t.reviewStatus = "rejected"; t.updatedAt = now(); return { data: { success: true } }; }
    if (req.body.kind === "resubmit") { t.status = "done"; t.reviewStatus = "pending"; t.updatedAt = now(); return { data: { success: true } }; }
    return fail(400, "BAD_REQUEST", "Invalid task update");
  },
  "POST /api/v1/extension/comments": (req, state) => {
    if (req.body.kind === "create" || req.body.kind === "resolve") {
      const threadId = req.body.threadId ?? crypto.randomUUID();
      state.fileComments.push({ id: crypto.randomUUID(), sequence: state.fileComments.length + 1, name: "Test User", createdAt: now(), metadata: { threadId, ...(req.body.text ? { text: req.body.text } : {}), ...(req.body.anchor ? { anchor: req.body.anchor } : {}), ...(req.body.kind === "resolve" ? { resolved: req.body.resolved, expectedSequence: req.body.expectedSequence } : {}) } });
      return { data: { threadId } };
    }
    const t = findTask(state, req.body.taskId);
    if (!t) return fail(404, "NOT_FOUND", "Task not found");
    t.comments.push({ authorUsername: "tester", content: req.body.text ?? req.body.content });
    return { data: { comment: { id: crypto.randomUUID() } } };
  },
  "GET /api/v1/extension/search": (req, state) => ({ data: { files: [...state.files.values()].filter((f) => f.path.includes(req.query.get("q") ?? "")).map((f) => ({ ...meta(f), currentVersion: f.version })), nextCursor: null } }),
  "GET /api/v1/extension/file": (req, state) => {
    const f = state.files.get(req.query.get("path") ?? "");
    if (!f) return fail(404, "NOT_FOUND", "File not found");
    if (req.query.get("transfer") === "raw") return { raw: f.content };
    if (req.query.get("transfer") === "metadata") return { data: { ...meta(f), id: f.nodeId, currentVersion: f.version } };
    return { data: { ...meta(f), currentVersion: f.version, encoding: "base64", content: f.content.toString("base64") } };
  },
  "POST /api/v1/extension/file-operation": (req, state) => {
    state.fileOps.push(req.body);
    if (req.body.kind === "rename") {
      const hit = [...state.files].find(([, f]) => f.nodeId === req.body.nodeId);
      if (hit) { const [p, f] = hit; state.files.delete(p); const np = `${p.slice(0, p.lastIndexOf("/"))}/${req.body.name}`; state.files.set(np, { ...f, path: np }); }
      return { data: { renamed: true } };
    }
    if (req.body.kind !== "trash") return { data: { moved: true } };
    for (const [p, f] of state.files) if (f.nodeId === req.body.nodeId) state.files.delete(p);
    return { data: { trashed: true } };
  },
  "GET /api/v1/extension/file-history": (req, state) => {
    const f = [...state.files.values()].find((x) => x.nodeId === req.query.get("nodeId"));
    if (!f) return fail(404, "NOT_FOUND", "File not found");
    return { data: { versions: Array.from({ length: f.version }, (_, i) => ({ version: f.version - i, uploadedAt: f.updatedAt, uploadedByUsername: "tester", via: i === 0 ? "agent" : null, agentName: i === 0 ? "Claude Code" : null, comment: null })) } };
  },
  "GET /api/v1/extension/comments": (_req, state) => ({ data: { events: state.fileComments } }),
  "POST /api/v1/files/place": (req, state) => {
    if (!state.canWrite) return fail(403, "FORBIDDEN", "You don’t have write access to this workspace");
    const files = req.body.files ?? [];
    const findings = files.filter((/** @type {any} */ f) => /nb_pat_[A-Za-z0-9]{16,}/.test(Buffer.from(f.contentBase64 ?? "", "base64").toString("utf8"))).map((/** @type {any} */ f) => ({ path: f.path, rule: "NetworkBase token", line: 1 }));
    if (findings.length && !req.body.confirmSecrets) return fail(422, "SECRET_DETECTED", "These files look like they contain passwords or keys", { findings });
    const conflicts = files.flatMap((/** @type {any} */ f) => {
      const cur = state.files.get(f.path);
      return cur && f.baseVersion && cur.version !== f.baseVersion && sha256(cur.content) !== f.contentHash ? [{ path: f.path, baseVersion: f.baseVersion, currentVersion: cur.version }] : [];
    });
    if (conflicts.length) return fail(409, "VERSION_CONFLICT", `${conflicts[0].path} changed on the server`, { conflicts });
    const out = files.map((/** @type {any} */ f) => {
      const content = Buffer.from(f.contentBase64 ?? "", "base64");
      let target = req.body.folder ? `${req.body.folder}/${f.path.replace(/^\//, "")}` : f.path;
      const cur = state.files.get(target);
      if (cur && sha256(cur.content) === sha256(content)) return { ...meta(cur), status: "unchanged" };
      if (cur && req.body.onSameName === "keep-both") target = target.replace(/(\.[^./]+)?$/, " (2)$1");
      const { file, prev } = putFile(state, target, content);
      return { ...meta(file), status: prev && target === f.path ? "modified" : "new", versionTransition: prev ? `v${prev.version} -> v${file.version}` : "v1 (new)" };
    });
    const linked = req.body.linkDoc ? state.docs.find((d) => d.slug === req.body.linkDoc) : null;
    if (linked) linked.nodePath = out[0].path;
    const task = req.body.taskId ? findTask(state, req.body.taskId) : null;
    if (task) for (const f of out) task.files.push({ path: f.path, name: f.path.split("/").pop(), role: req.body.role === "final" ? "deliverable" : req.body.role === "reference" ? "reference" : "working", currentVersion: f.version });
    const undoToken = crypto.randomUUID();
    state.undos.set(undoToken, { kind: "push", paths: out.filter((/** @type {any} */ f) => f.status !== "unchanged").map((/** @type {any} */ f) => f.path) });
    return { data: { success: true, files: out, role: req.body.role ?? "working", as: req.body.role ?? "draft", transition: null, undoToken } };
  },
};

/** Routes with ids in the path. @type {Array<[RegExp, string, Handler]>} */
const patterns = [
  [/^\/api\/v1\/workspaces\/([^/]+)$/, "GET", (_req, /** @type {FakeState} */ state) => ({ data: { id: WORKSPACE_ID, title: state.workspace.title, slug: state.workspace.slug, description: null, role: "owner", canWrite: true, openTasks: state.tasks.filter((t) => t.status !== "done").length, files: state.files.size, currentSprint: null, words: { main: "Sprint", inner: "Sprint", plan: "Plan", isClass: false }, organization: null, agents: { policy: "ask_important", paused: false } } })],
  [/^\/api\/v1\/workspaces\/([^/]+)\/activity$/, "GET", (_req, /** @type {FakeState} */ state) => ({ data: { items: state.tasks.map((t) => ({ at: t.updatedAt, kind: "task", type: "status_changed", by: "tester", via: "agent", agentName: "Claude Code", task: { id: t.id, number: t.taskNumber, title: t.title }, detail: `→ ${t.status}` })), nextBefore: null } })],
  [/^\/api\/v1\/workspaces\/([^/]+)\/sprints$/, "GET", (req, /** @type {FakeState} */ state) => ({ data: { words: { main: "Unit", inner: "Week", plan: "Term", isClass: true }, sprints: [{ id: "s1111111-1111-4111-8111-111111111111", number: 1, name: "Unit 1", goal: "Basics", status: "active", startDate: now(), endDate: now(), open: state.tasks.length, done: 0 }], unplanned: 0, ...(req.query.get("sprint") ? { tasks: state.tasks.map((t) => ({ id: t.id, number: t.taskNumber, title: t.title, status: t.status })) } : {}) } })],
  [/^\/api\/v1\/workspaces\/([^/]+)\/updates$/, "POST", (req, /** @type {FakeState} */ state) => { state.updates.push(req.body.content); return { data: { success: true } }; }],
  [/^\/api\/v1\/tasks\/([^/]+)\/files$/, "POST", (req, /** @type {FakeState} */ state) => {
    const t = findTask(state, req.params[0] ?? "");
    if (!t) return fail(404, "NOT_FOUND", "Task not found");
    if (req.body.detach) t.files = t.files.filter((f) => f.path !== req.body.path);
    else t.files.push({ path: req.body.path, name: req.body.path.split("/").pop(), role: req.body.as === "final" ? "deliverable" : req.body.as === "reference" ? "reference" : "working" });
    return { data: { ok: true } };
  }],
  [/^\/api\/v1\/questions\/([^/]+)$/, "GET", (/** @type {FakeRequest} */ req, /** @type {FakeState} */ state) => {
    const q = state.questions.find((x) => x.id === req.params[0]);
    if (!q) return fail(404, "NOT_FOUND", "Question not found");
    // The person answers on the second wait, like someone opening the notification.
    q.polls += 1;
    if (q.status === "open" && state.autoAnswer && q.polls >= 2) Object.assign(q, { status: "answered", answer: { [q.questions[0].key]: state.autoAnswer } });
    return { data: q };
  }],
  [/^\/api\/v1\/questions\/([^/]+)\/answer$/, "POST", (/** @type {FakeRequest} */ req, /** @type {FakeState} */ state) => {
    const q = state.questions.find((x) => x.id === req.params[0]);
    if (!q || q.status !== "open") return fail(409, "CONFLICT", "Already answered");
    Object.assign(q, { status: "answered", answer: req.body.answers });
    return { data: q };
  }],
  [/^\/api\/v1\/assignments\/([^/]+)$/, "GET", (/** @type {FakeRequest} */ req, /** @type {FakeState} */ state) => {
    const a = state.assignments.find((x) => x.id === req.params[0]);
    if (!a) return fail(404, "NOT_FOUND", "No such assignment");
    const files = [...state.files.values()].filter((f) => f.path.startsWith("/hand-in/")).map((f) => ({ nodeId: f.nodeId, name: f.path.split("/").pop(), size: f.content.length, projectId: WORKSPACE_ID, path: f.path }));
    return { data: { id: a.id, number: a.number, title: a.title, instructions: "Write 500 words.", instructionsUpdatedAt: null, team: null, aiPolicy: a.aiPolicy, aiPolicyWords: "", aiNote: a.aiNote ?? null, holder: true, submissionType: a.submissionType, reviewRequired: true, dueDate: a.due, lateLabel: "Late work accepted", from: "Physics 101", reviewers: "Teacher or TA", state: a.state, late: false, canSubmit: a.state !== "done", closed: false, approved: false, excusedReason: null, returned: null, latest: a.state === "submitted" ? { version: 1, at: now(), by: "Sam Lee", link: null, text: null, note: null, files } : null, files, materials: [], wouldBeLate: Boolean(a.late), projectId: WORKSPACE_ID, orgId: WORKSPACE_ID, masterId: a.id, steps: [], maxFileBytes: 10485760, history: [] } };
  }],
  [/^\/api\/v1\/assignments\/([^/]+)\/hand-in$/, "POST", (/** @type {FakeRequest} */ req, /** @type {FakeState} */ state) => {
    const a = state.assignments.find((x) => x.id === req.params[0]);
    if (!a) return fail(404, "NOT_FOUND", "No such assignment");
    Object.assign(a, { state: "submitted", handIn: req.body });
    return { data: { handedIn: true } };
  }],
  [/^\/api\/v1\/assignments\/([^/]+)\/hand-in$/, "DELETE", (/** @type {FakeRequest} */ req, /** @type {FakeState} */ state) => {
    const a = state.assignments.find((x) => x.id === req.params[0]);
    if (!a) return fail(404, "NOT_FOUND", "No such assignment");
    if (a.state !== "submitted") return fail(409, "CONFLICT", "There’s no hand-in to take back.");
    Object.assign(a, { state: "in_progress" });
    return { data: { handedIn: false } };
  }],
  [/^\/api\/v1\/assignments\/([^/]+)\/question$/, "POST", (/** @type {FakeRequest} */ req, /** @type {FakeState} */ state) => { state.updates.push(`question: ${req.body.text}`); return { data: { asked: true } }; }],
  [/^\/api\/v1\/reviews\/([^/]+)$/, "POST", (/** @type {FakeRequest} */ req, /** @type {FakeState} */ state) => {
    const a = state.assignments.find((x) => x.id === req.params[0]);
    if (!a) return fail(404, "NOT_FOUND", "No such hand-in");
    Object.assign(a, { state: req.body.decision === "approve" ? "done" : "returned", review: req.body });
    return { data: { decision: req.body.decision } };
  }],
  [/^\/api\/v1\/tokens\/([^/]+)\/revoke$/, "POST", (/** @type {FakeRequest} */ req, /** @type {FakeState} */ state) => { state.revoked.add(req.params[0] ?? ""); return { data: { revoked: true } }; }],
  [/^\/api\/v1\/undo\/([^/]+)$/, "POST", (/** @type {FakeRequest} */ req, /** @type {FakeState} */ state) => {
    const op = state.undos.get(req.params[0] ?? "");
    if (!op) return fail(410, "EXPIRED", "Nothing to undo: it was undone already, is older than 24 hours, or isn't yours");
    state.undos.delete(req.params[0] ?? "");
    state.undone.push(op);
    return { data: { undone: op.kind === "push" ? `Pushed ${op.paths.length} file(s)` : op.kind, result: op.kind === "push" ? `Undid the push of ${op.paths.length} file${op.paths.length === 1 ? "" : "s"}` : "Undid it", operation: op.kind } };
  }],
  [/^\/api\/v1\/workspaces\/([^/]+)\/members$/, "GET", (req) => ({ data: { members: [{ id: "aaaaaaaa-1111-4111-8111-111111111111", username: "tester", fullName: "Test User", role: "owner" }, { id: "bbbbbbbb-2222-4222-8222-222222222222", username: "sam", fullName: "Sam Lee", role: "member" }].filter((m) => !req.query.get("q") || m.username.includes(String(req.query.get("q")))) } })],
  [/^\/api\/v1\/workspaces\/([^/]+)\/manifest$/, "GET", (req, state) => ({ data: { files: [...state.files.values()].map(meta), nextCursor: null, canWrite: state.canWrite, limits: { largestFileBytes: 10 * 1024 * 1024 } } })],
  [/^\/api\/v1\/workspaces\/([^/]+)\/docs$/, "GET", (_req, state) => ({ data: { docs: state.docs.map((d) => ({ slug: d.slug, filename: d.filename, linkedNodeId: (d.nodePath && state.files.get(d.nodePath)?.nodeId) ?? null })) } })],
  [/^\/api\/v1\/workspaces\/([^/]+)\/docs\/([^/]+)$/, "GET", (req, state) => {
    const doc = state.docs.find((d) => d.slug === req.params[1]);
    const file = doc?.nodePath ? state.files.get(doc.nodePath) : null;
    if (!doc || (!file && doc.starter == null)) return fail(404, "NOT_FOUND", "No such doc");
    // A starter doc has no file until its first edit (files/place with linkDoc).
    if (!file) return { data: { slug: doc.slug, canEdit: state.canWrite, content: doc.starter, filename: doc.filename, file: null } };
    return { data: { slug: doc.slug, canEdit: state.canWrite, content: file.content.toString("utf8"), filename: doc.filename, file: { nodeId: file.nodeId, path: file.path, version: file.version } } };
  }],
];

/**
 * @param {{ routes?: Record<string, Handler>, fault?: Record<string, Fault> }} [options]
 */
export async function startFakeServer({ routes = {}, fault = {} } = {}) {
  /** @type {FakeState} */
  const state = { workspace: { id: WORKSPACE_ID, title: "Design Lab", slug: "design-lab", role: "owner" }, files: new Map(), tasks: [], docs: [], reviewRequired: false, canWrite: true, revoked: new Set(), device: { answer: "approve", afterPolls: 3, polls: 0, lastBody: null, tokenType: "device" }, undos: new Map(), undone: [], questions: [], autoAnswer: /** @type {string | null} */ (null), sessionsEnded: 0, fileOps: [], fileComments: [], updates: [], assignments: [], inbox: [], events: [] };
  /** @type {FakeRequest[]} */
  const requests = [];
  const faults = new Map(Object.entries(fault));
  const table = { ...exact, ...routes };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
    /** @type {FakeRequest} */
    const fakeReq = { method: req.method ?? "GET", path: url.pathname, query: url.searchParams, headers: req.headers, body, params: [] };
    requests.push(fakeReq);

    const bodySchema = API_SCHEMAS[`${fakeReq.method} ${url.pathname}`];
    const problems = bodySchema ? validate(bodySchema, body) : [];
    if (problems.length) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: false, errorCode: "BAD_REQUEST", message: `The real server would refuse this body: ${problems.slice(0, 5).join("; ")}` }));
      return;
    }

    const f = faults.get(url.pathname);
    if (f === "drop") { req.socket.destroy(); return; }
    if (f === "429") { res.writeHead(429, { "content-type": "application/json", "retry-after": "1" }); res.end(JSON.stringify({ success: false, message: "Too many requests", errorCode: "RATE_LIMITED" })); return; }
    if (f === "503") { res.writeHead(503, { "content-type": "text/plain" }); res.end("Service Unavailable"); return; }
    if (f === "corrupt") { res.writeHead(200, { "content-type": "application/json" }); res.end("{not json"); return; }
    if (f === "slow") await new Promise((r) => setTimeout(r, 2000));

    let handler = table[`${fakeReq.method} ${url.pathname}`];
    if (!handler) {
      for (const [re, method, h] of patterns) {
        const m = re.exec(url.pathname);
        if (m && method === fakeReq.method) { fakeReq.params = m.slice(1).map(decodeURIComponent); handler = h; break; }
      }
    }
    if (!handler) { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ success: false, message: `No fake route for ${fakeReq.method} ${url.pathname}`, errorCode: "NOT_FOUND" })); return; }
    const out = await handler(fakeReq, state);
    const status = out.status ?? 200;
    if (out.raw) { res.writeHead(200, { "content-type": "application/octet-stream" }); res.end(out.raw); return; }
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
