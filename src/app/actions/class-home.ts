"use server";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { profiles, workspaceSprints, workspaces } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { nextSession, officeHoursToday, readClassDetails, readSessionChanges, termSessions, type ClassDetails, type Session } from "@/lib/organizations/class-sessions";
import { typeProfile } from "@/lib/organizations/type-profile";
import { resolveWorkspaceDocPermission } from "@/lib/workspaces/doc";
import { normalizeWorkspacePublicTabVisibility } from "@/lib/workspaces/settings-policies";
import type { OrgType } from "@/lib/organizations/config";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 30.2 W1 (plan B1.1): an Education class's home — Class details, the Syllabus card, This term and the Next
 * class line. Teachers (the owner) edit details; teachers and TAs (admins) cancel or move one session.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function classOf(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const [row] = await db.select({ id: workspaces.id, slug: workspaces.slug, ownerId: workspaces.ownerId, kind: workspaces.kind, orgType: workspaces.orgType, orgLevel: workspaces.orgLevel,
    orgSettings: workspaces.orgSettings, termStart: workspaces.termStart, termEnd: workspaces.termEnd, timeZone: workspaces.timeZone, status: workspaces.status })
    .from(workspaces).where(and(eq(workspaces.id, orgId), isNull(workspaces.deletedAt))).limit(1);
  return row?.kind === "organization" && !row.orgLevel && typeProfile(row.orgType as OrgType | null).schools ? row : null;
}
async function viewer(orgId: string) {
  const { userId } = await getViewerAuthContext();
  const access = await getWorkspaceAccessById(orgId, userId ?? null);
  const inside = Boolean(userId) && (access.isOwner || access.isMember);
  return { userId: userId ?? null, access, inside, role: access.isOwner ? "owner" : inside ? access.memberRole : null };
}

export type ClassHome = {
  success: true;
  zone: string | null;
  role: "teacher" | "ta" | "member" | "visitor";
  canEditDetails: boolean;
  canChangeSessions: boolean;
  details: ClassDetails | null;
  term: { start: string | null; end: string | null } | null;
  ended: boolean;
  teacher: { id: string; name: string } | null;
  next: Session | null;
  upcoming: Session[];
  officeHoursToday: ClassDetails["officeHours"];
  syllabus: { slug: string; title: string; firstParagraph: string | null; published: boolean } | null;
  units: Array<{ id: string; name: string; start: string | null; end: string | null; status: string }>;
};

/** Everything the About and Overview parts need, cut down to the visitor rows for people outside the class. */
export async function readClassHomeAction(orgId: string): Promise<ClassHome | Failure> {
  try {
    const c = await classOf(orgId);
    if (!c) return DENIED;
    const v = await viewer(orgId);
    if (!v.access.canRead) return DENIED;
    const full = readClassDetails(c.orgSettings);
    const details = full && !v.inside ? { ...full, courseCode: full.show.courseCode ? full.courseCode : null, meets: full.show.meets ? full.meets : [],
      room: full.show.room ? full.room : null, onlineLink: null, officeHours: full.show.officeHours ? full.officeHours : null, breaks: [] } : full;
    const sessions = full && v.inside ? termSessions(full, { start: c.termStart, end: c.termEnd }, readSessionChanges(c.orgSettings)) : [];
    const next = nextSession(sessions, c.timeZone);
    const [teacher] = await db.select({ id: profiles.id, name: sql<string>`coalesce(${profiles.fullName}, ${profiles.username}, 'Teacher')` }).from(profiles).where(eq(profiles.id, c.ownerId)).limit(1);
    // The syllabus: the class document made from the Syllabus template; outsiders see it only once it's public.
    const [doc] = Array.from(await db.execute<{ slug: string; filename: string; content: string | null; published: boolean; settings: unknown }>(sql`
      SELECT d.slug, d.filename, v.content, d.published_version_id IS NOT NULL AS published, d.settings
      FROM workspace_documents d LEFT JOIN workspace_document_versions v ON v.id = d.published_version_id
      WHERE d.workspace_id = ${orgId}::uuid AND d.settings->>'kind' = 'syllabus' ORDER BY d.created_at LIMIT 1`));
    // Security review (B1.1): the syllabus follows the same read rule as the document itself (leaders-only, members-only,
    // the public Documents tab, a draft class); drafts only for people who may read drafts.
    const perm = doc ? resolveWorkspaceDocPermission({ actorUserId: v.userId, projectVisibility: v.access.project?.visibility, projectStatus: v.access.project?.status,
      publicTabVisibility: v.access.project?.publicTabVisibility, settings: doc.settings, membershipRole: v.inside ? v.role : null, isOwner: v.access.isOwner,
      isActiveMember: v.inside, hasPublishedReadme: doc.published, orgRules: true }) : null;
    const showDoc = doc && perm && (doc.published ? perm.canReadPublished : perm.canReadDraft);
    const units = await db.select({ id: workspaceSprints.id, name: workspaceSprints.name, start: workspaceSprints.startDate, end: workspaceSprints.endDate, status: workspaceSprints.status })
      .from(workspaceSprints).where(and(eq(workspaceSprints.projectId, orgId), isNull(workspaceSprints.parentSprintId), isNull(workspaceSprints.pathPosition)))
      .orderBy(asc(workspaceSprints.startDate)).limit(30);
    const showTerm = v.inside || Boolean(full?.show.term);
    // Security review (B1.1): units are sprints, so outsiders see them only when the class shows Sprints publicly.
    const showUnits = v.inside || normalizeWorkspacePublicTabVisibility(v.access.project?.publicTabVisibility).sprints;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: c.timeZone || "UTC" }).format(new Date());
    return {
      success: true, zone: c.timeZone, details,
      role: v.role === "owner" ? "teacher" : v.role === "admin" ? "ta" : v.inside ? "member" : "visitor",
      canEditDetails: v.role === "owner" && v.access.canWrite,
      canChangeSessions: (v.role === "owner" || v.role === "admin") && v.access.canWrite,
      term: showTerm ? { start: c.termStart, end: c.termEnd } : null,
      ended: c.status === "archived" || Boolean(c.termEnd && c.termEnd < today),
      teacher: teacher ? { id: teacher.id, name: teacher.name } : null,
      next, upcoming: next ? sessions.slice(sessions.indexOf(next), sessions.indexOf(next) + 6) : [],
      officeHoursToday: full && v.inside ? officeHoursToday(full, c.timeZone) : null,
      syllabus: showDoc ? { slug: doc.slug, title: doc.filename.replace(/\.md$/i, ""), published: doc.published,
        firstParagraph: doc.content ? firstParagraph(doc.content) : null } : null,
      units: showUnits ? units.map((u) => ({ id: u.id, name: u.name, start: u.start?.toISOString() ?? null, end: u.end?.toISOString() ?? null, status: u.status })) : [],
    };
  } catch (error) {
    logger.warn("class_home.read_failed", { orgId, error: error instanceof Error ? error.message : String(error) });
    return { success: false, error: "Couldn’t load the class details." };
  }
}

/** The first plain paragraph of a Markdown document: no heading, list, table or quote, at most 280 characters. */
function firstParagraph(markdown: string) {
  const para = markdown.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !/^(#|[-*+] |\d+\. |\||>|```)/.test(p));
  return para ? para.replace(/\s+/g, " ").replace(/[*_`]/g, "").slice(0, 280) : null;
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const detailsInput = z.object({
  courseCode: z.string().trim().max(20).nullable(),
  meets: z.array(z.object({ day: z.number().int().min(0).max(6), start: time, end: time }).refine((m) => m.end > m.start, "A class ends after it starts.")).max(14),
  room: z.string().trim().max(80).nullable(),
  onlineLink: z.string().trim().max(300).regex(/^https:\/\/\S+$/, "Use an https:// link.").nullable(),
  officeHours: z.object({ days: z.array(z.number().int().min(0).max(6)).max(7), start: time, end: time, place: z.string().trim().max(80).nullable() })
    .refine((o) => o.end > o.start, "Office hours end after they start.").nullable(),
  credits: z.number().min(0).max(60).nullable(),
  breaks: z.array(z.object({ name: z.string().trim().min(1).max(60), start: day, end: day }).refine((b) => b.end >= b.start, "A break ends on or after its first day.")).max(20),
  show: z.object({ courseCode: z.boolean(), meets: z.boolean(), term: z.boolean(), room: z.boolean(), officeHours: z.boolean() }),
});

/** Settings → Class details (the teacher). "Tell the class" posts one short announcement; silent otherwise. */
export async function saveClassDetailsAction(orgId: string, input: unknown, tellClass = false): Promise<{ success: true } | Failure> {
  const c = await classOf(orgId);
  if (!c) return DENIED;
  const v = await viewer(orgId);
  if (v.role !== "owner" || !v.access.canWrite || !v.userId) return DENIED;
  const parsed = detailsInput.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the details." };
  const details = { ...parsed.data, courseCode: parsed.data.courseCode || null, room: parsed.data.room || null, onlineLink: parsed.data.onlineLink || null };
  await db.update(workspaces).set({ orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) || ${JSON.stringify({ classDetails: details })}::jsonb`, updatedAt: new Date() })
    .where(eq(workspaces.id, orgId));
  if (tellClass) {
    const { postOrgAnnouncement } = await import("@/lib/organizations/org-updates");
    await postOrgAnnouncement(orgId, v.userId, "Class details changed: see About for when and where we meet.").catch(() => null);
  }
  return { success: true };
}

/** Cancel this class / Move this class / Restore, on one session (teacher or TA). Members hear about it (Important). */
export async function changeSessionAction(orgId: string, input: { key: string; change: "cancel" | "restore" | { moveTo: string } }): Promise<{ success: true } | Failure> {
  const c = await classOf(orgId);
  if (!c) return DENIED;
  const v = await viewer(orgId);
  if (!(v.role === "owner" || v.role === "admin") || !v.access.canWrite || !v.userId) return DENIED;
  const details = readClassDetails(c.orgSettings);
  const changes = readSessionChanges(c.orgSettings);
  const plain = details ? termSessions(details, { start: c.termStart, end: c.termEnd }) : [];
  if (!plain.some((s) => s.key === input.key)) return { success: false, error: "That class isn’t in this term." };
  const moveTo = typeof input.change === "object" ? input.change.moveTo : null;
  if (moveTo !== null && !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(moveTo)) return { success: false, error: "Pick a day and time." };
  const next = { ...changes };
  if (input.change === "restore") delete next[input.key];
  else next[input.key] = moveTo ? { movedTo: moveTo } : { cancelled: true };
  await db.update(workspaces).set({ orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) || ${JSON.stringify({ sessionChanges: next })}::jsonb` }).where(eq(workspaces.id, orgId));
  const { describeLocal } = await import("@/lib/organizations/zoned-time");
  const when = describeLocal(input.key, c.timeZone, null).text;
  const title = input.change === "restore" ? `The ${when} class is on again` : moveTo ? `The ${when} class moved to ${describeLocal(moveTo, c.timeZone, null).text}` : `The ${when} class is cancelled`;
  const { notifyOrg } = await import("@/lib/organizations/notify");
  await notifyOrg({ orgId, eventKey: "org.class_changed", actorId: v.userId, title, href: `/org/${encodeURIComponent(c.slug ?? orgId)}`, sourceEventId: `class-session:${orgId}:${input.key}:${Date.now()}` }).catch(() => undefined);
  return { success: true };
}
