"use server";

import { sql } from "drizzle-orm";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { agendaOpen, clubMeetingsSchema, readClubMeetings } from "@/lib/organizations/club";
import { clubQuorum, notifyAll } from "@/lib/organizations/club-server";
import { clubLike } from "@/lib/organizations/kits";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 36.4 (plan B7.3a, L3 calls 1–3, 5): a club's next general meeting for members — its date, the quorum it needs,
 * and Add to the agenda until the deadline; officers accept or hold each proposed item (the proposer is told). The
 * meeting's own document stays with officers until its minutes are approved, so members see only its title and time.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function club(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; settings: unknown; slug: string | null; title: string }>(sql`
    SELECT org_type AS type, org_settings AS settings, slug, title FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (!w || !clubLike(w.type, w.settings, "clubMeetings") || !a.canRead || !(a.isOwner || a.isMember)) return null;
  return { userId, w, officer: (a.isOwner || a.memberRole === "admin") && !a.writeBlocked, president: a.isOwner && !a.writeBlocked,
    member: !a.writeBlocked && (a.isOwner || a.memberRole !== "viewer"), settings: readClubMeetings(w.settings) };
}

type Meeting = { id: string; title: string; starts_at: string; kind: string };
/** The next general meeting or AGM in the club itself that hasn't finished. */
async function nextMeeting(orgId: string) {
  const [m] = Array.from(await db.execute<Meeting>(sql`
    SELECT id, coalesce(settings->>'meetingTitle', regexp_replace(filename, '\.md$', '', 'i')) AS title, settings->>'startsAt' AS starts_at, settings->>'kind' AS kind
    FROM workspace_documents WHERE workspace_id = ${orgId}::uuid AND settings->>'section' = 'meetings' AND settings->>'kind' IN ('general', 'agm')
      AND NOT (settings ? 'finishedAt') AND (settings->>'startsAt')::timestamptz > now() - interval '12 hours'
    ORDER BY (settings->>'startsAt')::timestamptz LIMIT 1`));
  return m ?? null;
}

/** The next general meeting (members): when, quorum, Add to the agenda; agenda requests (officers all, members their own). */
export async function readClubMeetingAction(orgId: string) {
  const ctx = await club(orgId);
  if (!ctx) return DENIED;
  const [m, q] = await Promise.all([nextMeeting(orgId), clubQuorum(orgId)]);
  const base = { success: true as const, officer: ctx.officer, president: ctx.president, settings: ctx.settings, quorum: q };
  if (!m) return { ...base, meeting: null, requests: [] };
  const requests = Array.from(await db.execute<{ id: string; title: string; state: string; by: string | null; name: string | null }>(sql`
    SELECT r.id, r.title, r.state, r.proposed_by AS by, coalesce(p.full_name, p.username) AS name FROM club_agenda_requests r LEFT JOIN profiles p ON p.id = r.proposed_by
    WHERE r.doc_id = ${m.id}::uuid AND (${ctx.officer} OR r.proposed_by = ${ctx.userId}::uuid) ORDER BY r.created_at LIMIT 100`));
  return { ...base, meeting: { id: m.id, title: m.title, startsAt: m.starts_at, kind: m.kind as "general" | "agm",
    canPropose: ctx.member && ctx.settings.propose && agendaOpen(m.starts_at, ctx.settings.agendaDays) },
    requests: requests.map((r) => ({ id: r.id, title: r.title, state: r.state as "proposed" | "accepted" | "held", mine: r.by === ctx.userId, name: r.name ?? "Member" })) };
}

/** Add to the agenda (members, until the deadline; up to 3 open items each per meeting). */
export async function proposeAgendaItemAction(orgId: string, docId: string, title: unknown): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  if (!ctx?.member || !isLooseUuid(docId) || typeof title !== "string" || !title.trim() || title.trim().length > 200) return DENIED;
  const m = await nextMeeting(orgId);
  if (!m || m.id !== docId) return DENIED;
  if (!ctx.settings.propose || !agendaOpen(m.starts_at, ctx.settings.agendaDays)) return { success: false, error: "The agenda for this meeting has closed." };
  const made = Array.from(await db.execute(sql`
    INSERT INTO club_agenda_requests (org_id, doc_id, proposed_by, title)
    SELECT ${orgId}::uuid, ${docId}::uuid, ${ctx.userId}::uuid, ${title.trim()}
    WHERE (SELECT count(*) FROM club_agenda_requests WHERE doc_id = ${docId}::uuid AND proposed_by = ${ctx.userId}::uuid AND state = 'proposed') < 3 RETURNING id`));
  if (!made.length) return { success: false, error: "You have 3 items waiting; an officer answers them first." };
  return { success: true };
}

/** Accept or hold a proposed item (officers); the proposer is told. */
export async function decideAgendaItemAction(orgId: string, requestId: string, accept: boolean): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  if (!ctx?.officer || !isLooseUuid(requestId) || typeof accept !== "boolean") return DENIED;
  const [r] = Array.from(await db.execute<{ by: string | null; title: string }>(sql`
    UPDATE club_agenda_requests SET state = ${accept ? "accepted" : "held"}, decided_by = ${ctx.userId}::uuid, decided_at = now()
    WHERE id = ${requestId}::uuid AND org_id = ${orgId}::uuid AND state = 'proposed' RETURNING proposed_by AS by, title`));
  if (!r) return DENIED;
  if (r.by) await notifyAll(orgId, ctx.w.slug ?? orgId, [{ to: r.by, title: accept ? `Your agenda item was accepted: ${r.title}` : `Your agenda item was held for later: ${r.title}` }], ctx.userId, `club-agenda:${requestId}`);
  return { success: true };
}

/** Club → Meetings (the President): the agenda deadline, whether members propose items, the quorum share. */
export async function saveClubMeetingsAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  if (!ctx?.president) return DENIED;
  const parsed = clubMeetingsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Pick a deadline of up to 14 days and a quorum between 5% and 100%." };
  await db.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(coalesce(org_settings, '{}'::jsonb), '{club}', coalesce(org_settings->'club', '{}'::jsonb) || jsonb_build_object('meetings', ${JSON.stringify(parsed.data)}::jsonb))
    WHERE id = ${orgId}::uuid`);
  return { success: true };
}
