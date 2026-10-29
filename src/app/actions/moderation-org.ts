'use server';

import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { getWorkspaceAccessById } from '@/lib/data/workspace-access';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { readOrgCases } from '@/lib/trust/console';
import { decideCase, type Decision } from '@/lib/trust/decide';
import { REASON_RULES, type ReportReason } from '@/lib/trust/rules';

// Org moderators (docs/trust-and-safety-concept.md §7.4, §11.6): an org's owners and admins decide its own
// non-urgent cases: dismiss, hide, remove or warn. No account limits and no NetworkBase strikes.

type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: 'You don’t have permission to do this.' };

async function orgModerator(orgId: string) {
    const { userId } = await getViewerAuthContext();
    if (!userId) return null;
    const access = await getWorkspaceAccessById(orgId, userId);
    if (access.project?.kind !== 'organization' || !(access.isOwner || access.memberRole === 'admin')) return null;
    return { userId, slug: access.project.slug ?? orgId };
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
