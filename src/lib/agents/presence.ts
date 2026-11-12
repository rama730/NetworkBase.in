import "server-only";

import { logger } from "@/lib/logger";
import { broadcast } from "@/lib/realtime/server-broadcast";
import { getRedisClient } from "@/lib/redis";

/**
 * Report D5, D17 (M4c): which agents are working on a task right now. The MCP server sends a heartbeat every 60
 * seconds while it works on a task; an entry lasts 90 seconds. No migration: Redis holds it, with an in-process map
 * where there is no Redis (local runs and tests).
 * ponytail: the in-process fallback is per server process; production has Redis.
 */
export const AGENT_PRESENCE_TTL_MS = 90_000;
/** At most this many agent sessions per task; more are refused, so rotating session ids can't grow the list. */
export const AGENT_PRESENCE_MAX = 16;
/** The names a person's own sign-in may show; anything else reads "An AI agent" (security review: no spoofing). */
export const KNOWN_AGENTS = ["Claude Code", "Codex", "Cursor", "Gemini CLI", "GitHub Copilot"] as const;
export const agentNameFrom = (name: string | null | undefined) => (KNOWN_AGENTS as readonly string[]).includes(String(name)) ? String(name) : "An AI agent";
/** `since` is the first heartbeat, so the list keeps arrival order; `at` is the latest. */
export type AgentOnTask = { sessionId: string; agentName: string; userId: string; at: number; since: number };

const memory = new Map<string, Map<string, AgentOnTask>>();
const key = (taskId: string) => `presence:agents:${taskId}`;
/** The same topic the task panel listens on (liveTopics.task, report D23). */
const topic = (taskId: string) => `live:task:${taskId}`;

async function readAll(taskId: string): Promise<AgentOnTask[]> {
  const redis = getRedisClient();
  if (!redis) return [...(memory.get(taskId)?.values() ?? [])];
  const raw = (await redis.hgetall<Record<string, AgentOnTask | string>>(key(taskId)).catch(() => null)) ?? {};
  return Object.values(raw).map((v) => (typeof v === "string" ? (JSON.parse(v) as AgentOnTask) : v));
}

export async function agentsOnTask(taskId: string, now = Date.now()): Promise<AgentOnTask[]> {
  return (await readAll(taskId)).filter((a) => now - a.at < AGENT_PRESENCE_TTL_MS).sort((a, b) => (a.since ?? a.at) - (b.since ?? b.at));
}

/**
 * Records one heartbeat; returns the other agents on the task, and tells the task's listeners when one arrives.
 * Stale sessions are dropped on every write, and a task holds at most AGENT_PRESENCE_MAX of them.
 */
export async function markAgentWorking(taskId: string, entry: Omit<AgentOnTask, "at" | "since">, now = Date.now()) {
  const all = await readAll(taskId);
  const stale = all.filter((a) => now - a.at >= AGENT_PRESENCE_TTL_MS).map((a) => a.sessionId);
  const before = all.filter((a) => now - a.at < AGENT_PRESENCE_TTL_MS).sort((a, b) => (a.since ?? a.at) - (b.since ?? b.at));
  const known = before.find((a) => a.sessionId === entry.sessionId);
  if (!known && before.length >= AGENT_PRESENCE_MAX) return { others: before, full: true };
  const value: AgentOnTask = { ...entry, at: now, since: known?.since ?? now };
  const redis = getRedisClient();
  if (redis) {
    if (stale.length) await redis.hdel(key(taskId), ...stale).catch(() => undefined);
    await redis.hset(key(taskId), { [entry.sessionId]: JSON.stringify(value) }).catch(() => undefined);
    await redis.expire(key(taskId), Math.ceil(AGENT_PRESENCE_TTL_MS / 1000)).catch(() => undefined);
  } else {
    const map = memory.get(taskId) ?? new Map<string, AgentOnTask>();
    for (const id of stale) map.delete(id);
    map.set(entry.sessionId, value);
    memory.set(taskId, map);
  }
  // A new session from someone whose same agent is already shown isn't news: no broadcast.
  const arrived = !known && !before.some((a) => a.userId === entry.userId && a.agentName === entry.agentName);
  const agents = [...before.filter((a) => a.sessionId !== entry.sessionId), value].sort((a, b) => a.since - b.since);
  // Only an arrival is broadcast; the panel drops entries older than 90 seconds on its own.
  if (arrived) {
    await broadcast([{ topic: topic(taskId), event: "agent.presence", payload: { agents: agents.map(({ agentName, at }) => ({ agentName, at })) } }]).catch((error) => {
      logger.warn("agents.presence_broadcast_failed", { module: "agents", taskId, error: error instanceof Error ? error.message : String(error) });
    });
  }
  return { others: before.filter((a) => a.sessionId !== entry.sessionId), full: false };
}
