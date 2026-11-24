import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/service";
import { countWords, readChapter, readThesisSettings } from "@/lib/workflows/thesis";

// Report 30.6 W5 (plan B1.8c): server-only thesis steps — the coordinator's numbers and the no-supervision notice.
export const NO_SUPERVISION_DAYS = 30;

export type ThesisRow = {
  workspaceId: string; slug: string | null; title: string; student: string | null; supervisor: string | null;
  milestone: { title: string; due: string | null; overdue: boolean } | null; words: number; target: number;
  lastSupervision: string | null; daysSince: number | null; noSupervision: boolean;
};

type Ws = { id: string; slug: string | null; title: string; owner_id: string; student: string | null; settings: unknown; added_at: string };

/** Thesis workspaces (Thesis added, not deleted) under `orgId`, or every one when `orgId` is null (the hourly job). */
async function thesisWorkspaces(orgId: string | null) {
  return Array.from(await db.execute<Ws>(sql`
    SELECT w.id, w.slug, w.title, w.owner_id, coalesce(p.full_name, p.username) AS student, w.workflow_settings AS settings, f.added_at::text AS added_at
    FROM workspaces w
    JOIN LATERAL (SELECT min(x.added_at) AS added_at FROM workspace_workflows x WHERE x.workflow = 'thesis' AND x.hidden_at IS NULL
      AND (x.workspace_id = w.id OR (x.workspace_id = w.parent_id AND x.push_to_children))) f ON f.added_at IS NOT NULL
    LEFT JOIN profiles p ON p.id = w.owner_id
    WHERE w.deleted_at IS NULL AND w.kind IS DISTINCT FROM 'organization' ${orgId ? sql`AND w.parent_id = ${orgId}::uuid` : sql``} ORDER BY w.title LIMIT 500`));
}

/** The last Supervision meeting's day in each workspace. */
async function lastSupervisions(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = Array.from(await db.execute<{ workspace_id: string; day: string }>(sql`
    SELECT workspace_id, max(settings->>'date') AS day FROM workspace_documents
    WHERE workspace_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) AND settings->>'section' = 'meetings' AND settings->>'kind' = 'supervision'
      AND settings->>'date' <= ${new Date().toISOString().slice(0, 10)} GROUP BY workspace_id`));
  return new Map(rows.map((r) => [r.workspace_id, r.day]));
}

const daysBetween = (fromDay: string, now: Date) => Math.floor((now.getTime() - Date.parse(`${fromDay.slice(0, 10)}T00:00:00Z`)) / 86_400_000);

/** B1.8c layer 4: the coordinator's table — numbers only, never thesis text (call). */
export async function thesisRows(orgId: string, readText: (workspaceId: string, nodeId: string) => Promise<string>, now = new Date()): Promise<ThesisRow[]> {
  const list = await thesisWorkspaces(orgId);
  if (!list.length) return [];
  const ids = list.map((w) => w.id);
  const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const chapters = Array.from(await db.execute<{ workspace_id: string; settings: unknown; content: string | null; node_id: string | null }>(sql`
    SELECT d.workspace_id, d.settings, v.content, d.linked_node_id AS node_id FROM workspace_documents d LEFT JOIN workspace_document_versions v ON v.id = d.published_version_id
    WHERE d.workspace_id IN (${idList}) AND d.settings->>'section' = 'chapters'`));
  const milestones = Array.from(await db.execute<{ workspace_id: string; title: string; due: string | null }>(sql`
    SELECT DISTINCT ON (workspace_id) workspace_id, title, due_date::text AS due FROM tasks
    WHERE workspace_id IN (${idList}) AND assignment_id IS NOT NULL AND deleted_at IS NULL AND excused_at IS NULL AND status <> 'done'
    ORDER BY workspace_id, due_date ASC NULLS LAST`));
  const supervisorIds = [...new Set(list.map((w) => readThesisSettings(w.settings).supervisorId).filter((x): x is string => Boolean(x)))];
  const names = new Map(supervisorIds.length ? Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT id, coalesce(full_name, username, 'Supervisor') AS name FROM profiles WHERE id IN (${sql.join(supervisorIds.map((id) => sql`${id}::uuid`), sql`, `)})`)).map((r) => [r.id, r.name]) : []);
  const last = await lastSupervisions(ids);
  // A chapter made from Overview is a linked file: its words are the file's (read with the coordinator's own access).
  for (const c of chapters) if (c.node_id) c.content = await readText(c.workspace_id, c.node_id).catch(() => "");
  return list.map((w) => {
    const mine = chapters.filter((c) => c.workspace_id === w.id);
    const m = milestones.find((x) => x.workspace_id === w.id);
    const lastDay = last.get(w.id) ?? null;
    const since = daysBetween(lastDay ?? w.added_at, now);
    return {
      workspaceId: w.id, slug: w.slug, title: w.title, student: w.student, supervisor: names.get(readThesisSettings(w.settings).supervisorId ?? "") ?? null,
      milestone: m ? { title: m.title, due: m.due, overdue: Boolean(m.due && Date.parse(m.due) < now.getTime()) } : null,
      words: mine.reduce((n, c) => n + countWords(c.content ?? ""), 0), target: mine.reduce((n, c) => n + (readChapter(c.settings) ?? readChapter({ chapter: {} })!).target, 0),
      lastSupervision: lastDay, daysSince: lastDay ? since : null, noSupervision: since >= NO_SUPERVISION_DAYS,
    };
  });
}

/**
 * Layer 15: "No supervision in 30 days" — Normal, once per gap, to the student and the supervisor. The gap is keyed by
 * the last supervision (or the day Thesis was added), so a new supervision starts a new gap. Runs in the hourly job.
 */
export async function notifyNoSupervision(now = new Date()) {
  const list = await thesisWorkspaces(null);
  const last = await lastSupervisions(list.map((w) => w.id));
  let sent = 0;
  for (const w of list) {
    const from = last.get(w.id) ?? w.added_at.slice(0, 10);
    if (daysBetween(from, now) < NO_SUPERVISION_DAYS) continue;
    const to = [w.owner_id, readThesisSettings(w.settings).supervisorId].filter((x): x is string => Boolean(x));
    for (const recipient of new Set(to)) {
      await createNotification({
        recipientUserId: recipient, actorUserId: null, kind: "project_task_activity", category: "tasks", importance: "more",
        title: `${w.title}: no supervision in ${NO_SUPERVISION_DAYS} days`, href: `/workspaces/${encodeURIComponent(w.slug || w.id)}?tab=docs`,
        entityRefs: { projectId: w.id, projectSlug: w.slug }, dedupeKey: `no-supervision:${w.id}:${from}`,
      }).then(() => { sent += 1; }).catch((error) => logger.error("thesis.no_supervision_notice_failed", { error: error instanceof Error ? error.message : String(error) }));
    }
  }
  return { sent };
}
