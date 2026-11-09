/**
 * What an AI agent may change without asking (report §26.6, A2.8, A2.9). Decided here on the server, so an agent
 * can't skip it: reads always pass; small, undoable changes run and get an undo token; "needs a yes" changes
 * return 428 NEEDS_CONFIRMATION with a summary and a single-use token bound to the exact request, and run only when
 * the agent repeats the request with `X-NB-Confirm: <token>` after the person agreed.
 */
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";

import { jsonError } from "@/app/api/v1/_envelope";
import { db } from "@/lib/db";
import { agentConfirmationsUsed, tasks, undoOperations, workspaces } from "@/lib/db/schema";
import { requestVia } from "@/lib/server/request-via";

export type AgentPolicy = "ask_important" | "ask_all" | "trust_drafts_docs";

/** The kinds of change that need a person's yes under the default policy (report §26.6). */
export type ChangeKind =
  | "small"
  | "final" // final files
  | "done" // finishing a task
  | "review" // approving or returning someone's work
  | "doc" // the README or another doc
  | "file-move" // rename, move, delete files
  | "delete" // deleting tasks
  | "batch" // more than 20 items at once
  | "others-task" // a task assigned to someone else
  | "overwrite"; // replacing a newer version after a conflict

export const BATCH_LIMIT = 20;
export const CONFIRM_HEADER = "x-nb-confirm";
const CONFIRM_TTL_MS = 10 * 60_000;
export const UNDO_TTL_MS = 24 * 60 * 60_000;

export function needsYes(kinds: ChangeKind[], policy: AgentPolicy): boolean {
  const real = kinds.filter((k) => k !== "small");
  if (policy === "ask_all") return true;
  return real.some((k) => !(policy === "trust_drafts_docs" && k === "doc"));
}

type Principal = { user: { id: string } | null; tokenKind?: "device" | "agent" | "pat" | null; extensionSessionId?: string | null; tokenScopes?: Set<string> | null };

function secret() {
  const raw = process.env.EXTENSION_AUTH_CODE_SECRET || process.env.SUPABASE_JWT_SECRET || (process.env.NODE_ENV === "production" ? "" : "nb-extension-auth-code-local-development-secret");
  if (!raw) throw new Error("EXTENSION_AUTH_CODE_SECRET is required for agent confirmations.");
  return crypto.createHash("sha256").update(`nb-agent-confirm:${raw}`).digest();
}
const bodyHash = (body: unknown) => crypto.createHash("sha256").update(JSON.stringify(body ?? null)).digest("base64url");
const sign = (payload: string) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

export function issueConfirmToken(input: { userId: string; sessionId: string; body: unknown }, now = Date.now()) {
  const expiresAt = now + CONFIRM_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ u: input.userId, s: input.sessionId, h: bodyHash(input.body), e: expiresAt, n: crypto.randomBytes(8).toString("base64url") })).toString("base64url");
  return { token: `${payload}.${sign(payload)}`, expiresAt: new Date(expiresAt) };
}

/** True when the token is valid for exactly this request, and marks it used. */
export async function spendConfirmToken(token: string, input: { userId: string; sessionId: string; body: unknown }, now = Date.now()) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = sign(payload);
  if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return false;
  let claims: { u?: string; s?: string; h?: string; e?: number };
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  if (claims.u !== input.userId || claims.s !== input.sessionId || claims.h !== bodyHash(input.body) || !claims.e || claims.e < now) return false;
  const used = await db.insert(agentConfirmationsUsed).values({ tokenHash: crypto.createHash("sha256").update(token).digest("hex") }).onConflictDoNothing().returning({ tokenHash: agentConfirmationsUsed.tokenHash });
  return used.length === 1;
}

export async function workspaceAgentPolicy(workspaceId: string): Promise<{ policy: AgentPolicy; paused: boolean }> {
  const [row] = await db.select({ policy: workspaces.agentPolicy, pausedAt: workspaces.agentsPausedAt }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  return { policy: row?.policy ?? "ask_important", paused: Boolean(row?.pausedAt) };
}

/** A task assigned to someone else (unassigned tasks count as anyone's). */
export async function isOthersTask(taskId: string | null | undefined, userId: string) {
  if (!taskId || !/^[0-9a-f-]{36}$/i.test(taskId)) return false;
  const [row] = await db.select({ assigneeId: tasks.assigneeId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return Boolean(row?.assigneeId && row.assigneeId !== userId);
}

/**
 * The gate every agent write passes. Returns a 428 response when the person has to agree first, or null to go on.
 * Device tokens and personal access tokens pass: the CLI asks its person itself (report §26.6 item 4).
 */
export async function agentGate(
  auth: Principal,
  request: Request,
  body: unknown,
  change: { workspaceId: string; kinds: ChangeKind[]; summary: string; preview?: string },
) {
  if (auth.tokenKind !== "agent" || !auth.user || !auth.extensionSessionId) return null;
  const { policy } = await workspaceAgentPolicy(change.workspaceId);
  if (!needsYes(change.kinds, policy)) return null;
  const given = request.headers.get(CONFIRM_HEADER)?.trim();
  const identity = { userId: auth.user.id, sessionId: auth.extensionSessionId, body };
  if (given) {
    if (await spendConfirmToken(given, identity)) return null;
    return jsonError("That confirmation doesn't match this change, was used already, or expired", 428, "NEEDS_CONFIRMATION", { summary: change.summary, ...fresh(identity, change) });
  }
  return jsonError(`Needs the person's yes: ${change.summary}`, 428, "NEEDS_CONFIRMATION", { summary: change.summary, ...fresh(identity, change) });
}

function fresh(identity: { userId: string; sessionId: string; body: unknown }, change: { preview?: string }) {
  const { token, expiresAt } = issueConfirmToken(identity);
  return { ...(change.preview ? { preview: change.preview.slice(0, 4000) } : {}), confirmToken: token, expiresAt: expiresAt.toISOString(), header: CONFIRM_HEADER };
}

export type UndoInverse =
  | { kind: "task.delete"; taskId: string; projectId: string }
  | { kind: "subtask.delete"; subtaskId: string; taskId: string; projectId: string }
  | { kind: "subtask.set"; subtaskId: string; taskId: string; projectId: string; completed: boolean }
  | { kind: "comment.delete"; commentId: string; taskId: string; projectId: string }
  | { kind: "task.status"; taskId: string; projectId: string; to: string; expectFrom: string }
  | { kind: "task.field"; taskId: string; projectId: string; field: "title" | "description" | "priority" | "dueDate"; value: string | null; expect: string | null }
  | { kind: "task.assign"; taskId: string; projectId: string; assigneeId: string | null; expect: string | null }
  | { kind: "subtask.title"; subtaskId: string; taskId: string; projectId: string; title: string; expect: string }
  | { kind: "files.restore"; projectId: string; files: Array<{ nodeId: string; created: boolean; version: number; previousVersion: number | null }> };

/** Records how to undo a change made with a token (any token, so `nb undo` works too); returns the undo token. */
export async function recordUndo(auth: Principal, input: { workspaceId: string; operation: string; summary: string; inverse: UndoInverse }) {
  if (!auth.tokenScopes || !auth.user) return null;
  const via = await requestVia();
  const [row] = await db
    .insert(undoOperations)
    .values({
      userId: auth.user.id,
      sessionId: auth.extensionSessionId && /^[0-9a-f-]{36}$/i.test(auth.extensionSessionId) ? auth.extensionSessionId : null,
      workspaceId: input.workspaceId,
      operation: input.operation,
      summary: input.summary.slice(0, 300),
      inverse: input.inverse as unknown as Record<string, unknown>,
      via: via?.via ?? null,
      agentName: via?.agentName ?? null,
      expiresAt: new Date(Date.now() + UNDO_TTL_MS),
    })
    .returning({ id: undoOperations.id });
  return row?.id ?? null;
}

/** A not-yet-used, not-expired undo of this person's. */
export async function findUndo(id: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select().from(undoOperations).where(and(eq(undoOperations.id, id), eq(undoOperations.userId, userId))).limit(1);
  if (!row || row.usedAt || row.expiresAt < new Date()) return null;
  return row;
}
