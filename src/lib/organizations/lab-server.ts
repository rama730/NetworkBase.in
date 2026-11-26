import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { readLabSettings, readPosition, type LeavingRecord } from "@/lib/organizations/lab";

/**
 * Report 35.2 (plan B6.1c, R1): on a Leaving plan's end date the membership ends as Finished — the person's lab
 * workspaces go to their supervisor (else the PI), an alumni entry is made (not listed until they say yes), and they're
 * asked "List me as alumni?" once. Kept as Viewer instead when the PI chose that (call 6). Hourly; one person at a time.
 */
export async function finishDueLabMembers() {
  const today = new Date().toISOString().slice(0, 10);
  const due = Array.from(await db.execute<{ org: string; user_id: string }>(sql`
    SELECT m.workspace_id AS org, m.user_id FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
    WHERE w.kind = 'organization' AND w.org_type = 'research' AND w.deleted_at IS NULL AND m.view_prefs->'leaving'->>'end' <= ${today}
      -- Review: an archived, suspended or deleting lab takes no changes; oldest first so nothing starves.
      AND w.suspended_at IS NULL AND w.deletion_scheduled_at IS NULL AND w.status <> 'archived'
    ORDER BY m.view_prefs->'leaving'->>'end' LIMIT 100`));
  let finished = 0;
  for (const d of due) {
    await finishOne(d.org, d.user_id, today).then((ok) => { if (ok) finished += 1; })
      .catch((error) => logger.error("lab.finish_failed", { error: error instanceof Error ? error.message : String(error) }));
  }
  return { finished };
}

async function finishOne(orgId: string, userId: string, today: string) {
  const { handOverChildrenIn } = await import("@/lib/organizations/succession");
  const { removeFromOrg } = await import("@/lib/organizations/members");
  const done = await db.transaction(async (tx) => {
    const [m] = Array.from(await tx.execute<{ role: string; prefs: Record<string, unknown> | null; settings: unknown; owner: string; title: string; slug: string | null }>(sql`
      SELECT m.role, m.view_prefs AS prefs, w.org_settings AS settings, w.owner_id AS owner, w.title, w.slug
      FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.workspace_id = ${orgId}::uuid AND m.user_id = ${userId}::uuid FOR UPDATE OF m`));
    const leaving = m?.prefs?.leaving as LeavingRecord | undefined;
    if (!m || !leaving || leaving.end > today) return null;
    if (userId === m.owner) {
      // They became the PI since: the plan no longer applies.
      await tx.execute(sql`UPDATE workspace_members SET view_prefs = view_prefs - 'leaving' WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid`);
      return null;
    }
    // Review: the starter must still have the authority — the person themselves, the PI, or a Researcher finishing a non-Researcher.
    const [starter] = leaving.by === userId || leaving.by === m.owner ? [{ ok: true }] : Array.from(await tx.execute<{ ok: boolean }>(sql`
      SELECT (EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${leaving.by}::uuid AND role = 'admin' AND completed_at IS NULL)
        AND ${m.role} <> 'admin') AS ok`));
    if (!starter?.ok) {
      await tx.execute(sql`UPDATE workspace_members SET view_prefs = view_prefs - 'leaving' WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid`);
      return null;
    }
    const reportsTo = ((m.settings as { staffGrowth?: { reportsTo?: Record<string, string> } } | null)?.staffGrowth?.reportsTo ?? {})[userId];
    const [sup] = reportsTo ? Array.from(await tx.execute<{ ok: boolean }>(sql`
      SELECT true AS ok FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${reportsTo}::uuid AND role IN ('owner', 'admin') AND completed_at IS NULL AND user_id <> ${userId}::uuid`)) : [];
    await handOverChildrenIn(tx as never, orgId, userId, sup ? reportsTo! : m.owner);
    const pos = readPosition(m.prefs);
    const label = readLabSettings(m.settings).positions.find((p) => p.id === pos.position)?.label ?? null;
    // One entry per person per lab; someone who comes back and finishes again keeps their yes and Now at.
    await tx.execute(sql`
      INSERT INTO lab_alumni (workspace_id, user_id, position_label, start_year, end_year) VALUES (${orgId}::uuid, ${userId}::uuid, ${label}, ${pos.startYear}, ${Number(leaving.end.slice(0, 4))})
      ON CONFLICT (workspace_id, user_id) DO UPDATE SET position_label = excluded.position_label, start_year = coalesce(lab_alumni.start_year, excluded.start_year), end_year = excluded.end_year, updated_at = now()`);
    // Steps still open (the supervisor's handover check, say) go with the plan.
    const stepIds = leaving.steps.map((s) => s.taskId).filter((x): x is string => Boolean(x));
    if (stepIds.length) await tx.execute(sql`UPDATE tasks SET deleted_at = now() WHERE workspace_id = ${orgId}::uuid AND status <> 'done' AND id = ANY(${`{${stepIds.join(",")}}`}::uuid[])`);
    // Nobody reports to them, and Reach the PI stops pointing at them.
    await tx.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{staffGrowth,reportsTo}',
        (SELECT coalesce(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each(coalesce(org_settings->'staffGrowth'->'reportsTo', '{}'::jsonb)) e(k, v) WHERE k <> ${userId}::text AND v <> to_jsonb(${userId}::text)))
      WHERE id = ${orgId}::uuid AND org_settings->'staffGrowth' ? 'reportsTo'`);
    await tx.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{lab,contactId}', 'null'::jsonb) WHERE id = ${orgId}::uuid AND org_settings->'lab'->>'contactId' = ${userId}::text`);
    let seats: Awaited<ReturnType<typeof removeFromOrg>> = [];
    if (leaving.keepAsViewer) {
      // Review: a Viewer here is a Viewer in every lab workspace too, with no open work left on them.
      await tx.execute(sql`UPDATE workspace_members SET role = 'viewer', view_prefs = view_prefs - 'leaving' WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid`);
      const children = Array.from(await tx.execute<{ id: string }>(sql`
        UPDATE workspace_members SET role = 'viewer' WHERE user_id = ${userId}::uuid AND role <> 'owner'
          AND workspace_id IN (SELECT id FROM workspaces WHERE parent_id = ${orgId}::uuid AND deleted_at IS NULL) RETURNING workspace_id AS id`));
      await tx.execute(sql`UPDATE tasks SET assignee_id = NULL, updated_at = now() WHERE assignee_id = ${userId}::uuid AND status <> 'done' AND deleted_at IS NULL
        AND (workspace_id = ${orgId}::uuid OR workspace_id IN (SELECT id FROM workspaces WHERE parent_id = ${orgId}::uuid))`);
      const { syncWorkspaceChat } = await import("@/lib/messaging/integrations");
      for (const id of [orgId, ...children.map((c) => c.id)]) await syncWorkspaceChat(tx as never, id, userId, "role");
    } else {
      seats = await removeFromOrg(tx as never, orgId, userId, m.owner, { by: leaving.by, reason: "finished" });
    }
    return { title: m.title, slug: m.slug, seats };
  });
  if (!done) return false;
  if (done.seats.length) await (await import("@/lib/organizations/members")).notifySeatsReopened(orgId, done.seats);
  const { createNotification } = await import("@/lib/notifications/service");
  await createNotification({ recipientUserId: userId, actorUserId: null, kind: "project_task_activity", category: "tasks", importance: "more",
    title: `You finished in ${done.title}. List you as alumni?`, href: `/org/${encodeURIComponent(done.slug ?? orgId)}?tab=about`,
    entityRefs: { projectId: orgId, projectSlug: done.slug }, dedupeKey: `lab-alumni-ask:${orgId}:${userId}` }).catch(() => undefined);
  return true;
}
