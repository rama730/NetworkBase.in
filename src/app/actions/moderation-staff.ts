'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db';
import { workspaces } from '@/lib/db/schema';
import { buildTrustEmail } from '@/lib/email/trust-templates';
import { notifyOrg, orgHref, orgLabel } from '@/lib/organizations/notify';
import { stepUpState } from '@/lib/security/fresh-verification';
import type { SecurityStepUpMethod } from '@/lib/security/step-up-methods';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { claimAppeal, decideAppeal, readAppeal } from '@/lib/trust/appeals';
import { logModerationEvent } from '@/lib/trust/cases';
import { addNote, caseIdByNumber, changeSeverity, mergeCase, openManualCase, readCase, readPerson, readVerification, setLegalHold } from '@/lib/trust/console';
import { decideCase, decideTogether, noticeRestrictionEnded, reverseAction, undoDecision, type Decision } from '@/lib/trust/decide';
import {
    assignCase, checkVersion, claimLease, escalateCase, eventsSince, filePreviewUrl, inboxCounts, inboxOrgs, latestSeq, logCaseView, messageContext, readInbox, releaseLease,
    renewLease, ruleTemplates, saveRuleTemplate, type InboxFilters,
} from '@/lib/trust/inbox';
import { decisionNotice } from '@/lib/trust/messages';
import { notifySafety } from '@/lib/trust/notify';
import { caseLabel, parseCaseLabel, REPORT_REASONS, type ModerationActionKind, type ReportReason, type ReportTargetKind } from '@/lib/trust/rules';
import { listStaff, staffRoleOf, type StaffRole } from '@/lib/trust/staff';

// The staff console's writes (docs/trust-and-safety-concept.md §17). Every action checks the staff role again.

type Result<T = object> = ({ success: true } & T) | { success: false; error: string; code?: 'stale' };
const DENIED = { success: false as const, error: 'You don’t have permission to do this.' };
const uuid = z.string().uuid();

/** Staff, signed in with their authenticator (F16): every console action checks this again. */
async function staff(): Promise<{ id: string; role: StaffRole } | null> {
    const { user, snapshot } = await getViewerAuthContext();
    const role = staffRoleOf(user);
    return user && role && snapshot?.aal === 'aal2' ? { id: user.id, role } : null;
}
const refresh = () => revalidatePath('/admin/trust', 'layout');

/** The avatar menu's "Trust & safety" entry: null for everyone but staff (C1). */
export async function staffBadgeAction(): Promise<{ count: number } | null> {
    const { user } = await getViewerAuthContext();
    if (!staffRoleOf(user)) return null;
    // Without the authenticator the entry still shows (it leads to the setup screen), with no counts.
    if (!(await staff())) return { count: 0 };
    const c = await inboxCounts();
    return { count: c.urgent + c.overdue };
}

/** A fresh check of who's at the keyboard (F16), or null when it's recent enough. */
async function needsStepUp(error: string): Promise<StepUpRequired | null> {
    const { supabase, user } = await getViewerAuthContext();
    const state = await stepUpState(supabase, user!);
    return state.fresh ? null : { success: false, error, stepUp: { methods: state.methods, factorId: state.factorId } };
}

const ACTIONS = ['hide', 'remove', 'reset_profile', 'hold_handle', 'remove_verified', 'hide_discover', 'restrict', 'suspend_workspace', 'remove_workspace'] as const satisfies readonly ModerationActionKind[];
const decisionSchema = z.object({
    outcome: z.enum(['no_violation', 'actioned']),
    content: z.enum(ACTIONS).nullable().optional(),
    account: z.object({ action: z.enum(['warning', 'limit', 'suspension', 'ban']), days: z.number().int().min(1).max(60).nullable().optional() }).nullable().optional(),
    rule: z.number().int().min(1).max(15).nullable().optional(),
    message: z.string().trim().max(2000).nullable().optional(),
    note: z.string().trim().max(4000).nullable().optional(),
    expectedVersion: z.number().int().min(1).nullable().optional(),
}).strict();

export type StepUpRequired = { success: false; error: string; stepUp: { methods: SecurityStepUpMethod[]; factorId?: string } };

export async function decideCaseAction(caseId: string, input: Decision): Promise<Result<{ label: string }> | StepUpRequired> {
    const me = await staff();
    if (!me) return DENIED;
    const parsed = decisionSchema.safeParse(input);
    if (!uuid.safeParse(caseId).success || !parsed.success) return { success: false, error: 'Check the decision and try again.' };
    // The riskiest decisions need a fresh check of who's at the keyboard (F16).
    if (parsed.data.account?.action === 'ban' || parsed.data.content === 'remove_workspace') {
        const { supabase, user } = await getViewerAuthContext();
        const state = await stepUpState(supabase, user!);
        if (!state.fresh) return { success: false, error: 'Verify it’s you to send this decision.', stepUp: { methods: state.methods, factorId: state.factorId } };
    }
    const result = await decideCase(caseId, { id: me.id, scope: 'staff', role: me.role }, parsed.data as Decision);
    if (!result.ok) return { success: false, error: result.error, code: result.code };
    const [c] = await db.execute<{ number: number }>(sql`SELECT number::int AS number FROM moderation_cases WHERE id = ${caseId}`);
    return { success: true, label: c ? caseLabel(c.number) : '' };
}

export async function undoDecisionAction(caseId: string): Promise<Result> {
    const me = await staff();
    if (!me || !uuid.safeParse(caseId).success) return DENIED;
    const result = await undoDecision(caseId, me.id);
    return result.ok ? { success: true } : { success: false, error: result.error };
}

/** "Preview email" (17.5): the exact M-email the person would get. */
export async function previewDecisionEmailAction(caseId: string, input: Decision): Promise<Result<{ subject: string; html: string }>> {
    const me = await staff();
    if (!me) return DENIED;
    const parsed = decisionSchema.safeParse(input);
    const c = uuid.safeParse(caseId).success ? await readCase(caseId) : null;
    if (!parsed.success || !c) return { success: false, error: 'Check the decision and try again.' };
    const action = parsed.data.account?.action ?? parsed.data.content;
    if (!action) return { success: false, error: 'Pick an action to preview its email.' };
    const days = parsed.data.account?.days ?? (action === 'limit' ? 7 : 14);
    const notice = decisionNotice({
        caseNumber: c.number, action, targetKind: c.target_kind, where: c.label ? c.label.charAt(0).toLowerCase() + c.label.slice(1) : 'your content',
        rule: parsed.data.rule ?? 15, message: parsed.data.message ?? '', endsAt: ['limit', 'suspension'].includes(action) ? new Date(Date.now() + days * 86_400_000) : null,
        appealUntil: c.reason === 'child_safety' ? null : new Date(Date.now() + (action === 'ban' ? 60 : 30) * 86_400_000), strikesActive: c.strikes + 1, workspaceTitle: c.workspace_title,
    });
    if (!notice.email) return { success: false, error: 'This decision sends no email.' };
    const email = buildTrustEmail('trust_person', notice.email, { email: c.person?.email ?? 'person@example.com', name: c.person?.name ?? 'there', username: c.person?.username });
    return { success: true, subject: email.subject, html: email.html };
}

/** Claims are leases (S3): touching the decision form claims; leaving lets it go. */
export async function claimCaseAction(caseId: string, mode: 'claim' | 'release' | 'take_over', expectedVersion?: number | null): Promise<Result<{ version?: number }>> {
    const me = await staff();
    if (!me || !uuid.safeParse(caseId).success || !['claim', 'release', 'take_over'].includes(mode)) return DENIED;
    if (mode === 'release') return (await releaseLease(caseId, me.id)) ? { success: true } : { success: false, error: 'You weren’t reviewing this case.' };
    const r = await claimLease(caseId, me.id, mode, expectedVersion);
    return r.ok ? { success: true, version: r.version } : { success: false, error: r.error, code: 'code' in r ? r.code : undefined };
}

/** The 45-second heartbeat while a claimed case is open; `active` when they touched the form since the last one. */
export async function caseHeartbeatAction(caseId: string, active: boolean): Promise<Result<{ held: boolean }>> {
    const me = await staff();
    if (!me || !uuid.safeParse(caseId).success) return DENIED;
    return { success: true, held: await renewLease(caseId, me.id, active === true) };
}

export async function addNoteAction(caseId: string, body: string): Promise<Result> {
    const me = await staff();
    const text = body.trim();
    if (!me || !uuid.safeParse(caseId).success) return DENIED;
    if (!text) return { success: false, error: 'Write the note first.' };
    await addNote(caseId, me.id, text);
    return { success: true };
}

export async function legalHoldAction(caseId: string, hold: boolean): Promise<Result | StepUpRequired> {
    const me = await staff();
    if (!me || !uuid.safeParse(caseId).success) return DENIED;
    // Releasing a hold lets retention delete the evidence: it needs a fresh check (F16).
    if (!hold) { const stepUp = await needsStepUp('Verify it’s you to release the legal hold.'); if (stepUp) return stepUp; }
    await setLegalHold(caseId, me.id, hold);
    return { success: true };
}

export async function changeSeverityAction(caseId: string, severity: 'urgent' | 'high' | 'normal', reason: string, expectedVersion?: number | null): Promise<Result> {
    const me = await staff();
    if (!me || !uuid.safeParse(caseId).success || !['urgent', 'high', 'normal'].includes(severity)) return DENIED;
    if (reason.trim().length < 3) return { success: false, error: 'Say why the severity changed.' };
    const stale = await checkVersion(caseId, expectedVersion, me.id);
    if (stale) return { success: false, error: stale.error, code: 'stale' };
    const ok = await changeSeverity(caseId, me.id, severity, reason.trim());
    return ok ? { success: true } : { success: false, error: 'Case not found.' };
}

/** Close a case as a duplicate of another (by number). */
export async function mergeCaseAction(caseId: string, into: string): Promise<Result> {
    const me = await staff();
    const number = parseCaseLabel(into);
    if (!me || !uuid.safeParse(caseId).success) return DENIED;
    const intoId = number ? await caseIdByNumber(number) : null;
    if (!intoId) return { success: false, error: 'Enter an open case number, like NB-1001.' };
    const ok = await mergeCase(caseId, intoId, me.id);
    return ok ? { success: true } : { success: false, error: 'Only open cases can be merged.' };
}

/** Bulk "No rule broken" or a shared content action on several selected cases. */
export async function bulkDecideAction(caseIds: string[], input: Decision): Promise<Result<{ done: number; failed: number }>> {
    const me = await staff();
    const parsed = decisionSchema.safeParse(input);
    if (!me || !parsed.success || !caseIds.length || caseIds.length > 50 || caseIds.some((id) => !uuid.safeParse(id).success)) return DENIED;
    // Bulk is for dismissing or hiding/removing content; account and workspace steps are decided one case at a time.
    if (parsed.data.account || (parsed.data.content && !['hide', 'remove'].includes(parsed.data.content))) return { success: false, error: 'Decide account and workspace actions one case at a time.' };
    let done = 0;
    for (const id of caseIds) if ((await decideCase(id, { id: me.id, scope: 'staff', role: me.role }, { ...parsed.data, expectedVersion: null } as Decision)).ok) done += 1;
    return { success: true, done, failed: caseIds.length - done };
}

/** Lift something in force (17.7): the person hears M5; a workspace owner hears it's back. */
export async function liftActionAction(actionId: string, reason: string): Promise<Result> {
    const me = await staff();
    if (!me || !uuid.safeParse(actionId).success) return DENIED;
    if (reason.trim().length < 3) return { success: false, error: 'Give the reason for lifting it.' };
    const [row] = await db.execute<{ action: string; target_id: string | null }>(sql`SELECT action, target_id FROM moderation_actions WHERE id = ${actionId}`);
    const result = await reverseAction(actionId, me.id, 'lifted', reason.trim());
    if (!result.ok) return { success: false, error: result.error };
    if (row && ['limit', 'suspension', 'ban'].includes(row.action) && result.subjectId) await noticeRestrictionEnded(result.subjectId, actionId);
    else if (row?.target_id) {
        const [w] = await db.select({ ownerId: workspaces.ownerId, title: workspaces.title }).from(workspaces).where(eq(workspaces.id, row.target_id)).limit(1);
        if (w) await notifySafety({ to: w.ownerId, title: `${w.title} is back to normal`, body: 'We lifted the action on it. Thanks for your patience.', dedupeKey: `lifted:${actionId}` });
    }
    refresh();
    return { success: true };
}

/** Org suspensions made before cases existed (Active tab, "legacy" rows). */
export async function unsuspendOrgAction(orgId: string): Promise<Result> {
    const me = await staff();
    if (!me || !uuid.safeParse(orgId).success) return DENIED;
    await db.update(workspaces).set({ suspendedAt: null, suspendReason: null, updatedAt: new Date() }).where(eq(workspaces.id, orgId));
    const org = await orgLabel(orgId);
    const [row] = await db.select({ ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
    if (org && row) await notifyOrg({ orgId, eventKey: 'org.lifecycle', to: [row.ownerId], title: `${org.title} is no longer suspended`, href: orgHref(org), sourceEventId: `unsuspended:${orgId}:${Date.now()}` });
    refresh();
    return { success: true };
}

/** Verification tab (17.9): verify, or decline with an optional note to the owner. */
export async function decideVerificationAction(orgId: string, approve: boolean, note?: string): Promise<Result> {
    const me = await staff();
    if (!me || !uuid.safeParse(orgId).success) return DENIED;
    await db.update(workspaces).set(approve ? { verifiedAt: new Date(), verificationRequestedAt: null } : { verificationRequestedAt: null })
        .where(and(eq(workspaces.id, orgId), eq(workspaces.kind, 'organization')));
    const org = await orgLabel(orgId);
    const [row] = await db.select({ ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
    if (org && row) {
        await notifyOrg({ orgId, eventKey: 'org.lifecycle', to: [row.ownerId], title: approve ? `${org.title} is verified` : `${org.title} wasn’t verified this time`,
            body: approve ? undefined : note?.trim().slice(0, 500) || undefined, href: orgHref(org, '?tab=settings'), sourceEventId: `verification:${orgId}:${Date.now()}` });
    }
    refresh();
    return { success: true };
}

/** Resolves what staff pasted: a profile, workspace or org link, or an @handle. */
async function resolvePasted(value: string): Promise<{ kind: ReportTargetKind; id: string } | null> {
    const text = value.trim();
    let path = text;
    try { path = new URL(text, 'https://networkbase.in').pathname; } catch { /* not a link */ }
    const handle = text.startsWith('@') ? text.slice(1) : path.match(/^\/u\/([^/?#]+)/)?.[1];
    if (handle) {
        const [p] = await db.execute<{ id: string }>(sql`SELECT id FROM profiles WHERE username = ${decodeURIComponent(handle).toLowerCase()} AND deleted_at IS NULL`);
        return p ? { kind: 'person', id: p.id } : null;
    }
    const slug = path.match(/^\/(?:workspaces|org)\/([^/?#]+)/)?.[1];
    if (slug) {
        const key = decodeURIComponent(slug);
        const [w] = await db.execute<{ id: string }>(sql`SELECT id FROM workspaces WHERE (slug = ${key} OR id::text = ${key}) AND deleted_at IS NULL LIMIT 1`);
        return w ? { kind: 'project', id: w.id } : null;
    }
    return null;
}

const newCaseSchema = z.object({
    what: z.string().trim().min(2).max(500),
    reason: z.enum(REPORT_REASONS as [string, ...string[]]),
    severity: z.enum(['urgent', 'high', 'normal']).optional(),
    source: z.enum(['email', 'staff', 'legal']),
    details: z.string().trim().max(2000).optional(),
    emailRef: z.string().trim().max(300).optional(),
    legalHold: z.boolean().optional(),
}).strict();

/** New case (17.12) and "Act on account" (17.8). */
export async function openCaseAction(input: z.input<typeof newCaseSchema>): Promise<Result<{ label: string }>> {
    const me = await staff();
    if (!me) return DENIED;
    const parsed = newCaseSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'Paste a link or @handle and pick a reason.' };
    // ponytail: profiles, workspaces and orgs only; posts and messages are reported from the app, add their links when staff need them.
    const target = await resolvePasted(parsed.data.what);
    if (!target) return { success: false, error: 'Paste a link to a profile, workspace or organization, or an @handle.' };
    const opened = await openManualCase(me.id, { ...parsed.data, ...target, targetId: target.id, reason: parsed.data.reason as ReportReason });
    if (!opened) return { success: false, error: 'That no longer exists.' };
    refresh();
    return { success: true, label: caseLabel(opened.number) };
}

/** Each "Show" on hidden evidence is logged (17.4). */
export async function evidenceShownAction(caseId: string): Promise<Result> {
    const me = await staff();
    if (!me || !uuid.safeParse(caseId).success) return DENIED;
    await logModerationEvent(db, { caseId, actorId: me.id, kind: 'evidence_shown' });
    return { success: true };
}

export async function auditExportedAction(rows: number): Promise<Result | StepUpRequired> {
    const me = await staff();
    if (!me) return DENIED;
    const stepUp = await needsStepUp('Verify it’s you to export the audit log.');
    if (stepUp) return stepUp;
    await logModerationEvent(db, { caseId: null, actorId: me.id, kind: 'audit_exported', data: { rows } });
    return { success: true };
}

const appealOutcomeSchema = z.object({
    outcome: z.enum(['upheld', 'reduced', 'reversed']),
    reply: z.string().trim().min(1).max(4000),
    note: z.string().trim().max(4000).optional(),
    reduceTo: z.object({ action: z.enum(['limit', 'suspension', 'hide']), days: z.number().int().min(1).max(60).nullable().optional() }).nullable().optional(),
}).strict();

/** Appeals tab (17.6): Upheld, Reduced or Reversed. */
export async function decideAppealAction(caseId: string, input: z.input<typeof appealOutcomeSchema>): Promise<Result> {
    const me = await staff();
    const parsed = appealOutcomeSchema.safeParse(input);
    if (!me || !uuid.safeParse(caseId).success) return DENIED;
    if (!parsed.success) return { success: false, error: 'Write the reply the person will read.' };
    const result = await decideAppeal(caseId, me.id, parsed.data.outcome, parsed.data.reply, parsed.data.note ?? '', parsed.data.reduceTo ?? null);
    refresh();
    return result.ok ? { success: true } : { success: false, error: result.error };
}

export async function claimAppealAction(caseId: string): Promise<Result> {
    const me = await staff();
    if (!me || !uuid.safeParse(caseId).success) return DENIED;
    const ok = await claimAppeal(caseId, me.id);
    refresh();
    return ok ? { success: true } : { success: false, error: 'This appeal was already decided.' };
}

/** Staff list (F17): admins add or remove staff. A role change applies at the person's next sign-in. */
export async function setStaffRoleAction(who: string, role: 'admin' | 'moderator' | null): Promise<Result | StepUpRequired> {
    const me = await staff();
    if (!me || me.role !== 'admin') return DENIED;
    // Granting or removing staff access needs the same fresh check as a ban (F16).
    const { supabase, user } = await getViewerAuthContext();
    const state = await stepUpState(supabase, user!);
    if (!state.fresh) return { success: false, error: 'Verify it’s you to change staff.', stepUp: { methods: state.methods, factorId: state.factorId } };
    const key = who.trim().replace(/^@/, '').toLowerCase();
    const [p] = await db.execute<{ id: string }>(sql`SELECT id FROM profiles WHERE (username = ${key} OR lower(email) = ${key} OR id::text = ${key}) AND deleted_at IS NULL LIMIT 1`);
    if (!p) return { success: false, error: 'No account with that @handle or email.' };
    if (p.id === me.id && role !== 'admin') return { success: false, error: 'You can’t remove your own admin role.' };
    await db.execute(sql`SELECT app_private.moderation_set_staff_role(${p.id}::uuid, ${role})`);
    await logModerationEvent(db, { caseId: null, actorId: me.id, kind: 'staff_role_changed', data: { userId: p.id, role } });
    refresh();
    return { success: true };
}

// The Inbox and the live layer (Trust & Safety Console Redesign R2, S1–S13).

const VIEWS = ['needs_me', 'unclaimed', 'urgent', 'appeals', 'org', 'escalated', 'mine', 'done'] as const;
const inboxSchema = z.object({
    view: z.enum(VIEWS).optional(),
    q: z.string().trim().max(100).optional(),
    severity: z.enum(['urgent', 'high', 'normal']).optional(),
    kind: z.string().max(40).regex(/^[a-z_]+$/).optional(),
    source: z.enum(['report', 'email', 'staff', 'legal']).optional(),
    sort: z.enum(['due', 'newest', 'reports']).optional(),
    due: z.enum(['overdue', 'hour']).optional(),
    org: z.string().uuid().optional(),
}).strict();
const cursorSchema = z.object({ at: z.string().max(80), id: z.string().max(80) }).nullable();

export async function inboxPageAction(filters: InboxFilters, cursor: { at: string; id: string } | null) {
    const me = await staff();
    const f = inboxSchema.safeParse(filters);
    const c = cursorSchema.safeParse(cursor);
    if (!me || !f.success || !c.success) return null;
    return readInbox(me.id, f.data as InboxFilters, c.data);
}

export async function inboxOrgsAction() {
    return (await staff()) ? inboxOrgs() : null;
}

export async function inboxCountsAction() {
    return (await staff()) ? inboxCounts() : null;
}

/** One case for the middle and right panes; opening it is logged once per 10 minutes (S13). */
export async function caseDetailAction(caseId: string) {
    const me = await staff();
    if (!me || !uuid.safeParse(caseId).success) return null;
    const [c, templates, appeal] = await Promise.all([readCase(caseId), ruleTemplates(), readAppeal(caseId)]);
    if (!c) return null;
    await logCaseView(caseId, me.id);
    return { ...c, appeal, templates, me: me.id, role: me.role };
}

export async function caseIdByLabelAction(label: string) {
    const number = parseCaseLabel(label);
    return (await staff()) && number ? caseIdByNumber(number) : null;
}

/** The live cursor (S1): what a screen missed, plus the server clock for countdowns (S4). */
export async function eventsSinceAction(seq: number | null) {
    if (!(await staff())) return null;
    const now = Date.now();
    if (seq == null || !Number.isFinite(seq) || seq < 0) return { events: [], more: false, seq: await latestSeq(), now };
    const r = await eventsSince(Math.floor(seq));
    return { ...r, seq: r.events.at(-1)?.seq ?? Math.floor(seq), now };
}

export async function assignCaseAction(caseId: string, to: string | null, reason: string, expectedVersion?: number | null): Promise<Result> {
    const me = await staff();
    if (!me || !uuid.safeParse(caseId).success || (to !== null && !uuid.safeParse(to).success)) return DENIED;
    if (to && !(await listStaff()).some((s) => s.id === to)) return { success: false, error: 'Pick someone on the trust & safety team.' };
    const r = await assignCase(caseId, me.id, to, String(reason ?? '').trim(), expectedVersion);
    return r.ok ? { success: true } : { success: false, error: r.error, code: 'code' in r ? r.code : undefined };
}

export async function escalateCaseAction(caseId: string, note: string, on: boolean, expectedVersion?: number | null): Promise<Result> {
    const me = await staff();
    if (!me || !uuid.safeParse(caseId).success) return DENIED;
    if (on && String(note ?? '').trim().length < 3) return { success: false, error: 'Say what an admin needs to decide.' };
    const r = await escalateCase(caseId, me.id, String(note ?? '').trim(), on === true, expectedVersion);
    return r.ok ? { success: true } : { success: false, error: r.error, code: 'code' in r ? r.code : undefined };
}

/** Decide together (S12): one decision across the person's selected open cases, one notice. */
export async function decideTogetherAction(primaryId: string, otherIds: string[], input: Decision): Promise<Result<{ done: number; failed: number }> | StepUpRequired> {
    const me = await staff();
    const parsed = decisionSchema.safeParse(input);
    const ids = [primaryId, ...(Array.isArray(otherIds) ? otherIds : [])];
    if (!me || !parsed.success || ids.length > 20 || ids.some((id) => !uuid.safeParse(id).success)) return DENIED;
    if (parsed.data.account?.action === 'ban' || parsed.data.content === 'remove_workspace') {
        const stepUp = await needsStepUp('Verify it’s you to send this decision.');
        if (stepUp) return stepUp;
    }
    const r = await decideTogether(primaryId, otherIds, { id: me.id, scope: 'staff', role: me.role }, parsed.data as Decision);
    return r.ok ? { success: true, done: r.done, failed: r.failed } : { success: false, error: r.error, code: r.code };
}

/** "Show 10 more" above a reported message (S9). */
export async function messageContextAction(caseId: string, beforeSeq: number) {
    const me = await staff();
    if (!me || !uuid.safeParse(caseId).success || !Number.isInteger(beforeSeq)) return null;
    const rows = await messageContext(caseId, beforeSeq);
    if (rows) await logModerationEvent(db, { caseId, actorId: me.id, kind: 'context_shown', data: { beforeSeq } });
    return rows;
}

/** A reported file, opened on purpose and logged (S9). */
export async function filePreviewAction(caseId: string): Promise<Result<{ url: string; mime: string | null; name: string }>> {
    const me = await staff();
    if (!me || !uuid.safeParse(caseId).success) return DENIED;
    const file = await filePreviewUrl(caseId);
    if (!file) return { success: false, error: 'The file is no longer available.' };
    await logModerationEvent(db, { caseId, actorId: me.id, kind: 'file_previewed' });
    return { success: true, ...file };
}

export async function staffListAction() {
    return (await staff()) ? (await listStaff()).map((s) => ({ id: s.id, name: s.name ?? s.email ?? 'Staff', role: s.role })) : null;
}

export async function ruleTemplatesAction() {
    return (await staff()) ? ruleTemplates() : null;
}

/** Admins edit the opening message for each rule (S13); an empty one goes back to the built-in sentence. */
export async function saveRuleTemplateAction(rule: number, message: string): Promise<Result> {
    const me = await staff();
    if (!me || me.role !== 'admin' || !Number.isInteger(rule) || rule < 1 || rule > 15 || typeof message !== 'string' || message.length > 2000) return DENIED;
    await saveRuleTemplate(rule, message, me.id);
    return { success: true };
}

/** A person's full history for the drawer (R1, R10), without leaving the case. */
export async function personDetailAction(handleOrId: string) {
    if (!(await staff()) || typeof handleOrId !== 'string' || handleOrId.length > 80) return null;
    return readPerson(handleOrId);
}

/** One verification request, shown in the Inbox as its own type (R2). */
export async function verificationDetailAction(orgId: string) {
    if (!(await staff()) || !uuid.safeParse(orgId).success) return null;
    return (await readVerification(orgId))[0] ?? null;
}
