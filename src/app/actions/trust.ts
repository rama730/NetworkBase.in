'use server';

import { randomInt, timingSafeEqual } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { and, eq, ilike, isNull, ne, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { orgVerificationCodes, workspaces } from '@/lib/db/schema';
import { getWorkspaceAccessById } from '@/lib/data/workspace-access';
import { codeSendWindow, linkUrls, maskEmail, verificationDomain, verificationEmailDomain, VERIFY_CODE_MINUTES, VERIFY_CODE_TRIES } from '@/lib/organizations/trust-rules';
import { orgGrant, type OrgRole } from '@/lib/organizations/permissions';
import { readViewerOrgRole } from '@/lib/organizations/detail';
import { findCodeInDns, findCodeOnGithub, findCodeOnWebsite, hashVerifyCode, markVerified, proofCode, VERIFICATION_DOCUMENTS_BUCKET, type VerificationRequest } from '@/lib/organizations/verification-ways';
import { notifyOrg, orgEmailBase, orgHref, orgLabel } from '@/lib/organizations/notify';
import { queueEmails, wakeEmailWorker } from '@/lib/email/outbox';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/validations/uuid';

// The Verified badge (report §30.3; 2026-11-05-org-address-discovery-verification-findings.md §5, §7): four ways in.
// Reports go through actions/moderation.ts; staff review in actions/moderation-staff.ts.

type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You don’t have permission to do this." };

async function signedInUser() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

/** The owner asks for the badge (the permissions table, report §21.3). */
async function ownerOf(orgId: string) {
    if (!isUuid(orgId)) return null;
    const user = await signedInUser();
    if (!user) return null;
    const access = await getWorkspaceAccessById(orgId, user.id);
    const role: OrgRole = access.isOwner ? 'owner' : access.memberRole === 'admin' ? 'admin' : 'member';
    if (access.project?.kind !== 'organization' || orgGrant(role, 'request_verified') !== 'yes') return null;
    const [org] = await db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, links: workspaces.externalLinks, verifiedAt: workspaces.verifiedAt, settings: workspaces.orgSettings, status: workspaces.status, suspendedAt: workspaces.suspendedAt })
        .from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
    if (!org || org.status === 'archived' || org.suspendedAt) return null;
    return { user, org };
}

const done = (slug: string | null, orgId: string) => revalidatePath(`/org/${slug ?? orgId}`);
const pending = (settings: unknown) => (settings as { verificationRequest?: VerificationRequest } | null)?.verificationRequest ?? null;

/**
 * Way 4, Ask our team (always open, no website needed): who you are and how to check, optional links and one
 * document. Still verified at once when the owner's email domain matches a website in Links (the original rule).
 */
export async function requestOrgVerificationAction(orgId: string, form: FormData): Promise<{ success: true; verified: boolean } | Failure> {
    const owner = await ownerOf(orgId);
    if (!owner) return DENIED;
    const { user, org } = owner;
    if (org.verifiedAt) return { success: true, verified: true };
    const domain = user.email_confirmed_at ? verificationDomain(user.email, linkUrls(org.links)) : null;
    if (domain) {
        await markVerified(orgId, 'owner_email', domain, { domain });
        done(org.slug, orgId);
        return { success: true, verified: true };
    }
    const explanation = String(form.get('explanation') ?? '').trim();
    if (explanation.length < 20) return { success: false, error: 'Tell us who you are and how we can check it, in a sentence or two.' };
    if (explanation.length > 2000) return { success: false, error: 'Keep it under 2,000 characters.' };
    const links = String(form.get('links') ?? '').split(/\s+/).map((l) => l.trim()).filter(Boolean).slice(0, 5);
    if (links.some((l) => !/^https?:\/\/[^\s]+\.[^\s]+/i.test(l))) return { success: false, error: 'Links start with https:// — one per line.' };
    let document: VerificationRequest['document'] = null;
    const file = form.get('document');
    if (file instanceof File && file.size > 0) {
        // ponytail: the file rides in the action's 4 MB body; a signed upload if documents ever need to be bigger.
        if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return { success: false, error: 'Attach a PDF, JPG, PNG or WebP.' };
        if (file.size > 3.5 * 1024 * 1024) return { success: false, error: 'The document is too large. Up to 3.5 MB.' };
        const key = `${orgId}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, '_').slice(-80)}`;
        const admin = await createAdminClient();
        const { error } = await admin.storage.from(VERIFICATION_DOCUMENTS_BUCKET).upload(key, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
        if (error) return { success: false, error: 'Couldn’t attach the document. Try again.' };
        document = { key, name: file.name.slice(0, 200), size: file.size, type: file.type };
    }
    const request: VerificationRequest = { method: 'team', at: new Date().toISOString(), explanation, links, document };
    // Asking again clears a past decline or removal (report §27.9).
    await db.update(workspaces).set({
        verificationRequestedAt: new Date(),
        orgSettings: sql`(coalesce(${workspaces.orgSettings}, '{}'::jsonb) - 'verification') || jsonb_build_object('verificationRequest', ${JSON.stringify(request)}::jsonb)`,
    }).where(eq(workspaces.id, orgId));
    await db.update(orgVerificationCodes).set({ expiresAt: new Date() }).where(eq(orgVerificationCodes.orgId, orgId));
    done(org.slug, orgId);
    return { success: true, verified: false };
}

/** "Try another way": drops a pending code, parent ask or team request, so the owner can pick again. */
export async function cancelOrgVerificationAction(orgId: string): Promise<{ success: true } | Failure> {
    const owner = await ownerOf(orgId);
    if (!owner) return DENIED;
    // Ends a code without forgetting its sends, so "another way" can't reset the 3-an-hour limit.
    await db.update(orgVerificationCodes).set({ expiresAt: new Date() }).where(eq(orgVerificationCodes.orgId, orgId));
    await db.update(workspaces).set({ verificationRequestedAt: null, orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) - 'verification' - 'verificationRequest'` })
        .where(and(eq(workspaces.id, orgId), isNull(workspaces.verifiedAt)));
    done(owner.org.slug, orgId);
    return { success: true };
}

/** Way 1: a 6-digit code to an address on the organization's domain. 10 minutes, 5 tries, 3 sends an hour. */
export async function requestOrgEmailCodeAction(orgId: string, email: string): Promise<{ success: true; masked: string; waitSeconds: number } | Failure> {
    const owner = await ownerOf(orgId);
    if (!owner) return DENIED;
    if (owner.org.verifiedAt) return { success: false, error: 'This organization is already verified.' };
    const parsed = verificationEmailDomain(email);
    if ('error' in parsed) return { success: false, error: parsed.error };
    const address = email.trim().toLowerCase();
    const [current] = await db.select({ sends: orgVerificationCodes.sends }).from(orgVerificationCodes).where(eq(orgVerificationCodes.orgId, orgId)).limit(1);
    const now = new Date();
    const window = codeSendWindow(current?.sends ?? [], now);
    if (!window.allowed) {
        return { success: false, error: window.waitSeconds ? `Wait ${window.waitSeconds} seconds before sending another code.` : 'You’ve sent 3 codes this hour. Try again later, or choose another way.' };
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const row = { userId: owner.user.id, email: address, codeHash: hashVerifyCode(orgId, code), expiresAt: new Date(now.getTime() + VERIFY_CODE_MINUTES * 60_000), attempts: 0, sends: [...window.recent, now] };
    await db.insert(orgVerificationCodes).values({ orgId, ...row }).onConflictDoUpdate({ target: orgVerificationCodes.orgId, set: row });
    const base = await orgEmailBase(orgId);
    if (base) {
        await queueEmails(db, [{ kind: 'org_verify_code', eventId: `verify-code:${orgId}:${now.getTime()}`, toEmail: address, projectId: orgId, data: { ...base, code } }]);
        await wakeEmailWorker();
    }
    return { success: true, masked: maskEmail(address), waitSeconds: 45 };
}

/** Way 1, step 2: the code from the email. Five tries, then a new code is needed. */
export async function confirmOrgEmailCodeAction(orgId: string, code: string): Promise<{ success: true } | Failure> {
    const owner = await ownerOf(orgId);
    if (!owner) return DENIED;
    const [row] = await db.select().from(orgVerificationCodes).where(eq(orgVerificationCodes.orgId, orgId)).limit(1);
    if (!row) return { success: false, error: 'Send a code first.' };
    if (row.expiresAt.getTime() < Date.now()) return { success: false, error: 'That code has expired. Send a new one.' };
    if (row.attempts >= VERIFY_CODE_TRIES) return { success: false, error: 'Too many tries. Send a new code.' };
    const given = Buffer.from(hashVerifyCode(orgId, code.replace(/\s+/g, '')));
    if (!/^\d{6}$/.test(code.replace(/\s+/g, '')) || !timingSafeEqual(given, Buffer.from(row.codeHash))) {
        await db.update(orgVerificationCodes).set({ attempts: row.attempts + 1 }).where(eq(orgVerificationCodes.orgId, orgId));
        const left = VERIFY_CODE_TRIES - row.attempts - 1;
        return { success: false, error: left > 0 ? `That code isn’t right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many tries. Send a new code.' };
    }
    const domain = row.email.split('@')[1]!;
    await markVerified(orgId, 'email', domain, { by: owner.user.id });
    await db.delete(orgVerificationCodes).where(eq(orgVerificationCodes.orgId, orgId));
    done(owner.org.slug, orgId);
    return { success: true };
}

/** Way 3: looks for the organization's code on its website, its GitHub description or a DNS TXT record. */
export async function checkOrgProofAction(orgId: string, where: 'website' | 'github' | 'dns'): Promise<{ success: true } | Failure> {
    const owner = await ownerOf(orgId);
    if (!owner) return DENIED;
    const { org } = owner;
    const code = proofCode(orgId);
    const found = where === 'website' ? await findCodeOnWebsite(org.links, code) : where === 'github' ? await findCodeOnGithub(org.links, code) : await findCodeInDns(org.links, code);
    if (!found) {
        const missing = where === 'github' ? 'Add your GitHub organization in Links first, then put the code in its description.'
            : linkUrls(org.links).length === 0 ? 'Add your website in Links first.'
                : where === 'website' ? 'We didn’t find the code on your website’s home page yet. It can take a few minutes after you publish.'
                    : 'We didn’t find a TXT record with the code yet. DNS changes can take up to an hour.';
        return { success: false, error: missing };
    }
    await markVerified(orgId, where, found, { domain: where === 'website' ? found : null, by: owner.user.id });
    await db.delete(orgVerificationCodes).where(eq(orgVerificationCodes.orgId, orgId));
    done(org.slug, orgId);
    return { success: true };
}

/**
 * "Part of": public organizations on NetworkBase to link, by name (G8), verified first. Used in Settings and while
 * creating one (no organization yet, so `orgId` is null); only public organizations are listed.
 */
export async function searchParentOrgsAction(orgId: string | null, q: string): Promise<Array<{ id: string; title: string; slug: string | null; verified: boolean }>> {
    const user = await signedInUser();
    const needle = q.trim().slice(0, 100);
    if (!user || (orgId !== null && !isUuid(orgId)) || needle.length < 2) return [];
    const rows = await db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, verified: sql<boolean>`${workspaces.verifiedAt} IS NOT NULL` })
        .from(workspaces)
        .where(and(eq(workspaces.kind, 'organization'), orgId ? ne(workspaces.id, orgId) : undefined, isNull(workspaces.deletedAt), isNull(workspaces.suspendedAt), eq(workspaces.visibility, 'public'),
            ilike(workspaces.title, `%${needle.replace(/[%_\\]/g, (m) => `\\${m}`)}%`)))
        .orderBy(sql`${workspaces.verifiedAt} IS NULL`, workspaces.title).limit(8);
    return rows;
}

/** Way 2: asks the linked "Part of" organization (itself verified) to confirm; its admins see it on their Overview. */
export async function askParentOrgAction(orgId: string): Promise<{ success: true } | Failure> {
    const owner = await ownerOf(orgId);
    if (!owner) return DENIED;
    const parentId = (owner.org.settings as { partOfOrgId?: string } | null)?.partOfOrgId;
    if (!parentId) return { success: false, error: 'Link “Part of” to an organization on NetworkBase first.' };
    const [parent] = await db.select({ id: workspaces.id, title: workspaces.title, verifiedAt: workspaces.verifiedAt, suspendedAt: workspaces.suspendedAt })
        .from(workspaces).where(and(eq(workspaces.id, parentId), eq(workspaces.kind, 'organization'), isNull(workspaces.deletedAt))).limit(1);
    if (!parent || parent.suspendedAt) return { success: false, error: 'That organization isn’t available.' };
    if (!parent.verifiedAt) return { success: false, error: `${parent.title} isn’t verified yet, so it can’t confirm you.` };
    const request: VerificationRequest = { method: 'parent', at: new Date().toISOString(), parentId: parent.id, parentTitle: parent.title };
    await db.update(orgVerificationCodes).set({ expiresAt: new Date() }).where(eq(orgVerificationCodes.orgId, orgId));
    await db.update(workspaces).set({ orgSettings: sql`(coalesce(${workspaces.orgSettings}, '{}'::jsonb) - 'verification') || jsonb_build_object('verificationRequest', ${JSON.stringify(request)}::jsonb)` })
        .where(eq(workspaces.id, orgId));
    const parentLabel = await orgLabel(parent.id);
    if (parentLabel) {
        await notifyOrg({ orgId: parent.id, eventKey: 'org.child_requests', actorId: owner.user.id, title: `${owner.org.title} asks ${parent.title} to confirm it`,
            href: orgHref(parentLabel), sourceEventId: `verify-parent:${orgId}:${Date.now()}` });
    }
    done(owner.org.slug, orgId);
    return { success: true };
}

/** Way 2, the parent's side: an admin of the verified parent confirms or declines (with a reason) from their Overview. */
export async function decideParentVerificationAction(parentId: string, childId: string, approve: boolean, reason?: string): Promise<{ success: true } | Failure> {
    const user = await signedInUser();
    if (!user || !isUuid(parentId) || !isUuid(childId)) return DENIED;
    const role = await readViewerOrgRole(parentId, user.id);
    if (role !== 'owner' && role !== 'admin') return DENIED;
    const [[parent], [child]] = await Promise.all([
        db.select({ title: workspaces.title, verifiedAt: workspaces.verifiedAt }).from(workspaces).where(eq(workspaces.id, parentId)).limit(1),
        db.select({ title: workspaces.title, slug: workspaces.slug, ownerId: workspaces.ownerId, settings: workspaces.orgSettings }).from(workspaces).where(and(eq(workspaces.id, childId), eq(workspaces.kind, 'organization'))).limit(1),
    ]);
    const request = pending(child?.settings);
    if (!parent?.verifiedAt || !child || request?.method !== 'parent' || request.parentId !== parentId) return { success: false, error: 'This request isn’t waiting any more.' };
    if (approve) {
        await markVerified(childId, 'parent', `Part of ${parent.title}`, { by: user.id });
    } else {
        const declined = { state: 'declined', reason: reason?.trim().slice(0, 500) || `${parent.title} didn’t confirm it.`, at: new Date().toISOString() };
        await db.update(workspaces).set({ orgSettings: sql`(coalesce(${workspaces.orgSettings}, '{}'::jsonb) - 'verificationRequest') || jsonb_build_object('verification', ${JSON.stringify(declined)}::jsonb)` })
            .where(eq(workspaces.id, childId));
    }
    const childLabel = await orgLabel(childId);
    if (childLabel) {
        await notifyOrg({ orgId: childId, eventKey: 'org.lifecycle', actorId: user.id, to: [child.ownerId], title: approve ? `${parent.title} confirmed ${child.title}. It’s verified.` : `${parent.title} didn’t confirm ${child.title}`,
            body: approve ? null : reason?.trim().slice(0, 500) || null, href: orgHref(childLabel, '?tab=settings&settings=access'), sourceEventId: `verify-parent-decided:${childId}:${Date.now()}` });
    }
    revalidatePath(`/org/${child.slug ?? childId}`);
    return { success: true };
}
