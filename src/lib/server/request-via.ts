/**
 * Who is behind this request, for the "via Claude Code" labels (report A7.11, A9.7): a request with an agent token
 * (nb_agt_) is "agent" with the agent's name; any other token (CLI, editor, personal access) is "cli"; a browser
 * request, a job or a script without a request is null. Read from the request's own Authorization header, so
 * every place that saves a version, task, subtask, comment, push or activity event can ask without having the
 * token passed down.
 */
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";

import { db } from "@/lib/db";
import { extensionDeviceSessions } from "@/lib/db/schema";

export type RequestVia = { via: "cli" | "agent"; agentName: string | null } | null;

const memo = new WeakMap<object, Promise<RequestVia>>();

async function resolve(authorization: string | null): Promise<RequestVia> {
  const token = /^bearer\s+(\S+)/i.exec(authorization ?? "")?.[1] ?? "";
  if (!/^nb_(dev|pat|agt)_/.test(token)) return null;
  if (!token.startsWith("nb_agt_")) return { via: "cli", agentName: null };
  const [row] = await db
    .select({ agentName: extensionDeviceSessions.agentName })
    .from(extensionDeviceSessions)
    .where(eq(extensionDeviceSessions.tokenHash, crypto.createHash("sha256").update(token).digest("hex")))
    .limit(1);
  return { via: "agent", agentName: row?.agentName ?? null };
}

export async function requestVia(): Promise<RequestVia> {
  let store: Awaited<ReturnType<typeof headers>>;
  try {
    store = await headers();
  } catch {
    return null; // not inside a request (jobs, scripts)
  }
  let pending = memo.get(store);
  if (!pending) {
    pending = resolve(store.get("authorization"));
    memo.set(store, pending);
  }
  return pending;
}

/** Column values for tables with `via` / `agent_name`. */
export async function viaColumns() {
  const v = await requestVia();
  return { via: v?.via ?? null, agentName: v?.agentName ?? null };
}

/** Extra fields for an activity event's payload; empty for the app. */
export async function viaPayload(): Promise<{ via?: "cli" | "agent"; agentName?: string }> {
  const v = await requestVia();
  return v ? { via: v.via, ...(v.agentName ? { agentName: v.agentName } : {}) } : {};
}
