'use server';

import { headers } from 'next/headers';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db';
import { getWorkspaceAccessById } from '@/lib/data/workspace-access';
import { logger } from '@/lib/logger';
import { setUserBlocked } from '@/lib/privacy/blocks';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { fileAppeal, withdrawAppeal } from '@/lib/trust/appeals';
import { fileReport, listMyReports, openReportsOf } from '@/lib/trust/cases';
import { caseLabel, parseCaseLabel, REPORT_REASONS, type ReportTargetKind } from '@/lib/trust/rules';
import { moderatedInChannel, moderatedInWorkspace, type ModeratedItem } from '@/lib/trust/placeholders';
import { readStanding } from '@/lib/trust/standing';
import { resolveReportTarget } from '@/lib/trust/targets';

// Reporting (docs/trust-and-safety-concept.md §5, C17): anyone signed in reports what they can see. Staff work in
// actions/moderation-staff.ts.

type Failure = { success: false; error: string; caseNumber?: number };

const KINDS = ['project', 'person', 'update', 'update_comment', 'doc', 'task', 'task_comment', 'file', 'chat_message', 'chat_channel',
    'role', 'application', 'invitation', 'connection_request', 'contribution'] as const satisfies readonly ReportTargetKind[];

const reportSchema = z.object({
    kind: z.enum(KINDS),
    targetId: z.string().uuid(),
    seq: z.number().int().positive().nullable().optional(),
    reason: z.enum(REPORT_REASONS as [string, ...string[]]),
    details: z.string().trim().max(2000).optional(),
    alsoBlock: z.boolean().optional(),
    joinCode: z.string().trim().max(32).optional(),
}).strict();

/** Report what you can see. One open report per person per thing; it joins or opens a case (T1–T5). */
export async function reportAction(input: z.input<typeof reportSchema>): Promise<{ success: true; caseNumber: string; deadlineHours: number; blocked: boolean } | Failure> {
    const { userId } = await getViewerAuthContext();
    if (!userId) return { success: false, error: 'Sign in to report.' };
    const parsed = reportSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'Pick a reason.' };
    const rate = await consumeRateLimit(`report:create:${userId}`, 20, 3600);
    if (!rate.allowed) return { success: false, error: 'Too many reports. Try again later.' };
    const data = parsed.data as z.infer<typeof reportSchema> & { reason: (typeof REPORT_REASONS)[number] };
    const result = await fileReport(userId, { kind: data.kind, targetId: data.targetId, seq: data.seq ?? null, reason: data.reason, details: data.details, alsoBlock: data.alsoBlock, joinCode: data.joinCode });
    if (!result.ok) return { success: false, error: result.error, caseNumber: result.caseNumber };
    logger.info('trust.report.created', { module: 'trust', kind: data.kind, severity: result.severity });

    // "Also block" (T3): only people and their messages, and never yourself.
    let blocked = false;
    if (data.alsoBlock && (data.kind === 'person' || data.kind === 'chat_message')) {
        const target = await resolveReportTarget(data.kind, data.targetId, data.seq ?? null, null);
        if (target?.subjectId && target.subjectId !== userId) {
            try {
                const h = await headers();
                await setUserBlocked({ blockerId: userId, targetUserId: target.subjectId, blocked: true, request: new Request('https://networkbase.in/report', { headers: new Headers(h) }) });
                blocked = true;
            } catch (error) {
                logger.warn('trust.report.block_failed', { module: 'trust', error: error instanceof Error ? error.message : String(error) });
            }
        }
    }
    return { success: true, caseNumber: caseLabel(result.caseNumber), deadlineHours: result.deadlineHours, blocked };
}

/** Settings → Privacy → Your reports (C18). */
export async function listMyReportsAction() {
    const { userId } = await getViewerAuthContext();
    if (!userId) return { success: false as const, error: 'Sign in to see your reports.' };
    const rows = await listMyReports(userId);
    return { success: true as const, reports: rows.map((r) => ({ ...r, caseNumber: caseLabel(r.caseNumber) })) };
}

/** Settings → Account → Standing (C18). */
export async function myStandingAction() {
    const { userId } = await getViewerAuthContext();
    if (!userId) return { success: false as const, error: 'Sign in to see your account standing.' };
    return { success: true as const, ...(await readStanding(userId)) };
}

const appealSchema = z.object({ caseNumber: z.string().max(20), body: z.string().max(1000), fixed: z.boolean().optional() }).strict();

/** One appeal per decision (§10.3). */
export async function appealAction(input: z.input<typeof appealSchema>): Promise<{ success: true; decideBy: string } | Failure> {
    const { userId } = await getViewerAuthContext();
    if (!userId) return { success: false, error: 'Sign in to appeal.' };
    const parsed = appealSchema.safeParse(input);
    const number = parsed.success ? parseCaseLabel(parsed.data.caseNumber) : null;
    if (!parsed.success || !number) return { success: false, error: 'Tell us why, in up to 1,000 characters.' };
    const rate = await consumeRateLimit(`appeal:create:${userId}`, 10, 3600);
    if (!rate.allowed) return { success: false, error: 'Too many attempts. Try again later.' };
    const result = await fileAppeal(userId, number, parsed.data.body, Boolean(parsed.data.fixed));
    return result.ok ? { success: true, decideBy: result.decideBy.toISOString() } : { success: false, error: result.error };
}

export async function withdrawAppealAction(caseNumber: string): Promise<{ success: true } | Failure> {
    const { userId } = await getViewerAuthContext();
    const number = parseCaseLabel(caseNumber);
    if (!userId || !number) return { success: false, error: 'Appeal not found.' };
    const result = await withdrawAppeal(userId, number);
    return result.ok ? { success: true } : { success: false, error: result.error };
}

/** What you've reported that's still in review, as "kind:id:seq" keys with the case number (C16). */
export async function myOpenReportsAction(): Promise<Record<string, string>> {
    const { userId } = await getViewerAuthContext();
    if (!userId) return {};
    return Object.fromEntries((await openReportsOf(userId)).map((r) => [`${r.kind}:${r.targetId}:${r.seq ?? 0}`, caseLabel(r.caseNumber)]));
}

/** Hidden and removed content to show in place (§7.1): one workspace's posts and comments, or one conversation. */
export async function moderatedItemsAction(scope: { workspaceId: string } | { channelId: string }): Promise<ModeratedItem[]> {
    const { userId } = await getViewerAuthContext();
    if (!userId) return [];
    if ('workspaceId' in scope) {
        if (!z.string().uuid().safeParse(scope.workspaceId).success || !(await getWorkspaceAccessById(scope.workspaceId, userId)).canRead) return [];
        return moderatedInWorkspace(scope.workspaceId, userId);
    }
    if (!z.string().uuid().safeParse(scope.channelId).success) return [];
    const [member] = await db.execute<{ ok: boolean }>(sql`SELECT app_private.chat_is_member(${scope.channelId}::uuid, ${userId}::uuid) AS ok`);
    return member?.ok ? moderatedInChannel(scope.channelId, userId) : [];
}
