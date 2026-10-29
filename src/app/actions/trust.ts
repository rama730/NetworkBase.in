'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db';
import { contentReports, projectDocs, projects, projectUpdateComments, projectUpdates, taskComments, tasks } from '@/lib/db/schema';
import { getProjectAccessById } from '@/lib/data/project-access';
import { logger } from '@/lib/logger';
import { notifyOrg, orgHref, orgLabel } from '@/lib/organizations/notify';
import { REPORT_REASONS, verificationDomain, type ReportTargetKind } from '@/lib/organizations/trust-rules';
import { isAdminUser } from '@/lib/security/admin';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { createClient } from '@/lib/supabase/server';

// Trust and safety (report §30.3): anyone signed in reports a project, org, post, doc or comment; platform admins
// review on /admin/reports (dismiss · hide from Discover · remove content · suspend org) and the Verified badge.

type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You don’t have permission to do this." };

/** Every URL in a project's links (stored as a map or a list). */
function linkUrls(links: unknown): string[] {
    if (Array.isArray(links)) return links.map((item) => (item as { url?: unknown })?.url).filter((url): url is string => typeof url === 'string');
    return links && typeof links === 'object' ? Object.values(links).filter((url): url is string => typeof url === 'string') : [];
}

async function signedInUser() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

async function platformAdmin() {
    const user = await signedInUser();
    return user && isAdminUser(user) ? user : null;
}

/** The project a reported thing belongs to, when it still exists. */
async function reportedProject(kind: ReportTargetKind, id: string): Promise<string | null> {
    const row = kind === 'project' ? { projectId: id }
        : kind === 'update' ? (await db.select({ projectId: projectUpdates.projectId }).from(projectUpdates).where(and(eq(projectUpdates.id, id), isNull(projectUpdates.deletedAt))).limit(1))[0]
        : kind === 'update_comment' ? (await db.select({ projectId: projectUpdates.projectId }).from(projectUpdateComments).innerJoin(projectUpdates, eq(projectUpdates.id, projectUpdateComments.updateId)).where(and(eq(projectUpdateComments.id, id), isNull(projectUpdateComments.deletedAt))).limit(1))[0]
        : kind === 'doc' ? (await db.select({ projectId: projectDocs.projectId }).from(projectDocs).where(eq(projectDocs.id, id)).limit(1))[0]
        : (await db.select({ projectId: tasks.projectId }).from(taskComments).innerJoin(tasks, eq(tasks.id, taskComments.taskId)).where(and(eq(taskComments.id, id), isNull(taskComments.deletedAt))).limit(1))[0];
    return row?.projectId ?? null;
}

const reportSchema = z.object({
    kind: z.enum(['project', 'update', 'update_comment', 'doc', 'task_comment']),
    targetId: z.string().uuid(),
    reason: z.enum(REPORT_REASONS),
    details: z.string().trim().max(2000).optional(),
}).strict();

/** Report what you can see. One open report per person per thing; the platform admins review it. */
export async function reportContentAction(input: z.input<typeof reportSchema>): Promise<{ success: true } | Failure> {
    const user = await signedInUser();
    if (!user) return { success: false, error: 'Sign in to report.' };
    const parsed = reportSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'Pick a reason.' };
    const rate = await consumeRateLimit(`report:create:${user.id}`, 20, 3600);
    if (!rate.allowed) return { success: false, error: 'Too many reports. Try again later.' };
    const projectId = await reportedProject(parsed.data.kind, parsed.data.targetId);
    if (!projectId || !(await getProjectAccessById(projectId, user.id)).canRead) return { success: false, error: 'That is no longer available.' };
    await db.insert(contentReports).values({
        reporterId: user.id, targetKind: parsed.data.kind, targetId: parsed.data.targetId, projectId,
        reason: parsed.data.reason, details: parsed.data.details || null,
    }).onConflictDoNothing();
    logger.info('trust.report.created', { module: 'trust', kind: parsed.data.kind });
    return { success: true };
}

async function resolve(reportId: string, adminId: string, status: 'dismissed' | 'actioned', action: 'hidden' | 'removed' | 'suspended' | null) {
    const [report] = await db.select().from(contentReports).where(eq(contentReports.id, reportId)).limit(1);
    if (!report) return null;
    // Every open report on the same thing closes with it.
    await db.update(contentReports).set({ status, action, resolvedBy: adminId, resolvedAt: new Date() })
        .where(and(eq(contentReports.targetKind, report.targetKind), eq(contentReports.targetId, report.targetId), eq(contentReports.status, 'open')));
    revalidatePath('/admin/reports');
    return report;
}

export async function dismissReportAction(reportId: string): Promise<{ success: true } | Failure> {
    const admin = await platformAdmin();
    if (!admin) return DENIED;
    return (await resolve(reportId, admin.id, 'dismissed', null)) ? { success: true } : { success: false, error: 'Report not found.' };
}

/** Hide from Discover and search; the page and its links keep working. */
export async function hideFromDiscoverAction(reportId: string): Promise<{ success: true } | Failure> {
    const admin = await platformAdmin();
    if (!admin) return DENIED;
    const report = await resolve(reportId, admin.id, 'actioned', 'hidden');
    if (!report?.projectId) return { success: false, error: 'Report not found.' };
    await db.update(projects).set({ discoverHiddenAt: new Date() }).where(eq(projects.id, report.projectId));
    return { success: true };
}

/** Remove a post, comment or doc. A project or org is hidden or suspended instead. */
export async function removeReportedContentAction(reportId: string): Promise<{ success: true } | Failure> {
    const admin = await platformAdmin();
    if (!admin) return DENIED;
    const [report] = await db.select().from(contentReports).where(eq(contentReports.id, reportId)).limit(1);
    if (!report) return { success: false, error: 'Report not found.' };
    if (report.targetKind === 'project') return { success: false, error: 'Hide it from Discover or suspend the organization instead.' };
    const now = new Date();
    let authorId: string | null = null;
    if (report.targetKind === 'update') {
        [{ authorId } = { authorId: null }] = await db.update(projectUpdates).set({ deletedAt: now }).where(eq(projectUpdates.id, report.targetId)).returning({ authorId: projectUpdates.authorId });
    } else if (report.targetKind === 'update_comment') {
        [{ authorId } = { authorId: null }] = await db.update(projectUpdateComments).set({ deletedAt: now }).where(eq(projectUpdateComments.id, report.targetId)).returning({ authorId: projectUpdateComments.userId });
    } else if (report.targetKind === 'task_comment') {
        [{ authorId } = { authorId: null }] = await db.update(taskComments).set({ deletedAt: now }).where(eq(taskComments.id, report.targetId)).returning({ authorId: taskComments.userId });
    } else {
        await db.delete(projectDocs).where(eq(projectDocs.id, report.targetId));
    }
    await resolve(reportId, admin.id, 'actioned', 'removed');
    // "Your post was removed: <reason>" to the author (report §26.3 E), in the tray.
    const org = report.projectId ? await orgLabel(report.projectId) : null;
    if (authorId && org && report.projectId) {
        await notifyOrg({ orgId: report.projectId, eventKey: 'org.lifecycle', to: [authorId], title: `Your post was removed: ${report.reason === 'other' ? 'it broke the rules' : report.reason}`, href: orgHref(org), sourceEventId: `removed-content:${report.id}` });
    }
    return { success: true };
}

const suspendSchema = z.object({ orgId: z.string().uuid(), reason: z.string().trim().min(3).max(1000), reportId: z.string().uuid().optional() }).strict();

/** Suspend: read-only for everyone, hidden, join codes and emails stop; the owner is told why (appeal via support@). */
export async function suspendOrgAction(input: z.input<typeof suspendSchema>): Promise<{ success: true } | Failure> {
    const admin = await platformAdmin();
    if (!admin) return DENIED;
    const parsed = suspendSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'Give the reason the owner will see.' };
    const updated = await db.update(projects).set({ suspendedAt: new Date(), suspendReason: parsed.data.reason, updatedAt: new Date() })
        .where(and(eq(projects.id, parsed.data.orgId), eq(projects.kind, 'organization'))).returning({ ownerId: projects.ownerId });
    if (!updated.length) return { success: false, error: 'Organization not found.' };
    if (parsed.data.reportId) await resolve(parsed.data.reportId, admin.id, 'actioned', 'suspended');
    const org = await orgLabel(parsed.data.orgId);
    if (org) {
        await notifyOrg({ orgId: org.id, eventKey: 'org.lifecycle', to: [updated[0]!.ownerId], title: `${org.title} was suspended: ${parsed.data.reason}`, body: 'To appeal, email support@networkbase.in.', href: orgHref(org), sourceEventId: `suspended:${org.id}:${Date.now()}` });
    }
    revalidatePath('/admin/reports');
    return { success: true };
}

export async function unsuspendOrgAction(orgId: string): Promise<{ success: true } | Failure> {
    const admin = await platformAdmin();
    if (!admin) return DENIED;
    await db.update(projects).set({ suspendedAt: null, suspendReason: null, updatedAt: new Date() }).where(eq(projects.id, orgId));
    const org = await orgLabel(orgId);
    if (org) {
        const [row] = await db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, orgId)).limit(1);
        await notifyOrg({ orgId, eventKey: 'org.lifecycle', to: [row!.ownerId], title: `${org.title} is no longer suspended`, href: orgHref(org), sourceEventId: `unsuspended:${orgId}:${Date.now()}` });
    }
    revalidatePath('/admin/reports');
    return { success: true };
}

/**
 * Settings → General "Request verification" (report §30.3): automatic when the owner's verified email domain
 * matches the org website; otherwise queued for platform admin review.
 */
export async function requestOrgVerificationAction(orgId: string): Promise<{ success: true; verified: boolean } | Failure> {
    const user = await signedInUser();
    if (!user) return DENIED;
    const access = await getProjectAccessById(orgId, user.id);
    if (access.project?.kind !== 'organization' || !access.isOwner) return DENIED;
    const [org] = await db.select({ links: projects.externalLinks, verifiedAt: projects.verifiedAt }).from(projects).where(eq(projects.id, orgId)).limit(1);
    if (org?.verifiedAt) return { success: true, verified: true };
    const websites = linkUrls(org?.links);
    const domain = user.email_confirmed_at ? verificationDomain(user.email, websites) : null;
    await db.update(projects).set(domain
        ? { verifiedAt: new Date(), verificationDomain: domain, verificationRequestedAt: null }
        : { verificationRequestedAt: new Date() }).where(eq(projects.id, orgId));
    revalidatePath(`/org/${access.project.slug ?? orgId}`);
    return { success: true, verified: Boolean(domain) };
}

export async function decideOrgVerificationAction(orgId: string, approve: boolean): Promise<{ success: true } | Failure> {
    const admin = await platformAdmin();
    if (!admin) return DENIED;
    await db.update(projects).set(approve ? { verifiedAt: new Date(), verificationRequestedAt: null } : { verificationRequestedAt: null })
        .where(and(eq(projects.id, orgId), eq(projects.kind, 'organization')));
    const org = await orgLabel(orgId);
    const [row] = await db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, orgId)).limit(1);
    if (org && row) {
        await notifyOrg({ orgId, eventKey: 'org.lifecycle', to: [row.ownerId], title: approve ? `${org.title} is verified` : `${org.title} wasn’t verified this time`, href: orgHref(org, '?tab=settings'), sourceEventId: `verification:${orgId}:${Date.now()}` });
    }
    revalidatePath('/admin/reports');
    return { success: true };
}

/** For the admin page: open reports with a readable target line. */
export async function readAdminReportsAction() {
    const admin = await platformAdmin();
    if (!admin) return null;
    const reports = await db.execute<{ id: string; target_kind: ReportTargetKind; target_id: string; reason: string; details: string | null; created_at: string; project_id: string | null; project_title: string | null; project_slug: string | null; project_kind: string | null; suspended: boolean; excerpt: string | null; reports: number }>(sql`
        SELECT DISTINCT ON (r.target_kind, r.target_id) r.id, r.target_kind, r.target_id, r.reason, r.details, r.created_at, r.project_id,
          p.title AS project_title, p.slug AS project_slug, p.kind AS project_kind, (p.suspended_at IS NOT NULL) AS suspended,
          CASE r.target_kind
            WHEN 'update' THEN (SELECT left(u.content, 200) FROM project_updates u WHERE u.id = r.target_id)
            WHEN 'update_comment' THEN (SELECT left(c.content, 200) FROM project_update_comments c WHERE c.id = r.target_id)
            WHEN 'task_comment' THEN (SELECT left(c.content, 200) FROM task_comments c WHERE c.id = r.target_id)
            WHEN 'doc' THEN (SELECT d.slug FROM project_docs d WHERE d.id = r.target_id)
          END AS excerpt,
          (SELECT count(*)::int FROM content_reports o WHERE o.target_kind = r.target_kind AND o.target_id = r.target_id AND o.status = 'open') AS reports
        FROM content_reports r LEFT JOIN projects p ON p.id = r.project_id
        WHERE r.status = 'open' ORDER BY r.target_kind, r.target_id, r.created_at DESC LIMIT 200`);
    const verification = await db.select({ id: projects.id, title: projects.title, slug: projects.slug, links: projects.externalLinks, requestedAt: projects.verificationRequestedAt })
        .from(projects).where(and(eq(projects.kind, 'organization'), sql`${projects.verificationRequestedAt} IS NOT NULL`, isNull(projects.verifiedAt), isNull(projects.deletedAt)));
    const suspended = await db.select({ id: projects.id, title: projects.title, slug: projects.slug, reason: projects.suspendReason, at: projects.suspendedAt })
        .from(projects).where(and(eq(projects.kind, 'organization'), sql`${projects.suspendedAt} IS NOT NULL`, isNull(projects.deletedAt)));
    return {
        reports: [...reports].sort((a, b) => b.created_at.localeCompare(a.created_at)),
        verification: verification.map((v) => ({ ...v, websites: linkUrls(v.links), requestedAt: v.requestedAt?.toISOString() ?? null, links: undefined })),
        suspended: suspended.map((s) => ({ ...s, at: s.at?.toISOString() ?? null })),
    };
}
