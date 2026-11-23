import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { requestTypeSchema, starterTypes, type RequestType } from "@/lib/workflows/requests";

/**
 * Report 38.7 (plan A2.4): request types are a workspace setting, workspaces.workflow_settings.requests.types (call
 * of A2.4: no table until K5's private company asks need SQL read rules). The two starter types are written the
 * first time anyone reads them, so every way of adding Requests gets them (rollout 2).
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function parse(raw: unknown): RequestType[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((t) => { const r = requestTypeSchema.safeParse(t); return r.success ? [r.data] : []; });
}

export async function readRequestTypes(workspaceId: string): Promise<RequestType[]> {
  const [row] = Array.from(await db.execute<{ types: unknown }>(sql`
    SELECT workflow_settings->'requests'->'types' AS types FROM workspaces WHERE id = ${workspaceId}::uuid`));
  if (row?.types) return parse(row.types);
  await db.execute(sql`
    UPDATE workspaces SET workflow_settings = jsonb_set(coalesce(workflow_settings, '{}'::jsonb), '{requests}', ${JSON.stringify({ types: starterTypes() })}::jsonb)
    WHERE id = ${workspaceId}::uuid AND NOT (coalesce(workflow_settings, '{}'::jsonb) ? 'requests')`);
  const [again] = Array.from(await db.execute<{ types: unknown }>(sql`
    SELECT workflow_settings->'requests'->'types' AS types FROM workspaces WHERE id = ${workspaceId}::uuid`));
  return parse(again?.types);
}

/** One writer at a time (the workspace row is locked); `change` returns the new list or throws a sentence. */
export async function changeRequestTypes(workspaceId: string, change: (types: RequestType[]) => RequestType[]) {
  await readRequestTypes(workspaceId);
  return db.transaction(async (tx: Tx) => {
    const [row] = Array.from(await tx.execute<{ types: unknown }>(sql`
      SELECT workflow_settings->'requests'->'types' AS types FROM workspaces WHERE id = ${workspaceId}::uuid FOR UPDATE`));
    const next = change(parse(row?.types));
    await tx.execute(sql`
      UPDATE workspaces SET workflow_settings = jsonb_set(coalesce(workflow_settings, '{}'::jsonb), '{requests,types}', ${JSON.stringify(next)}::jsonb, true)
      WHERE id = ${workspaceId}::uuid`);
    return next;
  });
}
