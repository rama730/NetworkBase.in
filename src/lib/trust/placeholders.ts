import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

// Hidden and removed content, in place (docs/trust-and-safety-concept.md §7.1, §8.1). Readers drop soft-deleted rows,
// so the feeds ask for these separately and slot a placeholder in at the content's own time:
//   Hide: the author sees "Hidden by NetworkBase · §rule · case · Appeal"; others see "This post was hidden".
//   Remove: the author sees a grey "removed" row with Appeal; others see nothing.
//   Hidden while we review (an urgent auto-hide): everyone sees that, until staff decide.

export type ModeratedItem = {
  kind: "update" | "update_comment" | "task_comment" | "chat_message";
  targetId: string;
  seq: number | null;
  /** The post a comment belongs to, or the task. */
  parentId: string | null;
  createdAt: string | null;
  state: "hidden" | "removed" | "review";
  /** Only for the author: the rule, case and appeal link. */
  mine: boolean;
  rule: number | null;
  caseLabel: string | null;
  canAppeal: boolean;
};

type Row = {
  kind: ModeratedItem["kind"]; target_id: string; target_seq: number | null; parent_id: string | null; created_at: string | null;
  state: ModeratedItem["state"]; subject_id: string | null; rule: number | null; number: number | null; appeal_open: boolean;
};

function shape(rows: Row[], viewerId: string): ModeratedItem[] {
  return rows.flatMap((r) => {
    const mine = r.subject_id === viewerId;
    // Others never learn that something was removed, nor the rule behind a hide.
    if (!mine && r.state === "removed") return [];
    return [{
      kind: r.kind, targetId: r.target_id, seq: r.target_seq, parentId: r.parent_id, createdAt: r.created_at ? new Date(r.created_at).toISOString() : null, state: r.state, mine,
      rule: mine ? r.rule : null, caseLabel: mine && r.number ? `NB-${r.number}` : null, canAppeal: mine && r.appeal_open,
    }];
  });
}

const DECIDED = sql`a.action IN ('hide', 'remove') AND a.undone_at IS NULL AND a.reversed_at IS NULL AND a.lifted_at IS NULL AND a.notified_at IS NOT NULL`;
const APPEAL_OPEN = sql`(a.appeal_until > now() AND NOT EXISTS (SELECT 1 FROM moderation_appeals ap WHERE ap.case_id = a.case_id))`;

/** Posts, post comments and task comments in one workspace. The caller has checked the viewer can read it. */
export async function moderatedInWorkspace(workspaceId: string, viewerId: string) {
  const rows = await db.execute<Row>(sql`
    SELECT a.target_kind AS kind, a.target_id, NULL::int AS target_seq, coalesce(uc.update_id, tc.task_id) AS parent_id,
           coalesce(u.created_at, uc.created_at, tc.created_at)::text AS created_at,
           CASE a.action WHEN 'hide' THEN 'hidden' ELSE 'removed' END AS state, a.subject_id, a.rule, c.number::int AS number, ${APPEAL_OPEN} AS appeal_open
    FROM moderation_actions a JOIN moderation_cases c ON c.id = a.case_id
      LEFT JOIN workspace_updates u ON a.target_kind = 'update' AND u.id = a.target_id
      LEFT JOIN workspace_update_comments uc ON a.target_kind = 'update_comment' AND uc.id = a.target_id
      LEFT JOIN task_comments tc ON a.target_kind = 'task_comment' AND tc.id = a.target_id
    WHERE c.workspace_id = ${workspaceId} AND a.target_kind IN ('update', 'update_comment', 'task_comment') AND ${DECIDED}
    UNION ALL
    SELECT c.target_kind, c.target_id, NULL, coalesce(uc.update_id, tc.task_id), coalesce(u.created_at, uc.created_at, tc.created_at)::text,
           'review', c.subject_id, NULL, c.number::int, false
    FROM moderation_cases c
      LEFT JOIN workspace_updates u ON c.target_kind = 'update' AND u.id = c.target_id
      LEFT JOIN workspace_update_comments uc ON c.target_kind = 'update_comment' AND uc.id = c.target_id
      LEFT JOIN task_comments tc ON c.target_kind = 'task_comment' AND tc.id = c.target_id
    WHERE c.workspace_id = ${workspaceId} AND c.target_kind IN ('update', 'update_comment', 'task_comment') AND c.auto_hidden_at IS NOT NULL
      AND c.state IN ('open', 'in_review')
    LIMIT 500`);
  return shape([...rows], viewerId);
}

/** Messages in one conversation. The caller has checked the viewer is in it. */
export async function moderatedInChannel(channelId: string, viewerId: string) {
  const rows = await db.execute<Row>(sql`
    SELECT 'chat_message' AS kind, a.target_id, a.target_seq::int AS target_seq, NULL AS parent_id, NULL AS created_at,
           CASE a.action WHEN 'hide' THEN 'hidden' ELSE 'removed' END AS state, a.subject_id, a.rule, c.number::int AS number, ${APPEAL_OPEN} AS appeal_open
    FROM moderation_actions a JOIN moderation_cases c ON c.id = a.case_id
    WHERE a.target_kind = 'chat_message' AND a.target_id = ${channelId} AND ${DECIDED}
    UNION ALL
    SELECT 'chat_message', c.target_id, c.target_seq::int, NULL, NULL, 'review', c.subject_id, NULL, c.number::int, false
    FROM moderation_cases c
    WHERE c.target_kind = 'chat_message' AND c.target_id = ${channelId} AND c.auto_hidden_at IS NOT NULL AND c.state IN ('open', 'in_review')
    LIMIT 500`);
  return shape([...rows], viewerId);
}
