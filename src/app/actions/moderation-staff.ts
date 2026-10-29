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
import { claimAppeal, decideAppeal } from '@/lib/trust/appeals';
import { logModerationEvent } from '@/lib/trust/cases';
import { addNote, caseIdByNumber, changeSeverity, consoleCounts, mergeCase, openManualCase, readCase, setClaim, setLegalHold } from '@/lib/trust/console';
import { decideCase, noticeRestrictionEnded, reverseAction, undoDecision, type Decision } from '@/lib/trust/decide';
import { decisionNotice } from '@/lib/trust/messages';
import { notifySafety } from '@/lib/trust/notify';
import { caseLabel, parseCaseLabel, REPORT_REASONS, type ModerationActionKind, type ReportReason, type ReportTargetKind } from '@/lib/trust/rules';
import { staffRoleOf, type StaffRole } from '@/lib/trust/staff';

// The staff console's writes (docs/trust-and-safety-concept.md §17). Every action checks the staff role again.

type Result<T = object> = ({ success: true } & T) | { success: false; error: string };
const DENIED = { success: false as const, error: 'You don’t have permission to do this.' };
const uuid = z.string().uuid();

async function staff(): Promise<{ id: string; role: StaffRole } | null> {
    const { user } = await getViewerAuthContext();
    const role = staffRoleOf(user);
    return user && role ? { id: user.id, role } : null;
}
const refresh = () => revalidatePath('/admin/trust', 'layout');

/** The avatar menu's "Trust & safety" entry: null for everyone but staff (C1). */
export async function staffBadgeAction(): Promise<{ count: number } | null> {
    if (!(await staff())) return null;
    const c = await consoleCounts();
    return { count: c.urgent + c.overdue };
}

const ACTIONS = ['hide', 'remove', 'reset_profile', 'hold_handle', 'remove_verified', 'hide_discover', 'restrict', 'suspend_workspace', 'remove_workspace'] as const satisfies readonly ModerationActionKind[];
const decisionSchema = z.object({
    outcome: z.enum(['no_violation', 'actioned']),
    content: z.enum(ACTIONS).nullable().optional(),
    account: z.object({ action: z.enum(['warning', 'limit', 'suspension', 'ban']), days: z.number().int().min(1).max(60).nullable().optional() }).nullable().optional(),
    rule: z.number().int().min(1).max(15).nullable().optional(),
    message: z.string().trim().max(2000).nullable().optional(),
    note: z.string().trim().max(4000).nullable().optional(),
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
    if (!result.ok) return { success: false, error: result.error };
    const c = await readCase(caseId);
    refresh();
    return { success: true, label: c ? caseLabel(c.number) : '' };
}

export async function undoDecisionAction(caseId: string): Promise<Result> {
    const me = await staff();
    if (!me || !uuid.safeParse(caseId).success) return DENIED;
    const result = await undoDecision(caseId, me.id);
    refresh();
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

export async function claimCaseAction(caseId: string, mode: 'claim' | 'release' | 'take_over'): Promise<Result> {
    const me = await staff();
    if (!me || !uuid.safeParse(caseId).success) return DENIED;
    const ok = await setClaim(caseId, me.id, mode);
    refresh();
    return ok ? { success: true } : { success: false, error: mode === 'claim' ? 'Someone else claimed it first.' : 'The case changed. Refresh and try again.' };
}

export async function addNoteAction(caseId: string, body: string): Promise<Result> {
    const me = await staff();
    const text = body.trim();
    if (!me || !uuid.safeParse(caseId).success) return DENIED;
    if (!text) return { success: false, error: 'Write the note first.' };
    await addNote(caseId, me.id, text);
    refresh();
    return { success: true };
}

export async function legalHoldAction(caseId: string, hold: boolean): Promise<Result> {
    const me = await staff();
    if (!me || !uuid.safeParse(caseId).success) return DENIED;
    await setLegalHold(caseId, me.id, hold);
    refresh();
    return { success: true };
}

export async function changeSeverityAction(caseId: string, severity: 'urgent' | 'high' | 'normal', reason: string): Promise<Result> {
    const me = await staff();
    if (!me || !uuid.safeParse(caseId).success || !['urgent', 'high', 'normal'].includes(severity)) return DENIED;
    if (reason.trim().length < 3) return { success: false, error: 'Say why the severity changed.' };
    const ok = await changeSeverity(caseId, me.id, severity, reason.trim());
    refresh();
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
    refresh();
    return ok ? { success: true } : { success: false, error: 'Only open cases can be merged.' };
}

/** Bulk "No rule broken" or a shared content action on several selected cases. */
export async function bulkDecideAction(caseIds: string[], input: Decision): Promise<Result<{ done: number; failed: number }>> {
    const me = await staff();
    const parsed = decisionSchema.safeParse(input);
    if (!me || !parsed.success || !caseIds.length || caseIds.length > 50 || caseIds.some((id) => !uuid.safeParse(id).success)) return DENIED;
    let done = 0;
    for (const id of caseIds) if ((await decideCase(id, { id: me.id, scope: 'staff', role: me.role }, parsed.data as Decision)).ok) done += 1;
    refresh();
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

export async function auditExportedAction(rows: number): Promise<Result> {
    const me = await staff();
    if (!me) return DENIED;
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
export async function setStaffRoleAction(who: string, role: 'admin' | 'moderator' | null): Promise<Result> {
    const me = await staff();
    if (!me || me.role !== 'admin') return DENIED;
    const key = who.trim().replace(/^@/, '').toLowerCase();
    const [p] = await db.execute<{ id: string }>(sql`SELECT id FROM profiles WHERE (username = ${key} OR lower(email) = ${key} OR id::text = ${key}) AND deleted_at IS NULL LIMIT 1`);
    if (!p) return { success: false, error: 'No account with that @handle or email.' };
    if (p.id === me.id && role !== 'admin') return { success: false, error: 'You can’t remove your own admin role.' };
    await db.execute(sql`SELECT app_private.moderation_set_staff_role(${p.id}::uuid, ${role})`);
    await logModerationEvent(db, { caseId: null, actorId: me.id, kind: 'staff_role_changed', data: { userId: p.id, role } });
    refresh();
    return { success: true };
}
