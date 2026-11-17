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
/** @typedef {{ path: string, nodeId: string, version: number, content: Buffer, updatedAt: string, active?: number }} FakeFile */
/** @typedef {{ id: string, taskNumber: number, title: string, status: string, reviewStatus: string, updatedAt: string, description: string, priority: string, assigneeUsername: string | null, dueDate?: string | null, subtasks: any[], files: any[], comments: any[] }} FakeTask */
/** @typedef {{ workspace: { id: string, title: string, slug: string, role: string }, files: Map<string, FakeFile>, tasks: FakeTask[], docs: Array<{ slug: string, filename: string, nodePath: string | null, starter?: string }>, reviewRequired: boolean, canWrite: boolean, revoked: Set<string>, undos: Map<string, any>, undone: any[], questions: any[], autoAnswer: string | null, sessionsEnded: number, fileOps: any[], fileComments: any[], updates: string[], assignments: any[], inbox: any[], events: any[], agentAccess?: any, lastCreate?: any, detailReads?: string[], extraWorkspaces?: any[], home?: any, lastListQuery?: URLSearchParams, lastBulk?: any, lastTokenBody?: any, countWorkspaces?: any[], stars?: Set<string>, trash?: any[], agentNotes?: any[], presenceOthers?: string[], locks?: any[], memberOps?: any[], feed?: any[], prefs?: any, device: { answer: "approve" | "deny" | "never", afterPolls: number, polls: number, lastBody: any, tokenType: "device" | "agent" } }} FakeState */

export const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
export const TOKEN = "nb_pat_test0123456789abcdef";

const sha256 = (/** @type {Buffer} */ buf) => crypto.createHash("sha256").update(buf).digest("hex");
const now = () => new Date().toISOString();

/** @param {FakeState} state @param {string} path @param {Buffer} content */
export function putFile(state, path, content) {
  const prev = state.files.get(path);
  const file = { path, nodeId: prev?.nodeId ?? crypto.randomUUID(), version: (prev?.version ?? 0) + 1, content, updatedAt: now(), history: [...(/** @type {any} */ (prev)?.history ?? []), content] };
  state.files.set(path, file);
  return { file, prev };
}

/** @param {FakeState} state @param {Partial<FakeTask>} task */
export function addTask(state, task) {
  const t = { id: crypto.randomUUID(), taskNumber: state.tasks.length + 1, title: "Task", status: "todo", reviewStatus: "none", updatedAt: now(), description: "", priority: "medium", assigneeUsername: "tester", subtasks: [], files: [], comments: [], ...task };
  state.tasks.push(t);
  return t;
}

const defaultPrefs = () => ({ mentions: true, workflows: true, projects: true, tasks: true, applications: true, connections: true, pausedUntil: null, quietHours: { enabled: false, startMinute: 1320, endMinute: 480 }, mutedScopes: [] });

/** The meta route's answer for a fake task. @param {FakeState} state @param {any} t */
const metaOf = (state, t) => {
  const brief = (/** @type {any} */ x) => ({ id: x.id, number: x.taskNumber, title: x.title, status: x.status });
  return { taskId: t.id, labels: t.labels ?? [], blockedBy: (t.blockedBy ?? []).map((/** @type {string} */ id) => brief(findTask(state, id))), blocking: state.tasks.filter((x) => (/** @type {any} */ (x).blockedBy ?? []).includes(t.id)).map(brief), links: t.links ?? [], watching: Boolean(t.watching), starred: Boolean(t.starred) };
};

/** @param {FakeFile} f */
const meta = (f) => ({ nodeId: f.nodeId, path: f.path, version: f.version, contentHash: sha256(f.content), size: f.content.length, updatedAt: f.updatedAt, ...(/** @type {any} */ (f).executable ? { executable: true } : {}) });
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
  "GET /api/v1/reviews": (req, state) => (req.query.get("org") ? { data: { rows: state.assignments.filter((a) => a.state === "submitted").map((a) => ({ kind: "copy", mine: true, copyId: a.id, masterId: a.id, title: a.title, who: "Sam Lee", submittedBy: "u2", submittedAt: now(), late: false, href: "", projectId: WORKSPACE_ID, updatedAt: now(), version: 1, link: null, text: null, note: null, files: [], versions: a.versions ?? [] })), total: 1, nextCursor: null } } : fail(400, "BAD_REQUEST", "Which organization?")),
  // Messages (report C4, M4d): two #design channels in different workspaces and a DM.
  // nb learn (report C1): the practice workspace is the fake's design-lab, so every step works.
  "POST /api/v1/sandbox": (_req, state) => { state.sandboxes = (state.sandboxes ?? 0) + 1; return { data: { sandbox: { id: WORKSPACE_ID, slug: "design-lab", title: "Practice (nb learn)", created: !(/** @type {any} */ (state).sandboxExists) } } }; },
  "GET /api/v1/chat/conversations": (_req, state) => ({ data: { conversations: fakeChats(state).conversations } }),
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
  "POST /api/v1/device/token": (req, state) => {
    const d = state.device;
    state.lastTokenBody = req.body;
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
  "GET /api/v1/extension/workspaces": (_req, state) => ({ data: { workspaces: [state.workspace, ...(state.extraWorkspaces ?? [])] } }),
  "GET /api/v1/home": (req, state) => {
    const data = state.home ?? { tasks: { open: 0, byStatus: { todo: 0, in_progress: 0, blocked: 0, in_review: 0 }, overdue: 0, dueThisWeek: 0, workspaces: [] }, unread: 0, reviews: [], assignments: [] };
    const id = req.query.get("task");
    if (!id) return { data };
    const t = state.tasks.find((x) => x.id === id);
    return { data: { ...data, currentTask: t ? { id: t.id, number: t.taskNumber, title: t.title, status: t.status } : null } };
  },
  "GET /api/v1/extension/workspace-tasks": (req, state) => {
    state.lastListQuery = req.query;
    // Like the server: open work, every word of q in the title (or the number), and the due sort (C2).
    const words = String(req.query.get("q") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    let rows = state.tasks.filter((t) => (req.query.get("scope") !== "mine" || t.assigneeUsername === "tester")
      && (req.query.get("open") !== "1" || t.status !== "done" || t.reviewStatus === "pending")
      && (!words.length || words.every((w) => t.title.toLowerCase().includes(w)) || words.join(" ").replace(/^#/, "") === String(t.taskNumber)));
    if (req.query.get("sort") === "due") rows = [...rows].sort((a, b) => (a.dueDate ? Date.parse(a.dueDate) : Infinity) - (b.dueDate ? Date.parse(b.dueDate) : Infinity));
    return { data: { tasks: rows.map((t) => ({ ...t, subtaskSummary: { completed: t.subtasks.filter((s) => s.completed).length, total: t.subtasks.length } })), nextCursor: null } };
  },
  "GET /api/v1/extension/task-detail": (req, state) => {
    const t = findTask(state, req.query.get("taskId") ?? req.query.get("taskNumber") ?? "");
    if (!t) return fail(404, "NOT_FOUND", "Task not found");
    state.detailReads = [...(state.detailReads ?? []), req.query.get("brief") === "1" ? "brief" : "full"];
    // Like the server's brief=1 (C16 #9): the task row only.
    if (req.query.get("brief") === "1") return { data: { task: { id: t.id, taskNumber: t.taskNumber, title: t.title, status: t.status, reviewStatus: t.reviewStatus, updatedAt: t.updatedAt, assigneeId: t.assigneeUsername ? "aaaaaaaa-1111-4111-8111-111111111111" : null, projectId: WORKSPACE_ID } } };
    return { data: { task: t, subtasks: t.subtasks, files: t.files, comments: t.comments, pushes: [], meta: metaOf(state, t) } };
  },
  "GET /api/v1/tasks/count": (_req, state) => {
    const open = state.tasks.filter((t) => t.status !== "done" || t.reviewStatus === "pending");
    const by = (/** @type {string} */ s) => open.filter((t) => t.status === s).length;
    return { data: { open: open.length, byStatus: { todo: by("todo"), in_progress: by("in_progress"), blocked: by("blocked"), in_review: open.filter((t) => t.reviewStatus === "pending").length }, overdue: 0, dueThisWeek: 0, workspaces: state.countWorkspaces ?? [{ id: WORKSPACE_ID, title: "Design Lab", open: open.length, overdue: 0, dueThisWeek: 0 }] } };
  },
  "POST /api/v1/tasks/bulk": (req, state) => {
    // Like the server (C2): every task or none, one undo.
    const found = req.body.taskIds.map((/** @type {string} */ id) => findTask(state, id));
    if (found.some((/** @type {any} */ t) => !t)) return fail(404, "NOT_FOUND", "Some of those tasks aren’t in this workspace");
    const c = req.body.change;
    for (const t of /** @type {FakeTask[]} */ (found)) {
      if (c.kind === "status") t.status = c.status;
      else if (c.kind === "assign") t.assigneeUsername = c.assigneeId?.startsWith("aaaaaaaa") ? "tester" : c.assigneeId?.startsWith("bbbbbbbb") ? "sam" : null;
      else /** @type {any} */ (t)[c.field] = c.value;
      t.updatedAt = now();
    }
    state.lastBulk = req.body;
    return { data: { changed: found.length, tasks: found.map((/** @type {any} */ t) => ({ id: t.id, number: t.taskNumber })), summary: "bulk", undoToken: crypto.randomUUID() } };
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
    t.comments.push({ id: crypto.randomUUID(), authorUsername: "tester", content: req.body.text ?? req.body.content, replyTo: req.body.replyTo ?? null });
    return { data: { comment: { id: crypto.randomUUID() } } };
  },
  "GET /api/v1/extension/search": (req, state) => ({ data: { files: [...state.files.values()].filter((f) => f.path.includes(req.query.get("q") ?? "")).map((f) => ({ ...meta(f), currentVersion: f.version })), nextCursor: null } }),
  "GET /api/v1/extension/file": (req, state) => {
    const f = state.files.get(req.query.get("path") ?? "");
    const folder = (state.folders ?? new Map()).get(req.query.get("path") ?? "");
    if (!f && folder && req.query.get("transfer") === "metadata") return { data: folder };
    if (!f) return fail(404, "NOT_FOUND", "File not found");
    // A file an unfinished import hasn't fetched (2.1.6 live check): listed, but no content yet.
    if (/** @type {any} */ (state).notReady?.has(f.path) && req.query.get("transfer") !== "metadata") return fail(409, "CONTENT_NOT_READY", "This file's content isn't on the server yet");
    if (req.query.get("transfer") === "raw") return { raw: f.content };
    if (req.query.get("transfer") === "metadata") return { data: { ...meta(f), id: f.nodeId, currentVersion: f.version } };
    return { data: { ...meta(f), currentVersion: f.version, encoding: "base64", content: f.content.toString("base64") } };
  },
  "POST /api/v1/extension/file-operation": (req, state) => {
    state.fileOps.push(req.body);
    if (req.body.kind === "mkdir") {
      const folder = { id: crypto.randomUUID(), path: `/${req.body.name}`, name: req.body.name };
      (state.folders ??= new Map()).set(folder.path, { ...folder, nodeId: folder.id, type: "folder", updatedAt: new Date().toISOString() });
      return { data: { folder } };
    }
    if (req.body.kind === "restore") {
      const hit = (state.trash ?? []).find((t) => t.nodeId === req.body.nodeId);
      if (!hit) return fail(404, "NOT_FOUND", "File not found");
      state.trash = (state.trash ?? []).filter((t) => t !== hit);
      return { data: { restored: true, nodeId: hit.nodeId } };
    }
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
    // One version's content (C3 version diff), like the server's ?version=N.
    if (req.query.get("version")) {
      const v = Number(req.query.get("version"));
      const content = /** @type {any} */ (f).history?.[v - 1];
      return content === undefined ? fail(404, "NOT_FOUND", "Version not found") : { data: { content: content.toString("utf8"), encoding: "utf8" } };
    }
    return { data: { activeVersion: f.active ?? f.version, versions: Array.from({ length: f.version }, (_, i) => ({ version: f.version - i, basedOnVersion: f.version - i > 1 ? f.version - i - 1 : null, uploadedAt: f.updatedAt, uploadedByUsername: "tester", via: i === 0 ? "agent" : null, agentName: i === 0 ? "Claude Code" : null, comment: null })) } };
  },
  "POST /api/v1/extension/file-history": (req, state) => {
    // Like the server's "Use this version" (C3): the active pointer moves, nothing is copied.
    const f = [...state.files.values()].find((x) => x.nodeId === req.body.nodeId);
    if (!f) return fail(404, "NOT_FOUND", "File not found");
    if (req.body.version > f.version) return fail(404, "NOT_FOUND", "That file has no such version");
    const previousVersion = f.active ?? f.version;
    f.active = req.body.version;
    return { data: { nodeId: f.nodeId, path: f.path, activeVersion: req.body.version, previousVersion, undoToken: crypto.randomUUID() } };
  },
  "GET /api/v1/extension/comments": (_req, state) => ({ data: { events: state.fileComments } }),
  "PATCH /api/v1/extension/comments": (req, state) => {
    for (const t of state.tasks) for (const c of t.comments) if (c.id === req.body.commentId) { if (c.authorUsername !== "tester") return fail(403, "FORBIDDEN", "You can only edit your own comments"); c.content = req.body.text; return { data: { commentId: c.id } }; }
    return fail(404, "NOT_FOUND", "Comment not found");
  },
  "DELETE /api/v1/extension/comments": (req, state) => {
    for (const t of state.tasks) { const i = t.comments.findIndex((c) => c.id === req.body.commentId); if (i >= 0) { t.comments.splice(i, 1); return { data: { mode: "hard_delete" } }; } }
    return fail(404, "NOT_FOUND", "Comment not found");
  },
  "GET /api/v1/me/notifications": (_req, state) => ({ data: { preferences: state.prefs ?? defaultPrefs() } }),
  "PATCH /api/v1/me/notifications": (req, state) => { state.prefs = { ...(state.prefs ?? defaultPrefs()), ...req.body }; return { data: { preferences: state.prefs } }; },
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
/** Change sets (report G7), kept simple: items by path, content by hash, apply writes the files. */
const sets = (/** @type {any} */ state) => (state.changeSets ??= new Map());
const knownContent = (/** @type {any} */ state) => (state.changeContent ??= new Map());
const setOut = (/** @type {any} */ cs) => {
  const items = [...cs.items.values()];
  const n = (/** @type {string} */ op) => items.filter((i) => i.op === op).length;
  return { id: cs.id, title: cs.title, status: cs.status, message: cs.message ?? null, filesAdded: n("add"), filesChanged: n("change"), filesDeleted: n("delete"), filesRenamed: n("rename"), linesAdded: 0, linesRemoved: 0, updatedAt: cs.updatedAt };
};
/** Branches (report H6): each its own files, main is state.files. @param {any} state @param {string | null} ref */
const branchOf = (state, ref) => (ref ? (state.branches ??= []).find((/** @type {any} */ b) => b.id === ref || b.name.toLowerCase() === String(ref).toLowerCase()) ?? null : null);
const branchOut = (/** @type {any} */ b) => ({ id: b.id, name: b.name, isDefault: false, status: b.status ?? "active", ahead: b.ahead ?? 0, behind: 0, changedFiles: 0, stale: false, lastSave: null, createdBy: null, task: null, createdAt: now(), updatedAt: now(), deletedAt: null });
export const MAIN_BRANCH_ID = "00000000-0000-4000-8000-00000000000a";
const branchRoutes = [
  [/^\/api\/v1\/workspaces\/([^/]+)\/branches$/, "GET", (/** @type {any} */ _req, /** @type {any} */ state) => {
    // Like most workspaces: no branches unless a test turns them on.
    if (!state.branchesOn || state.branchesOff) return fail(403, "BRANCHES_OFF", "History isn't turned on for this workspace");
    return { data: { branches: [{ ...branchOut({ id: MAIN_BRANCH_ID, name: "main" }), isDefault: true }, ...(state.branches ?? []).filter((/** @type {any} */ b) => b.status !== "deleted").map(branchOut)] } };
  }],
  [/^\/api\/v1\/workspaces\/([^/]+)\/branches$/, "POST", (/** @type {any} */ req, /** @type {any} */ state) => {
    if (branchOf(state, req.body.name)) return fail(409, "BRANCH_EXISTS", `A branch named ${req.body.name} already exists`);
    const from = branchOf(state, req.body.from ?? null);
    const b = { id: crypto.randomUUID(), name: req.body.name, files: new Map([...(from ? from.files : state.files)].map(([p, f]) => [p, { ...f }])), status: "active" };
    (state.branches ??= []).push(b);
    return { status: 201, data: { branch: branchOut(b) } };
  }],
  [/^\/api\/v1\/branches\/([^/]+)$/, "PATCH", (/** @type {any} */ req, /** @type {any} */ state) => { const b = branchOf(state, req.params[0]); b.name = req.body.name; return { data: { branch: branchOut(b) } }; }],
  [/^\/api\/v1\/branches\/([^/]+)$/, "DELETE", (/** @type {any} */ req, /** @type {any} */ state) => { const b = branchOf(state, req.params[0]); b.status = "deleted"; return { data: { deleted: true, savesNotInMain: 0, restoreUntil: now() } }; }],
  [/^\/api\/v1\/branches\/([^/]+)\/raw$/, "GET", (/** @type {any} */ req, /** @type {any} */ state) => {
    const f = branchOf(state, req.params[0])?.files.get(req.query.get("path") ?? "");
    return f ? { raw: f.content } : fail(404, "NOT_FOUND", "Not on this branch");
  }],
  [/^\/api\/v1\/branches\/([^/]+)\/update$/, "POST", (/** @type {any} */ req, /** @type {any} */ state) => {
    state.updates = [...(state.updates ?? []), { branch: req.params[0], resolutions: req.body.resolutions }];
    return { data: state.updateAnswer ?? { upToDate: false, save: { id: crypto.randomUUID(), number: 2 }, conflicts: [] } };
  }],
];
const changeSetRoutes = [
  ...branchRoutes,
  [/^\/api\/v1\/workspaces\/([^/]+)\/change-sets$/, "POST", (/** @type {any} */ req, /** @type {any} */ state) => {
    if (state.changeSetsOff) return fail(403, "CHANGE_SETS_OFF", "Change sets aren't turned on for this workspace yet");
    const cs = { id: crypto.randomUUID(), title: req.body.title, status: "open", items: new Map(), updatedAt: now(), branchId: req.body.branchId ?? null };
    sets(state).set(cs.id, cs);
    return { status: 201, data: { changeSet: setOut(cs) } };
  }],
  [/^\/api\/v1\/workspaces\/([^/]+)\/change-sets$/, "GET", (/** @type {any} */ req, /** @type {any} */ state) => {
    const want = req.query.get("status")?.split(",");
    return { data: { changeSets: [...sets(state).values()].filter((cs) => !want || want.includes(cs.status)).map(setOut), nextCursor: null } };
  }],
  [/^\/api\/v1\/change-sets\/([^/]+)$/, "GET", (/** @type {any} */ req, /** @type {any} */ state) => {
    const cs = sets(state).get(req.params[0]);
    return cs ? { data: { changeSet: setOut(cs), items: [...cs.items.values()], nextCursor: null } } : fail(404, "NOT_FOUND", "Change set not found");
  }],
  [/^\/api\/v1\/change-sets\/([^/]+)\/items$/, "PUT", (/** @type {any} */ req, /** @type {any} */ state) => {
    const cs = sets(state).get(req.params[0]);
    if (!cs || !["open", "ready"].includes(cs.status)) return fail(409, "CHANGE_SET_CLOSED", "This change set is closed");
    const missing = new Set();
    for (const i of req.body.items) {
      if (i.fromPath) cs.items.delete(i.fromPath);
      const have = !i.contentHash || knownContent(state).has(i.contentHash) || [...state.files.values()].some((f) => sha256(f.content) === i.contentHash);
      if (!have) missing.add(i.contentHash);
      cs.items.set(i.path, { ...i, state: have ? "ready" : "pending" });
    }
    cs.status = "open";
    state.itemCalls = (state.itemCalls ?? 0) + 1;
    return { data: { items: req.body.items, missingContent: [...missing] } };
  }],
  [/^\/api\/v1\/change-sets\/([^/]+)\/items$/, "DELETE", (/** @type {any} */ req, /** @type {any} */ state) => { sets(state).get(req.params[0])?.items.delete(req.query.get("path")); return { data: { ok: true } }; }],
  [/^\/api\/v1\/change-sets\/([^/]+)\/content$/, "POST", (/** @type {any} */ req, /** @type {any} */ state) => {
    const cs = sets(state).get(req.params[0]);
    const held = [];
    for (const f of req.body.files ?? []) {
      const bytes = Buffer.from(f.base64, "base64");
      if (sha256(bytes) !== f.hash) return fail(400, "CONTENT_HASH_MISMATCH", "The bytes don't match");
      // Like the server's secret scan: a key is held unless the person confirms.
      if (/AKIA[0-9A-Z]{16}/.test(bytes.toString()) && !req.body.confirmSecrets) { held.push({ hash: f.hash, findings: [{ rule: "AWS access key" }] }); continue; }
      knownContent(state).set(f.hash, bytes);
      for (const i of cs.items.values()) if (i.contentHash === f.hash) i.state = "ready";
    }
    return { data: { stored: (req.body.files ?? []).map((/** @type {any} */ f) => f.hash).filter((/** @type {string} */ h) => !held.some((x) => x.hash === h)), held } };
  }],
  [/^\/api\/v1\/change-sets\/([^/]+)\/finish$/, "POST", (/** @type {any} */ req, /** @type {any} */ state) => {
    const cs = sets(state).get(req.params[0]);
    const pending = [...cs.items.values()].filter((i) => i.state === "pending");
    if (pending.length) return fail(409, "CONTENT_MISSING", "Still uploading", { missing: pending.map((i) => ({ path: i.path })) });
    cs.status = "ready";
    const big = cs.items.size > 20 || [...cs.items.values()].some((i) => i.op === "delete");
    return { data: { changeSet: setOut(cs), summary: `${cs.title}: ${cs.items.size} files`, decision: big ? "needs_confirmation" : "apply_now" } };
  }],
  [/^\/api\/v1\/change-sets\/([^/]+)\/apply$/, "POST", (/** @type {any} */ req, /** @type {any} */ state) => {
    const cs = sets(state).get(req.params[0]);
    if (cs.status !== "ready") return fail(409, "CHANGE_SET_NOT_READY", "Finish the change set first");
    const applied = [];
    const undo = [];
    // A change set on a branch saves on that branch only (H14).
    const target = cs.branchId ? branchOf(state, cs.branchId) : state;
    for (const i of cs.items.values()) {
      if (i.op === "delete") { const f = target.files.get(i.path); target.files.delete(i.path); applied.push({ path: i.path, nodeId: f?.nodeId, version: null, op: i.op }); continue; }
      if (i.op === "rename") { const f = target.files.get(i.fromPath); target.files.delete(i.fromPath); if (f) target.files.set(i.path, { ...f, path: i.path }); undo.push({ path: i.path, fromPath: i.fromPath }); }
      const bytes = knownContent(state).get(i.contentHash) ?? [...target.files.values(), ...state.files.values()].find((f) => sha256(f.content) === i.contentHash)?.content;
      const { file } = putFile(target, i.path, /** @type {Buffer} */ (bytes));
      applied.push({ path: i.path, nodeId: file.nodeId, version: file.version, op: i.op });
    }
    cs.status = "applied";
    return { data: { changeSet: setOut(cs), applied, undo, undoToken: null } };
  }],
  [/^\/api\/v1\/change-sets\/([^/]+)\/discard$/, "POST", (/** @type {any} */ req, /** @type {any} */ state) => { sets(state).get(req.params[0]).status = "discarded"; return { data: { ok: true } }; }],
  // Files for cloud agents (G14): the draft is the workspace's files with the set's writes laid over.
  [/^\/api\/v1\/workspaces\/([^/]+)\/fs\/(list|read|search)$/, "GET", (/** @type {any} */ req, /** @type {any} */ state) => {
    const cs = req.query.get("changeSet") ? sets(state).get(req.query.get("changeSet")) : null;
    /** @type {Map<string, string>} */
    const view = new Map([...state.files.values()].map((f) => [f.path, f.content.toString()]));
    for (const i of cs?.items.values() ?? []) i.op === "delete" ? view.delete(i.path) : view.set(i.path, knownContent(state).get(i.contentHash)?.toString() ?? "");
    if (req.params[1] === "list") return { data: { files: [...view.keys()].sort().map((p) => ({ path: p })), total: view.size, truncated: false } };
    if (req.params[1] === "read") return { data: { files: req.query.getAll("path").map((/** @type {string} */ p) => (view.has(p) ? { path: p, text: view.get(p) } : { path: p, error: "NOT_FOUND" })) } };
    const q = String(req.query.get("query"));
    return { data: { matches: [...view].flatMap(([p, t]) => t.split("\n").flatMap((line, n) => (line.includes(q) ? [{ path: p, line: n + 1, text: line }] : []))), truncated: false, notIndexed: 0 } };
  }],
  [/^\/api\/v1\/change-sets\/([^/]+)\/fs\/(write|edit|delete|move)$/, "POST", (/** @type {any} */ req, /** @type {any} */ state) => {
    const cs = sets(state).get(req.params[0]);
    if (!cs) return fail(404, "NOT_FOUND", "Change set not found");
    if (!["open", "ready"].includes(cs.status)) return fail(409, "CHANGE_SET_CLOSED", `This change set is ${cs.status}; start a new one`);
    if (req.params[1] === "delete") { cs.items.set(req.body.path, { op: "delete", path: req.body.path, state: "ready" }); return { data: { path: req.body.path, deleted: true } }; }
    const current = () => { const i = cs.items.get(req.body.path); return i ? knownContent(state).get(i.contentHash)?.toString() ?? "" : state.files.get(req.body.path)?.content.toString() ?? ""; };
    const text = req.params[1] === "edit" ? req.body.edits.reduce((/** @type {string} */ t, /** @type {any} */ e) => t.replace(e.oldText, e.newText), current()) : String(req.body.text ?? "");
    const bytes = Buffer.from(text);
    knownContent(state).set(sha256(bytes), bytes);
    cs.items.set(req.body.path, { op: state.files.has(req.body.path) ? "change" : "add", path: req.body.path, contentHash: sha256(bytes), state: "ready" });
    return { data: { path: req.body.path, hash: sha256(bytes), size: bytes.byteLength, held: false } };
  }],
];
const patterns = [
  ...changeSetRoutes,
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
  [/^\/api\/v1\/undo\/([^/]+)$/, "GET", (/** @type {FakeRequest} */ req, /** @type {FakeState} */ state) => {
    const u = state.undos.get(req.params[0]);
    return u ? { data: { id: req.params[0], summary: u.kind === "push" ? `Pushed ${u.paths.join(", ")}` : "A change", operation: u.kind } } : fail(410, "EXPIRED", "Nothing to undo");
  }],
  [/^\/api\/v1\/undo\/([^/]+)$/, "POST", (/** @type {FakeRequest} */ req, /** @type {FakeState} */ state) => {
    const op = state.undos.get(req.params[0] ?? "");
    if (!op) return fail(410, "EXPIRED", "Nothing to undo: it was undone already, is older than 24 hours, or isn't yours");
    state.undos.delete(req.params[0] ?? "");
    state.undone.push(op);
    return { data: { undone: op.kind === "push" ? `Pushed ${op.paths.length} file(s)` : op.kind, result: op.kind === "push" ? `Undid the push of ${op.paths.length} file${op.paths.length === 1 ? "" : "s"}` : "Undid it", operation: op.kind } };
  }],
  // Labels, blocked by, links, watch and star (0087), like the server's meta route.
  [/^\/api\/v1\/tasks\/([^/]+)\/meta$/, "GET", (req, state) => {
    const t = findTask(state, req.params[0]);
    return t ? { data: metaOf(state, t) } : fail(404, "NOT_FOUND", "Task not found");
  }],
  [/^\/api\/v1\/tasks\/([^/]+)\/meta$/, "PATCH", (req, state) => {
    const t = /** @type {any} */ (findTask(state, req.params[0]));
    if (!t) return fail(404, "NOT_FOUND", "Task not found");
    const b = req.body;
    t.labels = [...new Set([...(t.labels ?? []), ...(b.labels?.add ?? []).map((/** @type {string} */ l) => l.toLowerCase())])].filter((l) => !(b.labels?.remove ?? []).includes(l));
    t.blockedBy = [...new Set([...(t.blockedBy ?? []), ...(b.blockedBy?.add ?? [])])].filter((id) => !(b.blockedBy?.remove ?? []).includes(id));
    t.links = [...(t.links ?? []), ...(b.links?.add ?? []).map((/** @type {any} */ l) => ({ url: l.url, title: /pull\/(\d+)/.test(l.url) ? `acme/app#${/pull\/(\d+)/.exec(l.url)?.[1]}` : null, kind: /pull\//.test(l.url) ? "pull_request" : "link" }))];
    if (b.watch !== undefined) t.watching = b.watch;
    if (b.star !== undefined) t.starred = b.star;
    return { data: metaOf(state, t) };
  }],
  [/^\/api\/v1\/tasks\/([^/]+)\/reminders$/, "POST", (req, state) => {
    const t = /** @type {any} */ (findTask(state, req.params[0]));
    if (!t) return fail(404, "NOT_FOUND", "Task not found");
    if (Date.parse(req.body.at) < Date.now()) return fail(409, "CONFLICT", "That time has passed: pick one in the future");
    const r = { id: crypto.randomUUID(), remindAt: req.body.at, note: req.body.note ?? null };
    t.reminders = [...(t.reminders ?? []), r];
    return { data: { reminder: r } };
  }],
  [/^\/api\/v1\/tasks\/([^/]+)\/reminders$/, "GET", (req, state) => ({ data: { reminders: /** @type {any} */ (findTask(state, req.params[0]))?.reminders ?? [] } })],
  [/^\/api\/v1\/tasks\/([^/]+)\/reminders$/, "DELETE", (req, state) => {
    const t = /** @type {any} */ (findTask(state, req.params[0]));
    const n = t?.reminders?.length ?? 0;
    if (t) t.reminders = [];
    return { data: { cancelled: n } };
  }],
  // Report C4 (M4b): members, updates.
  [/^\/api\/v1\/workspaces\/([^/]+)\/members$/, "POST", (req, state) => (req.body.role === "Designer" ? { data: { invited: `@${req.body.username}`, role: "Designer", invitationId: crypto.randomUUID() } } : fail(404, "NOT_FOUND", `No open role "${req.body.role}". Open roles: Designer`))],
  [/^\/api\/v1\/workspaces\/([^/]+)\/members$/, "PATCH", (req, state) => { state.memberOps = [...(state.memberOps ?? []), { op: "role", ...req.body }]; return { data: { username: req.body.username, role: req.body.role } }; }],
  [/^\/api\/v1\/workspaces\/([^/]+)\/members$/, "DELETE", (req, state) => { state.memberOps = [...(state.memberOps ?? []), { op: req.body.leave ? "leave" : "remove", ...req.body }]; return { data: req.body.leave ? { left: true } : { removed: req.body.username } }; }],
  [/^\/api\/v1\/workspaces\/([^/]+)\/updates$/, "GET", (_req, state) => ({ data: { updates: (state.feed ?? []), nextCursor: null, hasMore: false } })],
  [/^\/api\/v1\/workspaces\/([^/]+)\/updates\/([^/]+)$/, "GET", (req, state) => ({ data: { comments: (state.feed ?? []).find((u) => u.id === req.params[1])?.commentList ?? [], nextCursor: null, hasMore: false } })],
  [/^\/api\/v1\/workspaces\/([^/]+)\/updates\/([^/]+)$/, "POST", (req, state) => {
    const u = (state.feed ?? []).find((x) => x.id === req.params[1]);
    if (!u) return fail(404, "NOT_FOUND", "Update not found");
    if (req.body.kind === "like") { u.likedByViewer = !u.likedByViewer; u.likeCount += u.likedByViewer ? 1 : -1; return { data: { liked: u.likedByViewer } }; }
    u.commentList = [...(u.commentList ?? []), { authorUsername: "tester", content: req.body.text }];
    return { data: { comment: { id: crypto.randomUUID() } } };
  }],
  [/^\/api\/v1\/workspaces\/([^/]+)\/search$/, "GET", (req, state) => {
    const q = String(req.query.get("q") ?? "").toLowerCase();
    const want = String(req.query.get("in") ?? "tasks,comments,docs,people").split(",");
    const tasks = want.includes("tasks") ? state.tasks.filter((t) => t.title.toLowerCase().includes(q)).map((t) => ({ id: t.id, number: t.taskNumber, title: t.title, status: t.status })) : [];
    const comments = want.includes("comments") ? state.tasks.flatMap((t) => t.comments.filter((c) => String(c.content).toLowerCase().includes(q)).map((c) => ({ id: c.id, taskId: t.id, number: t.taskNumber, taskTitle: t.title, text: c.content, by: c.authorUsername }))) : [];
    return { data: { tasks, comments, docs: [], people: want.includes("people") && "sam lee".includes(q) ? [{ id: "bbbbbbbb-2222-4222-8222-222222222222", username: "sam", name: "Sam Lee", role: "member" }] : [] } };
  }],
  [/^\/api\/v1\/workspaces\/([^/]+)\/files\/trash$/, "GET", (_req, state) => ({ data: { items: state.trash ?? [], nextCursor: null } })],
  [/^\/api\/v1\/files\/([^/]+)\/lock$/, "POST", (req, state) => {
    state.locks = [...(state.locks ?? []), { nodeId: req.params[0], op: "lock", sessionId: req.body.sessionId }];
    return { data: { leaseId: crypto.randomUUID(), sessionId: req.body.sessionId, fencingToken: 1, acquiredAt: Date.now(), renewedAt: Date.now(), expiresAt: Date.now() + 120_000 } };
  }],
  [/^\/api\/v1\/files\/([^/]+)\/lock$/, "DELETE", (req, state) => {
    state.locks = [...(state.locks ?? []), { nodeId: req.params[0], op: "release", sessionId: req.body.sessionId }];
    return { data: { released: true } };
  }],
  [/^\/api\/v1\/workspaces\/([^/]+)\/files\/([^/]+)\/star$/, "PUT", (req, state) => {
    state.stars = new Set(state.stars ?? []);
    if (req.body.starred) state.stars.add(req.params[1]); else state.stars.delete(req.params[1]);
    return { data: { nodeId: req.params[1], starred: req.body.starred } };
  }],
  [/^\/api\/v1\/workspaces\/([^/]+)\/files\/mine$/, "GET", (req, state) => {
    const all = [...state.files.values()];
    const files = req.query.get("kind") === "starred" ? all.filter((f) => state.stars?.has(f.nodeId)) : all.slice(-2).reverse();
    return { data: { kind: req.query.get("kind"), files: files.map((f) => ({ nodeId: f.nodeId, path: f.path, name: f.path.split("/").pop(), size: f.content.length, currentVersion: f.version, at: f.updatedAt })) } };
  }],
  // Who's working on a task (D5).
  [/^\/api\/v1\/sandbox\/([^/]+)$/, "DELETE", (/** @type {FakeRequest} */ req, /** @type {FakeState} */ state) => { (state.sandboxesEnded ??= []).push(req.params[0]); return { data: { deleted: req.params[0] } }; }],
  [/^\/api\/v1\/chat\/conversations\/([^/]+)\/messages$/, "GET", (/** @type {FakeRequest} */ _req, /** @type {FakeState} */ state) => ({ data: { messages: fakeChats(state).messages[_req.params[0]] ?? [] } })],
  [/^\/api\/v1\/chat\/conversations\/([^/]+)\/messages$/, "POST", (/** @type {FakeRequest} */ req, /** @type {FakeState} */ state) => {
    const list = (fakeChats(state).messages[req.params[0]] ??= []);
    const seq = (list.at(-1)?.seq ?? 0) + 1;
    list.push({ seq, at: new Date().toISOString(), author: "@me", text: req.body.text, replies: 0, edited: false, files: [] });
    return { data: { seq } };
  }],
  [/^\/api\/v1\/chat\/conversations\/([^/]+)\/read$/, "POST", (/** @type {FakeRequest} */ req, /** @type {FakeState} */ state) => {
    const conv = fakeChats(state).conversations.find((/** @type {any} */ c) => c.id === req.params[0]);
    if (conv) conv.unread = 0;
    (state.chatReads ??= []).push({ id: req.params[0], seq: req.body.seq });
    return { data: { moved: true } };
  }],
  [/^\/api\/v1\/tasks\/([^/]+)\/presence$/, "POST", (/** @type {FakeRequest} */ _req, /** @type {FakeState} */ state) => ({ data: { others: state.presenceOthers ?? [] } })],
  // Agent notes (D16, 0089).
  [/^\/api\/v1\/tasks\/([^/]+)\/agent-notes$/, "GET", (/** @type {FakeRequest} */ req, /** @type {FakeState} */ state) => ({ data: { notes: (state.agentNotes ??= []).filter((n) => n.taskId === req.params[0]).slice().reverse() } })],
  [/^\/api\/v1\/tasks\/([^/]+)\/agent-notes$/, "POST", (/** @type {FakeRequest} */ req, /** @type {FakeState} */ state) => {
    const note = { id: crypto.randomUUID(), taskId: req.params[0], note: req.body.note, agentName: req.body.agentName ?? null, sessionId: req.body.sessionId ?? null, createdAt: now() };
    (state.agentNotes ??= []).push(note);
    return { data: { note } };
  }],
  [/^\/api\/v1\/tasks\/([^/]+)\/agent-notes$/, "DELETE", (/** @type {FakeRequest} */ req, /** @type {FakeState} */ state) => {
    state.agentNotes = (state.agentNotes ?? []).filter((n) => n.id !== req.body.id);
    return { data: { deleted: req.body.id } };
  }],
  [/^\/api\/v1\/workspaces\/([^/]+)\/members$/, "GET", (req) => ({ data: { members: [{ id: "aaaaaaaa-1111-4111-8111-111111111111", username: "tester", fullName: "Test User", role: "owner" }, { id: "bbbbbbbb-2222-4222-8222-222222222222", username: "sam", fullName: "Sam Lee", role: "member" }].filter((m) => !req.query.get("q") || `${m.username} ${m.fullName}`.toLowerCase().includes(String(req.query.get("q")).toLowerCase())) } })],
  [/^\/api\/v1\/workspaces\/([^/]+)\/manifest$/, "GET", (req, state) => ({ data: { files: [...(branchOf(state, req.query.get("branch"))?.files ?? state.files).values()].map(meta), nextCursor: null, canWrite: state.canWrite, limits: { largestFileBytes: 10 * 1024 * 1024 } } })],
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
/** @param {any} state */
function fakeChats(state) {
  return (state.chats ??= {
    conversations: [
      { id: "c1", kind: "channel", label: "#design", workspace: "design-lab", workspaceId: WORKSPACE_ID, unread: 2, mentions: 1, lastAt: new Date().toISOString(), lastPreview: "logo v2 is up", canReply: true },
      { id: "c2", kind: "dm", label: "@sam", workspace: null, workspaceId: null, unread: 0, mentions: 0, lastAt: new Date(Date.now() - 3_600_000).toISOString(), lastPreview: "thanks!", canReply: true },
      { id: "c3", kind: "channel", label: "#design", workspace: "ponytail", workspaceId: "w-ponytail", unread: 0, mentions: 0, lastAt: null, lastPreview: null, canReply: true },
    ],
    messages: { c1: [{ seq: 4, at: new Date(Date.now() - 600_000).toISOString(), author: "@sam", text: "@me logo v2 is up", replies: 1, edited: false, files: ["logo.png"] }, { seq: 5, at: new Date().toISOString(), author: "@ann", text: "looks good", replies: 0, edited: true, files: [] }] },
  });
}

export async function startFakeServer({ routes = {}, fault = {} } = {}) {
  /** @type {FakeState} */
  const state = { workspace: { id: WORKSPACE_ID, title: "Design Lab", slug: "design-lab", role: "owner" }, files: new Map(), tasks: [], docs: [], reviewRequired: false, canWrite: true, revoked: new Set(), device: { answer: "approve", afterPolls: 3, polls: 0, lastBody: null, tokenType: "device" }, undos: new Map(), undone: [], questions: [], autoAnswer: /** @type {string | null} */ (null), sessionsEnded: 0, fileOps: [], fileComments: [], updates: [], assignments: [], inbox: [], events: [] };
  /** @type {FakeRequest[]} */
  const requests = [];
  const faults = new Map(Object.entries(fault));
  const faultSeen = new Set();
  /** @type {Map<string, any>} */
  const idempotent = new Map();
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
    if (f === "401") { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ success: false, message: "Your sign-in expired", errorCode: "UNAUTHORIZED" })); return; }
    if (f === "503") { res.writeHead(503, { "content-type": "text/plain" }); res.end("Service Unavailable"); return; }
    if (f === "corrupt") { res.writeHead(200, { "content-type": "application/json" }); res.end("{not json"); return; }
    if (f === "slow") await new Promise((r) => setTimeout(r, 2000));
    // The second write to this path fails once with a conflict, so a tool stops halfway (D10 recovery test).
    if (f === "409-second" && fakeReq.method !== "GET") {
      if (faultSeen.has(url.pathname)) {
        faults.delete(url.pathname);
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: false, message: "Changed elsewhere", errorCode: "CONFLICT" }));
        return;
      }
      faultSeen.add(url.pathname);
    }

    let handler = table[`${fakeReq.method} ${url.pathname}`];
    if (!handler) {
      for (const [re, method, h] of patterns) {
        const m = re.exec(url.pathname);
        if (m && method === fakeReq.method) { fakeReq.params = m.slice(1).map(decodeURIComponent); handler = h; break; }
      }
    }
    if (!handler) { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ success: false, message: `No fake route for ${fakeReq.method} ${url.pathname}`, errorCode: "NOT_FOUND" })); return; }
    // Like the server's idempotentWrite: the same write sent again with its key gets the first answer, done once.
    const idemKey = fakeReq.method !== "GET" ? String(req.headers["idempotency-key"] ?? "") : "";
    const seen = idemKey ? idempotent.get(`${fakeReq.method} ${url.pathname} ${idemKey}`) : undefined;
    const out = seen ?? (await handler(fakeReq, state));
    if (idemKey && !seen && (out.status ?? 200) < 300) idempotent.set(`${fakeReq.method} ${url.pathname} ${idemKey}`, out);
    // The server did it, but the answer was lost on the way back (C6 network-drop test).
    if (f === "drop-after") { faults.delete(url.pathname); req.socket.destroy(); return; }
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
