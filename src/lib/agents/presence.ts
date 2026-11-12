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
/** `since` is the first heartbeat, so the list keeps arrival order; `at` is the latest. */
export type AgentOnTask = { sessionId: string; agentName: string; userId: string; at: number; since: number };

const memory = new Map<string, Map<string, AgentOnTask>>();
const key = (taskId: string) => `presence:agents:${taskId}`;
/** The same topic the task panel listens on (liveTopics.task, report D23). */
const topic = (taskId: string) => `live:task:${taskId}`;

export async function agentsOnTask(taskId: string, now = Date.now()): Promise<AgentOnTask[]> {
  const redis = getRedisClient();
  let all: AgentOnTask[];
  if (redis) {
    const raw = (await redis.hgetall<Record<string, AgentOnTask | string>>(key(taskId)).catch(() => null)) ?? {};
    all = Object.values(raw).map((v) => (typeof v === "string" ? (JSON.parse(v) as AgentOnTask) : v));
  } else {
    all = [...(memory.get(taskId)?.values() ?? [])];
  }
  return all.filter((a) => now - a.at < AGENT_PRESENCE_TTL_MS).sort((a, b) => (a.since ?? a.at) - (b.since ?? b.at));
}

/** Records one heartbeat; returns the other agents on the task, and tells the task's listeners when one arrives. */
export async function markAgentWorking(taskId: string, entry: Omit<AgentOnTask, "at" | "since">, now = Date.now()) {
  const before = await agentsOnTask(taskId, now);
  const value: AgentOnTask = { ...entry, at: now, since: before.find((a) => a.sessionId === entry.sessionId)?.since ?? now };
  const redis = getRedisClient();
  if (redis) {
    await redis.hset(key(taskId), { [entry.sessionId]: JSON.stringify(value) }).catch(() => undefined);
    await redis.expire(key(taskId), Math.ceil(AGENT_PRESENCE_TTL_MS / 1000)).catch(() => undefined);
  } else {
    const map = memory.get(taskId) ?? new Map<string, AgentOnTask>();
    map.set(entry.sessionId, value);
    memory.set(taskId, map);
  }
  const arrived = !before.some((a) => a.sessionId === entry.sessionId);
  const agents = [...before.filter((a) => a.sessionId !== entry.sessionId), value].sort((a, b) => a.since - b.since);
  // Only an arrival is broadcast; the panel drops entries older than 90 seconds on its own.
  if (arrived) {
    await broadcast([{ topic: topic(taskId), event: "agent.presence", payload: { agents: agents.map(({ agentName, at }) => ({ agentName, at })) } }]).catch((error) => {
      logger.warn("agents.presence_broadcast_failed", { module: "agents", taskId, error: error instanceof Error ? error.message : String(error) });
    });
  }
  return { others: before.filter((a) => a.sessionId !== entry.sessionId) };
}
