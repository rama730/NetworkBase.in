'use server';

import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { getWorkspaceAccessById } from '@/lib/data/workspace-access';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { readOrgCases } from '@/lib/trust/console';
import { decideCase, type Decision } from '@/lib/trust/decide';
import { caseLabel, ruleLabel, REASON_RULES, type ReportReason } from '@/lib/trust/rules';
import { orgGrant, type OrgAction } from '@/lib/organizations/permissions';
import { UUID_RE } from '@/lib/validations/uuid';

// Org moderators (docs/trust-and-safety-concept.md §7.4, §11.6): an org's owners and admins decide its own
// non-urgent cases: dismiss, hide, remove or warn. No account limits and no NetworkBase strikes.

type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: 'You don’t have permission to do this.' };

/** An owner or admin, per the permissions table (report §21.3, §29.2). */
async function orgModerator(orgId: string, action: OrgAction = 'handle_reports') {
    const { userId } = await getViewerAuthContext();
    if (!userId || !UUID_RE.test(orgId)) return null;
    const access = await getWorkspaceAccessById(orgId, userId);
    const role = access.isOwner ? 'owner' as const : access.memberRole === 'admin' ? 'admin' as const : null;
    if (access.project?.kind !== 'organization' || !role || orgGrant(role, action) !== 'yes') return null;
    return { userId, role, slug: access.project.slug ?? orgId };
}

export async function readOrgReportsAction(orgId: string) {
    const me = await orgModerator(orgId);
    if (!me) return DENIED;
    return { success: true as const, cases: await readOrgCases(orgId, me.userId) };
}

export async function decideOrgReportAction(orgId: string, caseId: string, choice: 'dismiss' | 'hide' | 'remove' | 'warn', message?: string): Promise<{ success: true } | Failure> {
    const me = await orgModerator(orgId);
    if (!me) return DENIED;
    const [c] = await db.execute<{ reason: ReportReason; subject_id: string | null }>(sql`SELECT reason, subject_id FROM moderation_cases WHERE id = ${caseId} AND org_id = ${orgId}`);
    if (!c || c.subject_id === me.userId) return DENIED;
    const decision: Decision = choice === 'dismiss'
        ? { outcome: 'no_violation' }
        : { outcome: 'actioned', content: choice === 'warn' ? null : choice, account: choice === 'warn' ? { action: 'warning' } : null, rule: REASON_RULES[c.reason].rule, message: message?.trim().slice(0, 2000) || null };
    const result = await decideCase(caseId, { id: me.userId, scope: 'org', orgId }, decision);
    revalidatePath(`/org/${me.slug}`);
    return result.ok ? { success: true } : { success: false, error: result.error };
}

export type OrgStanding = { action: string; reason: string | null; caseLabel: string | null; appealSent: boolean; canAppeal: boolean } | null;

/**
 * Settings → Moderation → Standing (report §29.2): "In good standing" (null), or what NetworkBase did, why, and for
 * the owner only, Appeal. Admins see the state and reason.
 */
export async function readOrgStandingAction(orgId: string): Promise<{ success: true; standing: OrgStanding } | Failure> {
    const me = await orgModerator(orgId, 'see_standing');
    if (!me) return DENIED;
    const [row] = await db.execute<{ action: string; rule: number | null; case_number: number | null; appeal_state: string | null; appeal_until: string | null }>(sql`
        SELECT a.action, a.rule, c.number::int AS case_number, ap.state AS appeal_state, a.appeal_until::text
        FROM moderation_actions a LEFT JOIN moderation_cases c ON c.id = a.case_id LEFT JOIN moderation_appeals ap ON ap.case_id = a.case_id
        WHERE a.target_id = ${orgId} AND a.action IN ('restrict', 'suspend_workspace', 'remove_workspace', 'hide_discover', 'remove_verified')
          AND a.lifted_at IS NULL AND a.undone_at IS NULL AND a.reversed_at IS NULL
        ORDER BY a.created_at DESC LIMIT 1`);
    if (!row) return { success: true, standing: null };
    const label = row.case_number ? caseLabel(row.case_number) : null;
    const open = !row.appeal_state && (!row.appeal_until || new Date(row.appeal_until) > new Date());
    return { success: true, standing: {
        action: row.action, reason: row.rule !== null ? ruleLabel(Number(row.rule)) : null, caseLabel: label,
        appealSent: row.appeal_state === 'pending' || row.appeal_state === 'in_review',
        canAppeal: Boolean(label && open && orgGrant(me.role, 'appeal') === 'yes'),
    } };
}

/** Settings → Moderation → Blocked people (report §29.3): who's blocked from rejoining, by whom and when. */
export async function readOrgJoinBlocksAction(orgId: string): Promise<{ success: true; people: Array<{ userId: string; name: string; blockedBy: string | null; at: string }> } | Failure> {
    const me = await orgModerator(orgId, 'invite_back_unblock');
    if (!me) return DENIED;
    const rows = await db.execute<{ user_id: string; name: string; blocked_by: string | null; at: string }>(sql`
        SELECT b.user_id, coalesce(p.full_name, p.username, 'Someone') AS name, coalesce(bp.full_name, bp.username) AS blocked_by, b.created_at::text AS at
        FROM org_join_blocks b LEFT JOIN profiles p ON p.id = b.user_id LEFT JOIN profiles bp ON bp.id = b.blocked_by
        WHERE b.org_id = ${orgId} ORDER BY b.created_at DESC LIMIT 500`);
    return { success: true, people: rows.map((r) => ({ userId: r.user_id, name: r.name, blockedBy: r.blocked_by, at: r.at })) };
}

/** Unblock (report §29.3): after a confirmation on the screen; the person isn't told, and can join again. */
export async function unblockFromOrgAction(orgId: string, userId: string): Promise<{ success: true } | Failure> {
    const me = await orgModerator(orgId, 'invite_back_unblock');
    if (!me || !UUID_RE.test(userId)) return DENIED;
    await db.execute(sql`DELETE FROM org_join_blocks WHERE org_id = ${orgId} AND user_id = ${userId}`);
    revalidatePath(`/org/${me.slug}`);
    return { success: true };
}
