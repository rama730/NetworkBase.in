'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { workspaces } from '@/lib/db/schema';
import { getWorkspaceAccessById } from '@/lib/data/workspace-access';
import { verificationDomain } from '@/lib/organizations/trust-rules';
import { createClient } from '@/lib/supabase/server';

// The Verified badge request (report §30.3). Reports go through actions/moderation.ts; staff review in
// actions/moderation-staff.ts (docs/trust-and-safety-concept.md).

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

/**
 * Settings → General "Request verification" (report §30.3): automatic when the owner's verified email domain
 * matches the org website; otherwise queued for platform admin review.
 */
export async function requestOrgVerificationAction(orgId: string): Promise<{ success: true; verified: boolean } | Failure> {
    const user = await signedInUser();
    if (!user) return DENIED;
    const access = await getWorkspaceAccessById(orgId, user.id);
    if (access.project?.kind !== 'organization' || !access.isOwner) return DENIED;
    const [org] = await db.select({ links: workspaces.externalLinks, verifiedAt: workspaces.verifiedAt }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
    if (org?.verifiedAt) return { success: true, verified: true };
    const websites = linkUrls(org?.links);
    const domain = user.email_confirmed_at ? verificationDomain(user.email, websites) : null;
    await db.update(workspaces).set(domain
        ? { verifiedAt: new Date(), verificationDomain: domain, verificationRequestedAt: null }
        : { verificationRequestedAt: new Date() }).where(eq(workspaces.id, orgId));
    revalidatePath(`/org/${access.project.slug ?? orgId}`);
    return { success: true, verified: Boolean(domain) };
}
