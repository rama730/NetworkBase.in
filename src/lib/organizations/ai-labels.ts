import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

/** "AI used" on a roster (report A8.3): by how many of the hand-in's files an agent made. */
export type AiUsed = "none" | "some" | "most";
export const aiUsed = (agentFiles: number, total: number): AiUsed => (!agentFiles ? "none" : agentFiles * 2 > total ? "most" : "some");

/** Files whose current version an AI agent made, with the agent's name (report A8.3; versions carry via since 0073). */
export async function agentMadeFiles(nodeIds: string[]): Promise<Map<string, string | null>> {
  if (!nodeIds.length) return new Map();
  const rows = await db.execute<{ node_id: string; agent_name: string | null }>(sql`
    SELECT n.id AS node_id, v.agent_name FROM workspace_nodes n
    JOIN file_versions v ON v.node_id = n.id AND v.version = n.current_version
    WHERE n.id IN (${sql.join([...new Set(nodeIds)].map((id) => sql`${id}::uuid`), sql`, `)}) AND v.via = 'agent'`);
  return new Map(rows.map((r) => [r.node_id, r.agent_name]));
}

/** Per copy: agent-made files among its files (roster column, export). */
export async function aiUseByCopy(copyIds: string[]): Promise<Map<string, AiUsed>> {
  if (!copyIds.length) return new Map();
  const rows = await db.execute<{ copy_id: string; ai: number; total: number }>(sql`
    SELECT n.task_id AS copy_id, count(*) FILTER (WHERE v.via = 'agent')::int AS ai, count(*)::int AS total
    FROM workspace_nodes n JOIN file_versions v ON v.node_id = n.id AND v.version = n.current_version
    WHERE n.task_id IN (${sql.join(copyIds.map((id) => sql`${id}::uuid`), sql`, `)}) AND n.type = 'file' AND n.deleted_at IS NULL
    GROUP BY n.task_id`);
  return new Map(rows.map((r) => [r.copy_id, aiUsed(Number(r.ai), Number(r.total))]));
}
