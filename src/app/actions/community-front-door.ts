"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { needsAgreement, parseRules, readCommunitySettings, showGettingStarted } from "@/lib/organizations/community";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 34.2 (plan B5.1, M1): a community's Code of conduct as numbered rules, the member's agreement to its current
 * version (call 1, 4), join answers (call 2) and Getting started (call 7). Settings → Joining is for organisers. The
 * member list is never public (call 8). Never a token.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function community(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; settings: unknown }>(sql`
    SELECT org_type AS type, org_settings AS settings FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "community" || !a.canRead) return null;
  return { userId, inside: a.isOwner || a.isMember, organiser: a.isOwner || a.memberRole === "admin", settings: readCommunitySettings(w.settings) };
}

/** The Code of conduct: the org's document whose title starts with it; its rules from the version members read. */
async function codeOfConduct(orgId: string) {
  const [d] = Array.from(await db.execute<{ id: string; slug: string; version: number; content: string | null }>(sql`
    SELECT d.id, d.slug, coalesce((d.settings->'org'->>'readVersion')::int, 0) AS version,
      (SELECT v.content FROM workspace_document_versions v WHERE v.doc_id = d.id ORDER BY (v.id = d.published_version_id) DESC, v.version_number DESC LIMIT 1) AS content
    FROM workspace_documents d WHERE d.workspace_id = ${orgId}::uuid AND lower(d.filename) LIKE '%code of conduct%' ORDER BY d.created_at LIMIT 1`));
  return d ? { id: d.id, slug: d.slug, version: Number(d.version), rules: parseRules(d.content ?? "") } : null;
}

/** About and Join: the numbered rules (a summary), with a link to the full Code of conduct. Visitors who can read the org see it. */
export async function readCommunityRulesAction(orgId: string) {
  const ctx = await community(orgId);
  if (!ctx) return DENIED;
  const coc = await codeOfConduct(orgId);
  return { success: true as const, rules: coc?.rules ?? [], slug: coc?.slug ?? null, agreeRequired: ctx.settings.agreeRequired, questions: ctx.settings.questions };
}

type MemberCommunity = { agreed?: { version: number; at: string } | null; answers?: Record<string, string>; showAnswer?: boolean; started?: string[] };
async function mine(orgId: string, userId: string) {
  const [m] = Array.from(await db.execute<{ prefs: MemberCommunity | null; joined: string | null }>(sql`
    SELECT view_prefs->'community' AS prefs, joined_at::text AS joined FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid`));
  return m ? { prefs: m.prefs ?? {}, joined: m.joined } : null;
}
const savePrefs = (orgId: string, userId: string, prefs: MemberCommunity) => db.execute(sql`
  UPDATE workspace_members SET view_prefs = coalesce(view_prefs, '{}'::jsonb) || jsonb_build_object('community', ${JSON.stringify(prefs)}::jsonb) WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid`);

/** The member's front door: whether they must agree to the current Code of conduct, and Getting started (14 days). */
export async function readMyCommunityAction(orgId: string) {
  const ctx = await community(orgId);
  if (!ctx?.inside || !ctx.userId) return DENIED;
  const [m, coc] = await Promise.all([mine(orgId, ctx.userId), codeOfConduct(orgId)]);
  if (!m) return { success: true as const, agree: null, gettingStarted: null };
  const agreedVersion = m.prefs.agreed?.version ?? null;
  const must = coc ? needsAgreement(ctx.settings.agreeRequired, coc.version, agreedVersion) : false;
  const items = ctx.settings.gettingStarted;
  const done = (m.prefs.started ?? []).filter((id) => items.some((i) => i.id === id));
  return { success: true as const,
    agree: must && coc ? { version: coc.version, rules: coc.rules, slug: coc.slug, again: agreedVersion !== null } : null,
    gettingStarted: showGettingStarted(m.joined, new Date(), items.length, done.length) ? { items: items.map((i) => ({ ...i, done: done.includes(i.id) })) } : null,
    questions: ctx.settings.questions, answers: m.prefs.answers ?? {}, showAnswer: m.prefs.showAnswer === true };
}

/** I agree (call 1, 4): the Code of conduct's current version and the date, on the member's membership. */
export async function agreeToCodeAction(orgId: string): Promise<{ success: true } | Failure> {
  const ctx = await community(orgId);
  if (!ctx?.inside || !ctx.userId) return DENIED;
  const [m, coc] = await Promise.all([mine(orgId, ctx.userId), codeOfConduct(orgId)]);
  if (!m || !coc) return DENIED;
  await savePrefs(orgId, ctx.userId, { ...m.prefs, agreed: { version: coc.version, at: new Date().toISOString() } });
  return { success: true };
}

/** Getting started: tick an item (a fixed link the organisers chose). */
export async function tickGettingStartedAction(orgId: string, itemId: string): Promise<{ success: true } | Failure> {
  const ctx = await community(orgId);
  if (!ctx?.inside || !ctx.userId || !ctx.settings.gettingStarted.some((i) => i.id === itemId)) return DENIED;
  const m = await mine(orgId, ctx.userId);
  if (!m) return DENIED;
  await savePrefs(orgId, ctx.userId, { ...m.prefs, started: [...new Set([...(m.prefs.started ?? []), itemId])] });
  return { success: true };
}

/** Join answers (call 2): stored on the membership; organisers read them; the card shows them only when ticked. */
export async function saveJoinAnswersAction(orgId: string, input: { answers: Record<string, string>; showAnswer: boolean }): Promise<{ success: true } | Failure> {
  const ctx = await community(orgId);
  if (!ctx?.inside || !ctx.userId || typeof input?.showAnswer !== "boolean") return DENIED;
  const m = await mine(orgId, ctx.userId);
  if (!m) return DENIED;
  const answers = Object.fromEntries(ctx.settings.questions.map((q) => [q.id, String(input.answers?.[q.id] ?? "").trim().slice(0, 500)]).filter(([, v]) => v));
  await savePrefs(orgId, ctx.userId, { ...m.prefs, answers, showAnswer: input.showAnswer });
  return { success: true };
}

const settingsSchema = z.object({
  agreeRequired: z.boolean(),
  questions: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]{1,40}$/), label: z.string().trim().min(1, "Write each question.").max(200) }).strict()).max(3, "Up to 3 join questions."),
  gettingStarted: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]{1,40}$/), label: z.string().trim().min(1, "Name each item.").max(120),
    href: z.string().trim().max(300).refine((h) => h.startsWith("/") || h.startsWith("?"), "Links stay inside NetworkBase.") }).strict()).max(5, "Up to 5 items."),
  welcomePost: z.boolean(),
  firstDayLimit: z.boolean(),
}).strict();

/** Settings → Joining (organisers): agree before joining, join questions, Getting started, welcome post, first-day limits. */
export async function saveJoiningSettingsAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await community(orgId);
  if (!ctx?.organiser) return DENIED;
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the joining settings." };
  await db.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('community', ${JSON.stringify(parsed.data)}::jsonb) WHERE id = ${orgId}::uuid`);
  return { success: true };
}

/** Settings → Joining (organisers) read. */
export async function readJoiningSettingsAction(orgId: string) {
  const ctx = await community(orgId);
  if (!ctx?.organiser) return DENIED;
  return { success: true as const, settings: ctx.settings };
}
