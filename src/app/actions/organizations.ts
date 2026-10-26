'use server';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { getTrustedHeadersIp } from '@/lib/security/request-ip';
import { organizationsEnabled, ORG_LIMITS } from '@/lib/organizations/config';
import { validateOrgHandle } from '@/lib/organizations/handle';
import { countOrgMembers, findOrgByJoinCode, isOrgHandleAvailable, joinOrgByCode, viewerOrgStatus } from '@/lib/organizations/join';
import { normalizeJoinCode, ORG_JOIN_MESSAGES, type OrgJoinMode, type OrgJoinOutcome } from '@/lib/organizations/join-rules';
import { isProjectPubliclyReadableVisibility } from '@/lib/projects/project-visibility';

type Failure = { success: false; error: string };

export type OrgJoinPreview = {
    title: string;
    slug: string | null;
    orgType: string | null;
    coverImage: string | null;
    /** Null for private orgs: they show only logo, name and type (decision 131). */
    memberCount: number | null;
    joinMode: OrgJoinMode;
    /** The logged-in viewer's standing: already in, request pending, or neither. */
    viewer: 'member' | 'pending' | null;
};

const NO_MATCH: Failure = { success: false, error: ORG_JOIN_MESSAGES.no_match };
const TOO_MANY: Failure = { success: false, error: 'Too many attempts. Please wait a minute and try again.' };

async function viewerId() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
}

/** Code lookups are rate-limited per account and per network address (decision 135); a limiter outage lets them through. */
async function allowLookup(userId: string | null) {
    const headerStore = await headers();
    const ip = getTrustedHeadersIp(headerStore)
        ?? `fp:${createHash('sha1').update(`${headerStore.get('user-agent') ?? ''}|${headerStore.get('accept-language') ?? ''}`).digest('hex').slice(0, 16)}`;
    const checks = [consumeRateLimit(`org:join-code:ip:${ip}`, ORG_LIMITS.joinCodeAttemptsPerMinutePerIp, 60)];
    if (userId) checks.push(consumeRateLimit(`org:join-code:user:${userId}`, ORG_LIMITS.joinCodeAttemptsPerMinutePerAccount, 60));
    return (await Promise.all(checks)).every((r) => r.allowed || r.degraded);
}

export async function getJoinPreviewAction(rawCode: string): Promise<{ success: true; preview: OrgJoinPreview } | Failure> {
    if (!organizationsEnabled()) return NO_MATCH;
    const code = normalizeJoinCode(rawCode);
    const userId = await viewerId();
    if (!(await allowLookup(userId))) return TOO_MANY;
    const org = code ? await findOrgByJoinCode(code) : null;
    if (!org) return NO_MATCH;
    const isPublic = isProjectPubliclyReadableVisibility(org.visibility);
    return {
        success: true,
        preview: {
            title: org.title,
            slug: org.slug,
            orgType: org.orgType,
            coverImage: org.coverImage,
            memberCount: isPublic ? await countOrgMembers(org.id) : null,
            joinMode: (org.orgSettings as { joinMode?: unknown })?.joinMode === 'approval' ? 'approval' : 'instant',
            viewer: userId ? await viewerOrgStatus(org.id, org.ownerId, userId) : null,
        },
    };
}

export async function joinOrganizationAction(
    rawCode: string,
    note?: string | null,
): Promise<{ success: true; outcome: OrgJoinOutcome; org: { id: string; title: string; slug: string | null } } | Failure> {
    if (!organizationsEnabled()) return NO_MATCH;
    const userId = await viewerId();
    if (!userId) return { success: false, error: 'Log in to join an organization.' };
    if (!(await allowLookup(userId))) return TOO_MANY;
    const code = normalizeJoinCode(rawCode);
    const result = code ? await joinOrgByCode(userId, code, note) : null;
    if (!result) return NO_MATCH;
    const { outcome, org } = result;
    if (outcome === 'blocked' || outcome === 'full' || outcome === 'unavailable' || outcome === 'cooldown') {
        return { success: false, error: ORG_JOIN_MESSAGES[outcome] };
    }
    if (outcome === 'joined') revalidatePath(`/projects/${org.slug ?? org.id}`);
    return { success: true, outcome, org };
}

/** Live check for the create wizard's @handle field. */
export async function checkOrgHandleAction(raw: string): Promise<{ available: boolean; handle: string | null; message: string }> {
    const userId = await viewerId();
    if (!organizationsEnabled() || !userId) return { available: false, handle: null, message: 'Not available.' };
    const checked = validateOrgHandle(raw);
    if (!checked.ok) {
        return {
            available: false,
            handle: null,
            message: checked.reason === 'reserved'
                ? 'That handle is reserved.'
                : 'Use 3–40 letters, numbers or single dashes, starting and ending with a letter or number.',
        };
    }
    const available = await isOrgHandleAvailable(checked.handle);
    return { available, handle: checked.handle, message: available ? `@${checked.handle} is available.` : `@${checked.handle} is taken.` };
}
