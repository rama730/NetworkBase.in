'use server';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { getTrustedHeadersIp } from '@/lib/security/request-ip';
import { z } from 'zod';
import { ORG_LIMITS, orgRoleNames, orgTypeLabel } from '@/lib/organizations/config';
import { validateOrgHandle } from '@/lib/organizations/handle';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { transactionThen } from '@/lib/db/after-commit';
import { orgHandleHolds, profiles, workspaceMembers, workspaces, roleApplications, applicationEvents } from '@/lib/db/schema';
import { getWorkspaceAccessById } from '@/lib/data/workspace-access';
import { removeWorkspaceMemberInternal } from '@/lib/workspaces/collaborator-lifecycle';
import { childGrant, orgGrant, type ChildAction, type ChildRole, type OrgRole } from '@/lib/organizations/permissions';
import { customRoleNames } from '@/lib/organizations/type-profile';
import { rolePlural } from '@/lib/organizations/role-words';
import { ORG_SECTION_OWNER_ONLY, ORG_SETTINGS_PATCH, type OrgSettingsSection } from '@/lib/organizations/settings';
import { generateJoinCode } from '@/lib/organizations/join-rules';
import { allowedChildVisibilities, type ChildVisibility } from '@/lib/organizations/child-rules';
import { applyChildVisibilityCap, countChildrenAboveCap, countOutsidePeople, detachFromOrg, moveIntoOrg, readOrgCap } from '@/lib/organizations/children';
import { listCreateLocations, readViewerOrgRole } from '@/lib/organizations/detail';
import { acceptOrgInvite, AccountOrgLimitError, accountOrgLimit, ledChildWorkspaces, notifySeatsReopened, openInvitesFor, removeFromOrg } from '@/lib/organizations/members';
import { countOrgMembers, findOrgByJoinCode, isOrgHandleAvailable, joinOrgByCode, joinPublicOrg, viewerOrgStatus } from '@/lib/organizations/join';
import { adminsCanSeeLine, joinPageState, normalizeJoinCode, orgMemberCap, ORG_JOIN_MESSAGES, type JoinPageState, type OrgJoinMode, type OrgJoinOutcome } from '@/lib/organizations/join-rules';
import { isWorkspacePubliclyReadableVisibility } from '@/lib/workspaces/workspace-visibility';
import { namesOf, notifyJoined, notifyOrg, orgHref, orgLabel } from '@/lib/organizations/notify';
import { moveGroupWorkToLead } from '@/lib/organizations/assignments';
import { UUID_RE } from '@/lib/validations/uuid';
import { syncWorkspaceChat } from '@/lib/messaging/integrations';
import { logger } from '@/lib/logger';
import { markProfileCollaborationSummaryStale } from '@/lib/profile/collaboration';

type Failure = { success: false; error: string };

export type OrgJoinPreview = {
    /** For Report on the join page (trust and safety §5.1). */
    id: string;
    title: string;
    slug: string | null;
    /** The type as people read it ("Education", or Other's own label). */
    orgType: string | null;
    coverImage: string | null;
    /** Null for private orgs: they show only logo, name and type (decision 131). */
    memberCount: number | null;
    joinMode: OrgJoinMode;
    /** The logged-in viewer's standing: already in, request pending, or neither. */
    viewer: 'member' | 'pending' | null;
    /** Report §26.2: what the page shows, and the sentence for the states that stop joining. */
    state: JoinPageState;
    stateMessage: string | null;
    /** Decision 63: what admins can see, before anyone joins. */
    adminsLine: string;
};

const NO_MATCH: Failure = { success: false, error: ORG_JOIN_MESSAGES.no_match };
const TOO_MANY: Failure = { success: false, error: 'Too many attempts. Wait a minute and try again.' };

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
    const code = normalizeJoinCode(rawCode);
    const userId = await viewerId();
    if (!(await allowLookup(userId))) return TOO_MANY;
    const org = code ? await findOrgByJoinCode(code) : null;
    if (!org) return NO_MATCH;
    const isPublic = isWorkspacePubliclyReadableVisibility(org.visibility);
    // Report §26.2, gap 14: every state the page can show, decided here so nothing is created for the others.
    const memberCount = await countOrgMembers(org.id);
    const status = userId ? await viewerOrgStatus(org.id, org.ownerId, userId) : null;
    const [standing] = userId ? await db.execute<{ blocked: boolean; declined: boolean }>(sql`
        SELECT EXISTS (SELECT 1 FROM org_join_blocks b WHERE b.org_id = ${org.id} AND b.user_id = ${userId}) AS blocked,
          EXISTS (SELECT 1 FROM role_applications a WHERE a.workspace_id = ${org.id} AND a.applicant_id = ${userId} AND a.role_id IS NULL
            AND a.status = 'rejected' AND a.updated_at > now() - interval '1 day') AS declined`) : [];
    const limit = userId && status !== 'member' ? await accountOrgLimit(db, userId, 'join') : null;
    const state = joinPageState({
        available: org.status !== 'archived' && !org.suspendedAt && !org.deletionScheduledAt,
        isMember: status === 'member', pending: status === 'pending', blocked: Boolean(standing?.blocked), declinedRecently: Boolean(standing?.declined),
        memberCount, maxMembers: orgMemberCap(org.maxCollaborators), limit,
    });
    const names = orgRoleNames(org.orgType, org.orgSettings);
    return {
        success: true,
        preview: {
            state,
            stateMessage: state === 'limit' ? limit : state === 'unavailable' ? ORG_JOIN_MESSAGES.unavailable : state === 'blocked' ? ORG_JOIN_MESSAGES.blocked
                : state === 'cooldown' ? ORG_JOIN_MESSAGES.cooldown : state === 'full' ? ORG_JOIN_MESSAGES.full : null,
            adminsLine: adminsCanSeeLine(org.title ?? 'This organization', names),
            id: org.id,
            title: org.title,
            slug: org.slug,
            orgType: orgTypeLabel(org.orgType, org.orgSettings),
            coverImage: org.coverImage,
            memberCount: isPublic ? memberCount : null,
            joinMode: (org.orgSettings as { joinMode?: unknown })?.joinMode === 'approval' ? 'approval' : 'instant',
            viewer: status,
        },
    };
}

/** Turns only the account-limit refusal into a value; anything else rethrows and stays redacted (report §26.11). */
function limitOnly(error: unknown): AccountOrgLimitError {
    if (error instanceof AccountOrgLimitError) return error;
    throw error;
}

export async function joinOrganizationAction(
    rawCode: string,
    note?: string | null,
): Promise<{ success: true; outcome: OrgJoinOutcome; org: { id: string; title: string; slug: string | null } } | Failure> {
    const userId = await viewerId();
    if (!userId) return { success: false, error: 'Sign in to join an organization.' };
    if (!(await allowLookup(userId))) return TOO_MANY;
    const code = normalizeJoinCode(rawCode);
    // An invite waiting for this person is accepted instead, with its role (report §20.11).
    const target = code ? await findOrgByJoinCode(code) : null;
    const invite = target ? (await openInvitesFor(userId, target.id))[0] : undefined;
    // A refusal such as the 50-organization limit comes back as its sentence (report §26.11).
    const accepted = target && invite ? await acceptOrgInvite(userId, invite.id).catch(limitOnly) : null;
    if (accepted instanceof AccountOrgLimitError) return { success: false, error: accepted.message };
    if (target && invite && accepted && 'orgId' in accepted) {
        revalidatePath(`/workspaces/${target.slug ?? target.id}`);
        await notifyJoined(target.id, userId, `${invite.id}:accepted`);
        return { success: true, outcome: 'joined', org: { id: target.id, title: target.title, slug: target.slug } };
    }
    const result = code ? await joinOrgByCode(userId, code, note).catch(limitOnly) : null;
    if (result instanceof AccountOrgLimitError) return { success: false, error: result.message };
    if (!result) return NO_MATCH;
    const { outcome, org } = result;
    if (outcome === 'blocked' || outcome === 'full' || outcome === 'unavailable' || outcome === 'cooldown') {
        return { success: false, error: ORG_JOIN_MESSAGES[outcome] };
    }
    if (outcome === 'joined') revalidatePath(`/workspaces/${org.slug ?? org.id}`);
    await afterJoin(org.id, outcome, userId);
    return { success: true, outcome, org };
}

/** Live check for the create wizard's @handle field. */
export async function checkOrgHandleAction(raw: string): Promise<{ available: boolean; handle: string | null; message: string }> {
    const userId = await viewerId();
    if (!userId) return { available: false, handle: null, message: 'Not available.' };
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

type OrgViewer = { userId: string; role: OrgRole; slug: string | null };

/** The signed-in viewer and their role in this org ("guest" for viewers); null outside it or when it isn't an org. */
async function orgViewer(orgId: string, mode: 'read' | 'write' = 'write'): Promise<OrgViewer | null> {
    const userId = await viewerId();
    if (!userId) return null;
    const access = await getWorkspaceAccessById(orgId, userId);
    if (mode === 'write' && access.writeBlocked) return null;
    if (access.project?.kind !== 'organization') return null;
    const role: OrgRole = access.isOwner ? 'owner' : access.memberRole === 'admin' ? 'admin' : access.memberRole === 'member' ? 'member' : access.memberRole === 'viewer' ? 'guest' : 'visitor';
    return { userId, role, slug: access.project.slug ?? null };
}

const DENIED: Failure = { success: false, error: "You don’t have permission to change this." };

function revalidateOrg(slug: string | null, orgId: string) {
    revalidatePath(`/org/${slug ?? orgId}`);
    revalidatePath(`/workspaces/${slug ?? orgId}`);
}

/**
 * Saves one org settings section (report §21.2). Owners and admins save every section except role names,
 * which are the owner's; the section footer records who changed it last.
 */
export type OrgSettingsFacts = { members: number; admins: number; workspaces: number; outsidePeople: number; channels: number; waitingRequests: number };

/** The counts Settings shows beside its fields (report §22.4): "38 members now", "3 of 20", "12 of 200". Admins only. */
export async function readOrgSettingsFactsAction(orgId: string): Promise<{ success: true; facts: OrgSettingsFacts } | Failure> {
    const viewer = await orgViewer(orgId, 'read');
    if (!viewer || (viewer.role !== 'owner' && viewer.role !== 'admin')) return DENIED;
    const [row] = await db.execute<OrgSettingsFacts>(sql`
        SELECT (SELECT count(*)::int FROM workspace_members WHERE workspace_id = ${orgId}) AS members,
               (SELECT count(*)::int FROM workspace_members WHERE workspace_id = ${orgId} AND role = 'admin') AS admins,
               (SELECT count(*)::int FROM workspaces WHERE parent_id = ${orgId} AND deleted_at IS NULL) AS workspaces,
               (SELECT count(DISTINCT c.user_id)::int FROM workspace_members c JOIN workspaces w ON w.id = c.workspace_id
                 WHERE w.parent_id = ${orgId} AND w.deleted_at IS NULL
                   AND NOT EXISTS (SELECT 1 FROM workspace_members o WHERE o.workspace_id = ${orgId} AND o.user_id = c.user_id)) AS "outsidePeople",
               (SELECT count(*)::int FROM chat_channels WHERE workspace_id = ${orgId} AND kind <> 'dm' AND archived_at IS NULL) AS channels,
               (SELECT count(*)::int FROM role_applications WHERE workspace_id = ${orgId} AND status = 'pending') AS "waitingRequests"`);
    return { success: true, facts: row! };
}

export async function updateOrgSettingsAction(orgId: string, section: OrgSettingsSection, patch: unknown): Promise<{ success: true } | Failure> {
    const viewer = await orgViewer(orgId);
    if (!viewer || !(section in ORG_SETTINGS_PATCH)) return DENIED;
    const allowed = ORG_SECTION_OWNER_ONLY[section] ? orgGrant(viewer.role, 'edit_identity') === 'yes' : orgGrant(viewer.role, 'manage_joining') === 'yes';
    if (!allowed) return DENIED;
    const parsed = ORG_SETTINGS_PATCH[section].safeParse(patch);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Check the values and try again.' };
    const value = parsed.data as Record<string, unknown>;

    const [actor] = await db.select({ fullName: profiles.fullName }).from(profiles).where(eq(profiles.id, viewer.userId)).limit(1);
    const [current] = await db.select({ orgType: workspaces.orgType, orgSettings: workspaces.orgSettings, termStart: workspaces.termStart, termEnd: workspaces.termEnd }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
    const storedNames = (current?.orgSettings as { roleNames?: Record<string, string> } | null)?.roleNames;
    const settingsPatch: Record<string, unknown> = {
        changes: { [section]: { by: viewer.userId, byName: actor?.fullName ?? null, at: new Date().toISOString() } },
    };
    const columns: Partial<typeof workspaces.$inferInsert> = {};
    if (section === 'profile') {
        // Report §21.2: only the owner changes type. It renames roles still on the old type's names and changes
        // labels; joining, visibility, rules and work stay, because those were saved when the organization was made.
        if ('org_type' in value && value.org_type !== current?.orgType) {
            if (orgGrant(viewer.role, 'change_org_type') !== 'yes') return DENIED;
            columns.orgType = value.org_type as typeof columns.orgType;
            settingsPatch.roleNames = customRoleNames(current?.orgType, storedNames);
        }
        if ('term_start' in value) columns.termStart = (value.term_start as string) || null;
        if ('term_end' in value) columns.termEnd = (value.term_end as string) || null;
        if ('time_zone' in value) columns.timeZone = (value.time_zone as string) || null;
        if ('welcome_note' in value) columns.welcomeNote = (value.welcome_note as string) || null;
        if (value.org_type === 'other' && !value.type_label) return { success: false, error: 'Say what you call this organization.' };
        if ('type_label' in value) settingsPatch.typeLabel = (value.type_label as string) || null;
        if ('part_of' in value) settingsPatch.partOf = (value.part_of as string) || null;
        if ('location' in value) settingsPatch.location = (value.location as string) || null;
        const [start, end] = [columns.termStart ?? current?.termStart ?? null, columns.termEnd ?? current?.termEnd ?? null];
        if (start && end && end <= start) return { success: false, error: 'The term has to end after it starts.' };
    } else if (section === 'access') {
        if ('join_mode' in value) settingsPatch.joinMode = value.join_mode;
        if ('join_code_enabled' in value) columns.joinCodeEnabled = value.join_code_enabled as boolean;
        if (typeof value.max_members === 'number') {
            // Smaller bug 24: nobody is removed by lowering it, so it can't go below the people already here.
            const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(workspaceMembers).where(eq(workspaceMembers.projectId, orgId));
            if (value.max_members < n) return { success: false, error: `There are ${n} members now. Max members can’t be lower.` };
        }
        if ('max_members' in value) columns.maxCollaborators = value.max_members == null ? null : String(value.max_members);
    } else if (section === 'people') {
        // Names equal to the type's aren't saved, so a later type change still renames them.
        settingsPatch.roleNames = customRoleNames(current?.orgType, value.role_names as Record<string, string>);
    } else if (section === 'work') {
        const keys = { review_required: 'assignmentReview', late_rule: 'assignmentLateRule', reminders: 'assignmentReminders', story_points: 'storyPoints',
            sprint_auto_start: 'sprintAutoStart', sprint_notify_on_start: 'sprintNotifyOnStart', sprint_show_in_children: 'sprintShowInChildren', sprint_create_matching: 'sprintCreateMatching' } as const;
        for (const [field, key] of Object.entries(keys)) if (field in value) settingsPatch[key] = value[field];
    } else if (section === 'notifications') {
        if ('admin_digest' in value) settingsPatch.adminDigest = value.admin_digest;
    } else if (section === 'updates') {
        if ('member_posts' in value) columns.memberUpdatesEnabled = value.member_posts as boolean;
        if ('announcement_notify' in value) settingsPatch.announcementNotify = value.announcement_notify;
        if ('reply_rule' in value) settingsPatch.replyRule = value.reply_rule;
    } else {
        if ('child_creation' in value) settingsPatch.childCreation = value.child_creation;
        if ('outside_people' in value) settingsPatch.outsidePeople = value.outside_people;
        if ('child_share' in value) settingsPatch.childShare = value.child_share;
        if ('visibility_cap' in value) settingsPatch.visibilityCap = value.visibility_cap;
        if ('default_units' in value) settingsPatch.defaultUnits = value.default_units;
        if ('follow_sprints' in value) settingsPatch.followSprintsDefault = value.follow_sprints;
    }

    try {
        // jsonb || merges top-level keys; "changes" is merged one level deeper so other sections keep their footer.
        await db.update(workspaces).set({
            ...columns,
            orgSettings: sql`${workspaces.orgSettings} || ${JSON.stringify({ ...settingsPatch, changes: undefined })}::jsonb
                || jsonb_build_object('changes', coalesce(${workspaces.orgSettings}->'changes', '{}'::jsonb) || ${JSON.stringify(settingsPatch.changes)}::jsonb)`,
            updatedAt: new Date(),
            ...(section === 'profile' ? { lastUpdateAt: new Date(), lastUpdateBy: viewer.userId } : {}),
        }).where(and(eq(workspaces.id, orgId), isNull(workspaces.deletedAt)));
    } catch {
        return { success: false, error: 'Check the term dates: the term must end after it starts.' };
    }
    // A tightened cap lowers existing child projects (report §21.7); the preview showed how many.
    if ('visibility_cap' in value) await applyChildVisibilityCap(orgId);
    revalidateOrg(viewer.slug, orgId);
    return { success: true };
}

/** A new code replaces the old one at once; the old code stops working (report §6.1). */
export async function regenerateJoinCodeAction(orgId: string): Promise<{ success: true; joinCode: string } | Failure> {
    const viewer = await orgViewer(orgId);
    if (!viewer || orgGrant(viewer.role, 'manage_joining') !== 'yes') return DENIED;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const joinCode = generateJoinCode();
        try {
            await db.update(workspaces).set({ joinCode, updatedAt: new Date() }).where(eq(workspaces.id, orgId));
            revalidateOrg(viewer.slug, orgId);
            // The other admins hear who changed it (report §26 A).
            const name = (await namesOf([viewer.userId])).get(viewer.userId) ?? 'an admin';
            await notifyOrg({ orgId, eventKey: 'org.code_changed', actorId: viewer.userId, title: `The join code was changed by ${name}`,
                href: orgHref({ slug: viewer.slug, id: orgId }, '?tab=members'), sourceEventId: `code:${joinCode}` });
            return { success: true, joinCode };
        } catch {
            // ponytail: a collision with another org's code just retries; 32^6 codes make five tries plenty.
        }
    }
    return { success: false, error: 'Couldn’t make a new code. Try again.' };
}

/** Owner only, at most once every 7 days; the old handle redirects and stays taken for 90 days (report §30.2). */
export async function renameOrgHandleAction(orgId: string, raw: string): Promise<{ success: true; handle: string } | Failure> {
    const viewer = await orgViewer(orgId);
    if (!viewer || orgGrant(viewer.role, 'edit_identity') !== 'yes') return DENIED;
    const checked = validateOrgHandle(raw);
    if (!checked.ok) return { success: false, error: checked.reason === 'reserved' ? 'That handle is reserved.' : 'Use 3–40 letters, numbers or single dashes.' };
    const handle = checked.handle;

    return db.transaction(async (tx) => {
        const [org] = await tx.select({ slug: workspaces.slug, orgSettings: workspaces.orgSettings }).from(workspaces).where(eq(workspaces.id, orgId)).for('update').limit(1);
        if (!org) return DENIED;
        if (org.slug === handle) return { success: true as const, handle };
        const changedAt = (org.orgSettings as { handleChangedAt?: string })?.handleChangedAt;
        if (changedAt && Date.now() - new Date(changedAt).getTime() < ORG_LIMITS.handleRenameDays * 24 * 3600 * 1000) {
            // Report §27.8: say the day it opens again.
            const next = new Date(new Date(changedAt).getTime() + ORG_LIMITS.handleRenameDays * 24 * 3600 * 1000);
            return { success: false as const, error: `You can change it again on ${new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(next)}.` };
        }
        // Taking back this org's own held handle is fine; anyone else's address or hold is not.
        const [ownHold] = await tx.select({ handle: orgHandleHolds.handle }).from(orgHandleHolds)
            .where(and(eq(orgHandleHolds.handle, handle), eq(orgHandleHolds.orgId, orgId))).limit(1);
        if (ownHold) await tx.delete(orgHandleHolds).where(eq(orgHandleHolds.handle, handle));
        else if (!(await isOrgHandleAvailable(handle))) return { success: false as const, error: `@${handle} is taken.` };

        await tx.update(workspaces).set({
            slug: handle,
            orgSettings: sql`${workspaces.orgSettings} || ${JSON.stringify({ handleChangedAt: new Date().toISOString() })}::jsonb`,
            updatedAt: new Date(),
        }).where(eq(workspaces.id, orgId));
        if (org.slug) {
            const heldUntil = new Date(Date.now() + ORG_LIMITS.handleHoldDays * 24 * 3600 * 1000);
            await tx.insert(orgHandleHolds).values({ handle: org.slug, orgId, heldUntil })
                .onConflictDoUpdate({ target: orgHandleHolds.handle, set: { orgId, heldUntil } });
        }
        revalidateOrg(org.slug, orgId);
        return { success: true as const, handle };
    }).catch(() => ({ success: false as const, error: `@${handle} is taken.` }));
}

/** Join or request from a public org's page, without the code. */
export async function joinPublicOrgAction(
    orgId: string,
    note?: string | null,
): Promise<{ success: true; outcome: OrgJoinOutcome } | Failure> {
    const userId = await viewerId();
    if (!userId) return { success: false, error: 'Sign in to join an organization.' };
    if (!(await allowLookup(userId))) return TOO_MANY;
    const result = await joinPublicOrg(userId, orgId, note);
    if (!result) return { success: false, error: 'This organization can be joined only with its code.' };
    const { outcome, org } = result;
    if (outcome === 'blocked' || outcome === 'full' || outcome === 'unavailable' || outcome === 'cooldown') {
        return { success: false, error: ORG_JOIN_MESSAGES[outcome] };
    }
    revalidateOrg(org.slug, org.id);
    await afterJoin(org.id, outcome, userId);
    return { success: true, outcome };
}

/** Joined: admins see "N people joined" and the person gets E4. Requested: admins see "N people asked to join". */
async function afterJoin(orgId: string, outcome: OrgJoinOutcome, userId: string) {
    const eventId = `join:${userId}:${Date.now()}`;
    if (outcome === 'joined') return notifyJoined(orgId, userId, eventId);
    if (outcome !== 'requested') return;
    const org = await orgLabel(orgId);
    const name = (await namesOf([userId])).get(userId) ?? 'Someone';
    if (org) await notifyOrg({ orgId, eventKey: 'org.join_requested', actorId: userId, title: `${name} asked to join ${org.title}`, href: orgHref(org, '?tab=members'), sourceEventId: eventId });
}

/** Withdraws the viewer's pending join request; withdrawing is not a decline, so there is no cool-down. */
/** Add a note to a waiting join request (report §26.5): up to 500 characters; the admins' row shows the newest. */
export async function updateJoinRequestNoteAction(orgId: string, note: string): Promise<{ success: true } | Failure> {
    const userId = await viewerId();
    if (!userId) return DENIED;
    const clean = note.trim().slice(0, 500) || null;
    const updated = await db.update(roleApplications).set({ message: clean, updatedAt: new Date() })
        .where(and(eq(roleApplications.projectId, orgId), eq(roleApplications.applicantId, userId), eq(roleApplications.status, 'pending'), isNull(roleApplications.roleId)))
        .returning({ id: roleApplications.id });
    if (!updated.length) return { success: false, error: 'There is no waiting request to add a note to.' };
    return { success: true };
}

export async function cancelJoinRequestAction(orgId: string): Promise<{ success: true } | Failure> {
    const userId = await viewerId();
    if (!userId) return DENIED;
    const now = new Date();
    const withdrawn = await db.update(roleApplications)
        .set({ status: 'withdrawn', decisionAt: now, decisionBy: userId, updatedAt: now })
        .where(and(eq(roleApplications.projectId, orgId), eq(roleApplications.applicantId, userId), eq(roleApplications.status, 'pending'), isNull(roleApplications.roleId)))
        .returning({ id: roleApplications.id });
    for (const row of withdrawn) {
        await db.insert(applicationEvents).values({ applicationId: row.id, actorId: userId, kind: 'withdrawn', fromStatus: 'pending', toStatus: 'withdrawn', metadata: { source: 'org_join_request' } });
    }
    if (withdrawn.length === 0) return { success: false, error: 'There is no pending request to cancel.' };
    revalidatePath(`/workspaces/${orgId}`);
    return { success: true };
}

const myMembershipSchema = z.object({ title: z.string().trim().max(60).nullable().optional(), show_on_profile: z.boolean().optional() }).strict();

/** "My membership" (report §21.3): everyone edits their own title and whether the org shows on their profile. */
export async function updateMyOrgMembershipAction(orgId: string, patch: unknown): Promise<{ success: true } | Failure> {
    const viewer = await orgViewer(orgId, 'read');
    if (!viewer || viewer.role === 'visitor') return DENIED;
    const parsed = myMembershipSchema.safeParse(patch);
    if (!parsed.success) return { success: false, error: 'Titles are up to 60 characters.' };
    await db.update(workspaceMembers).set({
        ...('title' in parsed.data ? { title: parsed.data.title || null } : {}),
        ...('show_on_profile' in parsed.data ? { showOnProfile: parsed.data.show_on_profile } : {}),
    }).where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.userId, viewer.userId)));
    // The public profile is cached: the switch and the title must show there at once (report §38.2).
    await markProfileCollaborationSummaryStale(viewer.userId);
    revalidateOrg(viewer.slug, orgId);
    return { success: true };
}

export type MyProfileOrganization = { orgId: string; title: string; slug: string | null; role: string; showOnProfile: boolean };

/** Manage organizations (report §38.2): the viewer's organizations in their profile order, with each Show switch. */
export async function readMyProfileOrganizationsAction(): Promise<MyProfileOrganization[]> {
    const userId = await viewerId();
    if (!userId) return [];
    const rows = await db.select({ orgId: workspaces.id, title: workspaces.title, slug: workspaces.slug, orgType: workspaces.orgType, orgSettings: workspaces.orgSettings,
        role: workspaceMembers.role, ownerId: workspaces.ownerId, showOnProfile: workspaceMembers.showOnProfile, order: workspaceMembers.profileOrder })
        .from(workspaceMembers).innerJoin(workspaces, eq(workspaces.id, workspaceMembers.projectId))
        .where(and(eq(workspaceMembers.userId, userId), eq(workspaces.kind, 'organization'), isNull(workspaces.deletedAt)));
    return rows
        .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || (a.title ?? '').localeCompare(b.title ?? ''))
        .map((r) => ({ orgId: r.orgId, title: r.title ?? 'Organization', slug: r.slug, showOnProfile: r.showOnProfile !== false,
            role: orgRoleNames(r.orgType, r.orgSettings)[(r.ownerId === userId ? 'owner' : r.role) as 'owner' | 'admin' | 'member' | 'viewer'] ?? 'Member' }));
}

/** Saves the order chosen in Manage organizations; only the viewer's own memberships change. */
export async function saveMyOrganizationOrderAction(orgIds: string[]): Promise<{ success: true } | Failure> {
    const userId = await viewerId();
    if (!userId) return DENIED;
    const ids = orgIds.filter((id) => typeof id === 'string').slice(0, ORG_LIMITS.orgsJoinedPerUser);
    await db.transaction(async (tx) => {
        for (const [index, orgId] of ids.entries()) {
            await tx.update(workspaceMembers).set({ profileOrder: index }).where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.userId, userId)));
        }
    });
    await markProfileCollaborationSummaryStale(userId);
    return { success: true };
}

export type LeavePreview = { teams: string[]; led: Array<{ id: string; title: string; slug: string | null }>; open: number; submitted: number; keptBy: string };

/** What leaving would do (report §26.10), shown before the person confirms. */
export async function readLeavePreviewAction(orgId: string): Promise<{ success: true; preview: LeavePreview } | Failure> {
    const viewer = await orgViewer(orgId, 'read');
    if (!viewer || viewer.role === 'visitor') return DENIED;
    const [led, teams, [work], [org]] = await Promise.all([
        ledChildWorkspaces(db, orgId, viewer.userId),
        db.select({ title: workspaces.title }).from(workspaceMembers).innerJoin(workspaces, eq(workspaces.id, workspaceMembers.projectId))
            .where(and(eq(workspaces.parentId, orgId), eq(workspaceMembers.userId, viewer.userId), isNull(workspaces.deletedAt))),
        db.execute<{ open: number; submitted: number }>(sql`
            SELECT count(*) FILTER (WHERE NOT handed)::int AS open, count(*) FILTER (WHERE handed)::int AS submitted FROM (
              SELECT (c.review_status IN ('pending', 'approved', 'rejected') OR c.submission IS NOT NULL OR c.status = 'done') AS handed
              FROM tasks c JOIN tasks m ON m.id = c.assignment_id AND m.workspace_id = ${orgId} AND m.deleted_at IS NULL
              WHERE c.deleted_at IS NULL AND c.excused_at IS NULL AND c.assignee_id = ${viewer.userId}
                AND NOT EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = c.id AND tm.user_id <> ${viewer.userId})) own`),
        db.select({ orgType: workspaces.orgType, orgSettings: workspaces.orgSettings }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1),
    ]);
    const names = orgRoleNames(org?.orgType, org?.orgSettings);
    return {
        success: true,
        preview: {
            teams: teams.map((t) => t.title ?? 'Workspace'),
            led: led.map((l) => ({ id: l.id, title: l.title ?? 'Workspace', slug: l.slug ?? null })),
            open: work?.open ?? 0, submitted: work?.submitted ?? 0,
            keptBy: `${rolePlural(names.owner)} and ${rolePlural(names.admin)}`,
        },
    };
}

/** "Leave organization" (report §21.3). The owner transfers ownership first; child projects follow in P4. */
export async function leaveOrgAction(orgId: string): Promise<{ success: true } | Failure> {
    const viewer = await orgViewer(orgId, 'read');
    if (!viewer || viewer.role === 'visitor') return DENIED;
    if (orgGrant(viewer.role, 'leave') !== 'yes') return { success: false, error: 'Transfer ownership before you leave.' };
    const led = await ledChildWorkspaces(db, orgId, viewer.userId);
    if (led.length > 0) return { success: false, error: `You own ${led.length} ${led.length === 1 ? 'workspace' : 'workspaces'} here. Transfer or detach ${led.length === 1 ? 'it' : 'them'} first.` };
    // Leaving the org removes you from its projects too (report §14.4, §20.7).
    const seats = await transactionThen((tx) => removeFromOrg(tx, orgId, viewer.userId, viewer.userId));
    await notifySeatsReopened(orgId, seats);
    revalidateOrg(viewer.slug, orgId);
    const org = await orgLabel(orgId);
    const name = (await namesOf([viewer.userId])).get(viewer.userId) ?? 'Someone';
    if (org) await notifyOrg({ orgId, eventKey: 'org.member_left', actorId: viewer.userId, title: `${name} left ${org.title}`, href: orgHref(org, '?tab=members'), sourceEventId: `left:${viewer.userId}:${Date.now()}` });
    return { success: true };
}

// --- Child projects (report §14.7, §21.6, §29.4) ---

type ChildViewer = {
    userId: string;
    project: { id: string; ownerId: string; parentId: string | null; visibility: string | null; slug: string | null; orgSettings: unknown };
    isLead: boolean;
    parentRole: Awaited<ReturnType<typeof readViewerOrgRole>>;
};

async function childViewer(projectId: string): Promise<ChildViewer | null> {
    const userId = await viewerId();
    if (!userId) return null;
    const [project] = await db.select({ id: workspaces.id, ownerId: workspaces.ownerId, parentId: workspaces.parentId, visibility: workspaces.visibility, slug: workspaces.slug, orgSettings: workspaces.orgSettings, kind: workspaces.kind })
        .from(workspaces).where(and(eq(workspaces.id, projectId), isNull(workspaces.deletedAt))).limit(1);
    if (!project || project.kind !== 'workspace') return null;
    return { userId, project, isLead: project.ownerId === userId, parentRole: await readViewerOrgRole(project.parentId, userId) };
}

const isAdminRole = (role: string | null) => role === 'owner' || role === 'admin';

/** The viewer's place in a child workspace, for the permissions table (report §21.3, decision 109). */
async function childRoleOf(viewer: ChildViewer): Promise<ChildRole> {
    if (viewer.isLead) return 'lead';
    if (isAdminRole(viewer.parentRole)) return 'inherited_admin';
    const [membership] = await db.select({ role: workspaceMembers.role }).from(workspaceMembers)
        .where(and(eq(workspaceMembers.projectId, viewer.project.id), eq(workspaceMembers.userId, viewer.userId))).limit(1);
    if (membership) return !viewer.parentRole ? 'outside' : membership.role === 'admin' ? 'project_admin' : 'unit_member';
    return viewer.parentRole ? 'org_member' : 'visitor';
}
const childCan = async (viewer: ChildViewer, action: ChildAction, grant: 'yes' | 'request' = 'yes') => childGrant(await childRoleOf(viewer), action) === grant;
const revalidateChild = (project: ChildViewer['project']) => revalidatePath(`/workspaces/${project.slug ?? project.id}`);

/** The lead asks the org to let the project go; an org admin decides (report §29.4: detach is "request" for the lead). */
export async function requestDetachAction(projectId: string): Promise<{ success: true } | Failure> {
    const viewer = await childViewer(projectId);
    if (!viewer?.project.parentId || !(await childCan(viewer, 'detach', 'request'))) return DENIED;
    await db.update(workspaces).set({
        orgSettings: sql`${workspaces.orgSettings} || ${JSON.stringify({ detachRequest: { by: viewer.userId, at: new Date().toISOString() } })}::jsonb`,
    }).where(eq(workspaces.id, projectId));
    revalidateChild(viewer.project);
    await notifyChildRequest(viewer.project.parentId, projectId, viewer.userId, (child, org) => `${child} wants to leave ${org}`);
    return { success: true };
}

export async function cancelDetachRequestAction(projectId: string, reason?: string | null): Promise<{ success: true } | Failure> {
    const viewer = await childViewer(projectId);
    if (!viewer?.project.parentId || !(viewer.isLead || isAdminRole(viewer.parentRole))) return DENIED;
    await db.update(workspaces).set({ orgSettings: sql`${workspaces.orgSettings} - 'detachRequest'` }).where(eq(workspaces.id, projectId));
    revalidateChild(viewer.project);
    // The lead cancelling hears nothing; an admin declining tells the lead (report §28.6).
    if (!viewer.isLead) await notifyChildDecision(viewer.project.parentId, projectId, viewer.project.ownerId, viewer.userId, declined(reason));
    return { success: true };
}

/** Inherited org admins detach at once (approving a request, or on their own): the project becomes Private. */
export async function detachChildAction(projectId: string): Promise<{ success: true } | Failure> {
    const viewer = await childViewer(projectId);
    if (!viewer?.project.parentId || !(await childCan(viewer, 'detach'))) return DENIED;
    await detachFromOrg(projectId);
    revalidateChild(viewer.project);
    await notifyChildDecision(viewer.project.parentId, projectId, viewer.project.ownerId, viewer.userId, (child, org) => `${child} left ${org}`);
    return { success: true };
}

/** Inherited org admins may archive a child project; deleting stays the lead's (decision 145). */
export async function archiveChildAction(projectId: string): Promise<{ success: true } | Failure> {
    const viewer = await childViewer(projectId);
    // The lead archives from the workspace's own Settings; this is the organization admins' door.
    if (!viewer?.project.parentId || viewer.isLead || !(await childCan(viewer, 'archive'))) return DENIED;
    const now = new Date();
    // Report §35.3: who archived it decides who can unarchive it.
    await db.update(workspaces).set({ status: 'archived', updatedAt: now,
        orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) || jsonb_build_object('archivedBy', jsonb_build_object('userId', ${viewer.userId}::text, 'admin', true, 'at', ${now.toISOString()}::text))` })
        .where(eq(workspaces.id, projectId));
    revalidateChild(viewer.project);
    // Decision 93: the team and lead always hear it, each time it's archived.
    const { enqueueWorkspaceNotificationEvent } = await import('@/lib/notifications/workspace-events');
    await enqueueWorkspaceNotificationEvent({ projectId, actorUserId: viewer.userId, eventKey: 'security.project_archived', body: 'An organization admin archived the workspace.',
        href: `/workspaces/${encodeURIComponent(viewer.project.slug ?? projectId)}`, sourceEventId: `archive:${projectId}:${now.getTime()}` })
        .catch((error) => logger.warn('org.archive_notice_failed', { projectId, error: error instanceof Error ? error.message : String(error) }));
    return { success: true };
}

/**
 * Unarchive (report §35.3, decision 91): whoever could archive it, except that an organization admin's archive only
 * an admin undoes. A workspace archived with its organization returns with it. The team is told.
 */
export async function unarchiveChildAction(projectId: string): Promise<{ success: true } | Failure> {
    const viewer = await childViewer(projectId);
    if (!viewer?.project.parentId) return DENIED;
    const [row] = await db.select({ status: workspaces.status, title: workspaces.title, settings: workspaces.orgSettings }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
    if (row?.status !== 'archived') return { success: false, error: 'This workspace isn’t archived.' };
    const settings = (row.settings ?? {}) as { archivedBy?: { admin?: boolean }; archivedWithOrg?: boolean };
    if (settings.archivedWithOrg) return { success: false, error: 'It was archived with the organization, and returns when the organization does.' };
    // The lead's grant is "own": only an archive they made themself (decision 91).
    const grant = childGrant(await childRoleOf(viewer), 'unarchive');
    if (grant === 'no') return DENIED;
    if (settings.archivedBy?.admin && grant !== 'yes') return { success: false, error: 'An organization admin archived it, so only an admin can unarchive it.' };
    await db.update(workspaces).set({ status: 'active', updatedAt: new Date(), orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) - 'archivedBy'` }).where(eq(workspaces.id, projectId));
    revalidateChild(viewer.project);
    const [org, team] = await Promise.all([orgLabel(viewer.project.parentId),
        db.select({ id: workspaceMembers.userId }).from(workspaceMembers).where(eq(workspaceMembers.projectId, projectId))]);
    if (org) await notifyOrg({ orgId: org.id, eventKey: 'org.lifecycle', actorId: viewer.userId, to: team.map((m) => m.id).filter((id) => id !== viewer.userId),
        title: `${row.title} is open again`, href: `/workspaces/${encodeURIComponent(viewer.project.slug ?? projectId)}`, sourceEventId: `unarchive:${projectId}:${Date.now()}` });
    return { success: true };
}

/** A workspace that lost its lead (report §35.4): admins of its organization, and whether it's flagged. */
async function leadlessChild(projectId: string) {
    const userId = await viewerId();
    if (!userId || !UUID_RE.test(projectId)) return null;
    const [child] = await db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, parentId: workspaces.parentId, ownerId: workspaces.ownerId, settings: workspaces.orgSettings })
        .from(workspaces).where(and(eq(workspaces.id, projectId), isNull(workspaces.deletedAt))).limit(1);
    if (!child?.parentId) return null;
    const role = await readViewerOrgRole(child.parentId, userId);
    if (!role || orgGrant(role === 'viewer' ? 'guest' : role, 'assign_lead') !== 'yes') return null;
    return { userId, child: { ...child, parentId: child.parentId }, flagged: Boolean((child.settings as { leadHandover?: unknown } | null)?.leadHandover) };
}

/** Assign dialog (report §35.4): team members first, then anyone in the organization; no Viewers, outside or blocked people. */
export async function readLeadCandidatesAction(projectId: string): Promise<{ success: true; people: Array<{ id: string; name: string; onTeam: boolean }> } | Failure> {
    const ctx = await leadlessChild(projectId);
    if (!ctx) return DENIED;
    const rows = await db.execute<{ id: string; name: string; on_team: boolean }>(sql`
        SELECT m.user_id AS id, coalesce(p.full_name, p.username, 'Member') AS name,
               EXISTS (SELECT 1 FROM workspace_members c WHERE c.workspace_id = ${projectId} AND c.user_id = m.user_id) AS on_team
        FROM workspace_members m JOIN profiles p ON p.id = m.user_id AND p.deleted_at IS NULL
        WHERE m.workspace_id = ${ctx.child.parentId} AND m.role IN ('admin', 'member') AND m.user_id <> ${ctx.child.ownerId}
          AND NOT EXISTS (SELECT 1 FROM org_join_blocks b WHERE b.org_id = ${ctx.child.parentId} AND b.user_id = m.user_id)
        ORDER BY 3 DESC, 2 LIMIT 500`);
    return { success: true, people: rows.map((r) => ({ id: r.id, name: r.name, onTeam: r.on_team })) };
}

/**
 * Assign a lead (report §35.4, decision 92): only for a workspace flagged with no lead; the holder steps back to admin
 * access, group work moves to the new lead, the flag clears, and they're told.
 */
export async function assignChildLeadAction(projectId: string, userId: string): Promise<{ success: true } | Failure> {
    const ctx = await leadlessChild(projectId);
    if (!ctx || !UUID_RE.test(userId)) return DENIED;
    if (!ctx.flagged) return { success: false, error: `${ctx.child.title} already has a workspace lead. Only they can hand it over.` };
    const role = await readViewerOrgRole(ctx.child.parentId, userId);
    const [blocked] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM org_join_blocks WHERE org_id = ${ctx.child.parentId} AND user_id = ${userId}`);
    if ((role !== 'member' && role !== 'admin') || blocked?.n) return { success: false, error: 'Choose someone in the organization who isn’t a Viewer.' };
    const holder = ctx.child.ownerId;
    await db.transaction(async (tx) => {
        await tx.update(workspaces).set({ ownerId: userId, updatedAt: new Date(), orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) - 'leadHandover'` }).where(eq(workspaces.id, projectId));
        await tx.update(workspaceMembers).set({ role: 'admin' }).where(and(eq(workspaceMembers.projectId, projectId), eq(workspaceMembers.userId, holder)));
        await tx.insert(workspaceMembers).values({ projectId, userId, role: 'owner' })
            .onConflictDoUpdate({ target: [workspaceMembers.projectId, workspaceMembers.userId], set: { role: 'owner' } });
        await syncWorkspaceChat(tx, projectId, userId, 'role');
        await syncWorkspaceChat(tx, projectId, holder, 'role');
        await moveGroupWorkToLead(tx, projectId, userId);
    });
    revalidatePath(`/workspaces/${ctx.child.slug ?? projectId}`);
    const org = await orgLabel(ctx.child.parentId);
    if (org) await notifyOrg({ orgId: org.id, eventKey: 'org.child_decided', actorId: ctx.userId, to: [userId], title: `You now lead ${ctx.child.title}`,
        href: `/workspaces/${encodeURIComponent(ctx.child.slug ?? projectId)}`, sourceEventId: `assign-lead:${projectId}:${Date.now()}` });
    return { success: true };
}

/** Follow the organization's sprints (report §18.7, gap 41): changeable after creation by whoever sets visibility. */
export async function setChildFollowSprintsAction(projectId: string, on: boolean): Promise<{ success: true } | Failure> {
    const viewer = await childViewer(projectId);
    if (!viewer?.project.parentId || !(await childCan(viewer, 'change_visibility'))) return DENIED;
    await db.update(workspaces).set({ orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) || jsonb_build_object('followOrgSprints', ${on}::boolean)`, updatedAt: new Date() })
        .where(eq(workspaces.id, projectId));
    revalidateChild(viewer.project);
    return { success: true };
}

/** Public / Org only / Private for a child project, never above the org's cap (report §21.6). */
export async function setChildVisibilityAction(projectId: string, next: ChildVisibility): Promise<{ success: true } | Failure> {
    const viewer = await childViewer(projectId);
    if (!viewer?.project.parentId || !(await childCan(viewer, 'change_visibility'))) return DENIED;
    const org = await readOrgCap(db, viewer.project.parentId);
    if (!org || !['public', 'org', 'private'].includes(next)) return DENIED;
    if (!allowedChildVisibilities(org.cap, org.orgPublic).includes(next)) return { success: false, error: 'The organization does not allow this visibility.' };
    const [restriction] = await db.select({ at: workspaces.restrictedAt }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
    if (restriction?.at && next !== 'private') return { success: false, error: 'This workspace is restricted for now. It stays private until NetworkBase lifts the restriction.' };
    await db.update(workspaces).set({ visibility: next, updatedAt: new Date() }).where(eq(workspaces.id, projectId));
    revalidateChild(viewer.project);
    return { success: true };
}

/**
 * Moves the lead's personal project into an org they belong to. Org owners and admins move it at once;
 * members send a request an admin approves. Outside people block the move while the org keeps them out.
 */
export async function moveWorkspaceToOrgAction(projectId: string, orgId: string): Promise<{ success: true; outcome: 'moved' | 'requested' } | Failure> {
    const viewer = await childViewer(projectId);
    if (!viewer || !viewer.isLead || viewer.project.parentId) return DENIED;
    const role = await readViewerOrgRole(orgId, viewer.userId);
    if (!role || role === 'viewer') return { success: false, error: "You’re not a member of that organization." };
    const org = await readOrgCap(db, orgId);
    if (!org) return DENIED;
    if (!org.outsidePeople) {
        const outside = await countOutsidePeople(projectId, orgId);
        if (outside > 0) return { success: false, error: `${outside} ${outside === 1 ? 'person isn’t' : 'people aren’t'} in that organization. Remove them first.` };
    }
    // Report §19.1: a workspace the organization invited back after a restore moves in with one click.
    const [invite] = await db.execute<{ yes: boolean }>(sql`SELECT coalesce(org_settings->'invitedBack', '[]'::jsonb) ? ${projectId} AS yes FROM workspaces WHERE id = ${orgId}`);
    if (isAdminRole(role) || invite?.yes) {
        await moveIntoOrg(projectId, orgId, viewer.project.visibility);
        if (invite?.yes) await db.update(workspaces).set({ orgSettings: sql`jsonb_set(${workspaces.orgSettings}, '{invitedBack}', (coalesce(${workspaces.orgSettings}->'invitedBack', '[]'::jsonb) - ${projectId}::text))` }).where(eq(workspaces.id, orgId));
        revalidateChild(viewer.project);
        return { success: true, outcome: 'moved' };
    }
    await db.update(workspaces).set({
        orgSettings: sql`${workspaces.orgSettings} || ${JSON.stringify({ moveInRequest: { orgId, by: viewer.userId, at: new Date().toISOString() } })}::jsonb`,
    }).where(eq(workspaces.id, projectId));
    revalidateChild(viewer.project);
    await notifyChildRequest(orgId, projectId, viewer.userId, (child, orgTitle) => `${child} wants to join ${orgTitle}`);
    return { success: true, outcome: 'requested' };
}

/** Move-in and detach requests reach the org's admins; the answer reaches the project's lead (report §26.3 B). */
async function notifyChildRequest(orgId: string, projectId: string, actorId: string, title: (child: string, org: string) => string) {
    const [org, child] = await Promise.all([orgLabel(orgId), orgLabel(projectId)]);
    if (org && child) await notifyOrg({ orgId, eventKey: 'org.child_requests', actorId, title: title(child.title, org.title), href: orgHref(org, '?tab=projects'), sourceEventId: `child-request:${projectId}:${Date.now()}` });
}

async function notifyChildDecision(orgId: string, projectId: string, leadId: string, actorId: string, title: (child: string, org: string) => string) {
    const [org, child] = await Promise.all([orgLabel(orgId), orgLabel(projectId)]);
    if (org && child) await notifyOrg({ orgId, eventKey: 'org.child_decided', actorId, to: [leadId], title: title(child.title, org.title), href: `/workspaces/${encodeURIComponent(child.slug ?? child.id)}`, sourceEventId: `child-decision:${projectId}:${Date.now()}` });
}

async function pendingMoveIn(projectId: string) {
    const [project] = await db.select({ id: workspaces.id, slug: workspaces.slug, visibility: workspaces.visibility, ownerId: workspaces.ownerId, parentId: workspaces.parentId, orgSettings: workspaces.orgSettings })
        .from(workspaces).where(and(eq(workspaces.id, projectId), isNull(workspaces.deletedAt))).limit(1);
    const request = (project?.orgSettings as { moveInRequest?: { orgId: string } } | null)?.moveInRequest;
    return project && request && !project.parentId ? { project, orgId: request.orgId } : null;
}

/** An org admin approves a move-in request; the outside-people rule is checked again. */
export async function approveMoveInAction(projectId: string): Promise<{ success: true } | Failure> {
    const userId = await viewerId();
    const pending = userId ? await pendingMoveIn(projectId) : null;
    if (!pending || !isAdminRole(await readViewerOrgRole(pending.orgId, userId))) return DENIED;
    const org = await readOrgCap(db, pending.orgId);
    if (org && !org.outsidePeople && (await countOutsidePeople(projectId, pending.orgId)) > 0) {
        return { success: false, error: 'This workspace now has people outside the organization.' };
    }
    await moveIntoOrg(projectId, pending.orgId, pending.project.visibility);
    revalidatePath(`/workspaces/${pending.project.slug ?? projectId}`);
    await notifyChildDecision(pending.orgId, projectId, pending.project.ownerId, userId!, (child, orgTitle) => `${child} is now part of ${orgTitle}`);
    return { success: true };
}

/** The lead withdraws, or an org admin declines, a move-in request; a decline tells the lead, with the reason (report §28.6). */
export async function cancelMoveInAction(projectId: string, reason?: string | null): Promise<{ success: true } | Failure> {
    const userId = await viewerId();
    const pending = userId ? await pendingMoveIn(projectId) : null;
    if (!pending || !(pending.project.ownerId === userId || isAdminRole(await readViewerOrgRole(pending.orgId, userId)))) return DENIED;
    await db.update(workspaces).set({ orgSettings: sql`${workspaces.orgSettings} - 'moveInRequest'` }).where(eq(workspaces.id, projectId));
    revalidatePath(`/workspaces/${pending.project.slug ?? projectId}`);
    if (pending.project.ownerId !== userId) await notifyChildDecision(pending.orgId, projectId, pending.project.ownerId, userId!, declined(reason));
    return { success: true };
}

const declined = (reason?: string | null) => (child: string, org: string) => `${org} declined ${child}${reason?.trim() ? `: ${reason.trim().slice(0, 300)}` : ''}`;

/** Impact preview before tightening the cap: how many child projects would be lowered. */
export async function previewVisibilityCapAction(orgId: string, cap: 'public' | 'org' | 'private'): Promise<{ success: true; affected: number } | Failure> {
    const viewer = await orgViewer(orgId, 'read');
    if (!viewer || orgGrant(viewer.role, 'manage_joining') !== 'yes') return DENIED;
    return { success: true, affected: await countChildrenAboveCap(orgId, cap) };
}

/** Orgs the viewer can open the create wizard in, with the reason when they can't (report §14.1 E4). */
export async function listCreateLocationsAction(): Promise<Array<{ id: string; title: string; slug: string | null; block: string | null; visibilityCap: string; orgPublic: boolean; isAdmin: boolean }>> {
    const userId = await viewerId();
    if (!userId) return [];
    return listCreateLocations(userId);
}

/** Settings › Notifications › Organizations: every org the viewer owns or belongs to (report §26.8). */
export async function listMyOrganizationsAction(): Promise<Array<{ id: string; title: string }>> {
    const userId = await viewerId();
    if (!userId) return [];
    return db.select({ id: workspaces.id, title: workspaces.title }).from(workspaces)
        .where(and(eq(workspaces.kind, 'organization'), isNull(workspaces.deletedAt),
            sql`(${workspaces.ownerId} = ${userId} OR EXISTS (SELECT 1 FROM ${workspaceMembers} m WHERE m.workspace_id = ${workspaces.id} AND m.user_id = ${userId}))`))
        .orderBy(workspaces.title).limit(200);
}

export type OrgRosterPerson = { userId: string; name: string; username: string | null; avatarUrl: string | null; title: string | null; role: string; projectHint: string | null; skills?: string[] };

/**
 * The org roster for the create wizard's people picker (report §14.4): members and admins, searchable by
 * name, username or title, with one "In <project>" hint each. Guests are left out: they never join teams.
 */
export async function listOrgRosterAction(orgId: string, query = '', adminsOnly = false): Promise<OrgRosterPerson[]> {
    const viewer = await orgViewer(orgId, 'read');
    if (!viewer || viewer.role === 'visitor' || viewer.role === 'guest') return [];
    const q = query.trim().slice(0, 80);
    const pattern = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    // Search by name, title, skill, and for owners and admins email too (report §14.4).
    const byEmail = viewer.role === 'owner' || viewer.role === 'admin';
    const rows = await db.execute<{ user_id: string; full_name: string | null; username: string | null; avatar_url: string | null; title: string | null; role: string; hint: string | null; skills: string[] | null }>(sql`
        SELECT pm.user_id, p.full_name, p.username, p.avatar_url, pm.title, pm.role,
               (SELECT c.title FROM ${workspaces} c JOIN ${workspaceMembers} cm ON cm.workspace_id = c.id
                 WHERE c.parent_id = ${orgId} AND c.deleted_at IS NULL AND cm.user_id = pm.user_id
                 ORDER BY c.created_at DESC LIMIT 1) AS hint,
               (SELECT array_agg(s.name ORDER BY s.name) FROM (SELECT sk.name FROM profile_skills ps JOIN skills sk ON sk.id = ps.skill_id
                 WHERE ps.profile_id = pm.user_id LIMIT 6) s) AS skills
        FROM ${workspaceMembers} pm
        JOIN ${profiles} p ON p.id = pm.user_id
        WHERE pm.workspace_id = ${orgId} AND pm.role IN ('owner', 'admin', 'member') AND p.deleted_at IS NULL
          AND (NOT ${adminsOnly} OR pm.role IN ('owner', 'admin'))
          AND (${q} = '' OR p.full_name ILIKE ${pattern} OR p.username ILIKE ${pattern} OR pm.title ILIKE ${pattern}
            OR (${byEmail} AND lower(p.email) = lower(${q}))
            OR EXISTS (SELECT 1 FROM profile_skills ps JOIN skills sk ON sk.id = ps.skill_id WHERE ps.profile_id = pm.user_id AND sk.name ILIKE ${pattern}))
        ORDER BY p.full_name NULLS LAST
        LIMIT 50
    `);
    return Array.from(rows).map((row) => ({
        userId: row.user_id,
        name: row.full_name || row.username || 'Member',
        username: row.username,
        avatarUrl: row.avatar_url,
        title: row.title,
        role: row.role,
        projectHint: row.hint ? `In ${row.hint}` : null,
        skills: row.skills ?? [],
    }));
}

/**
 * The Outside tab of the people picker (report §14.4), only while the org lets outside people into its projects:
 * public profiles outside the org, never someone who blocked you. They are always invited, never added.
 */
export async function listOutsidePeopleAction(orgId: string, query: string): Promise<OrgRosterPerson[]> {
    const viewer = await orgViewer(orgId, 'read');
    if (!viewer || viewer.role === 'visitor' || viewer.role === 'guest') return [];
    const [org] = await db.select({ settings: workspaces.orgSettings }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
    if ((org?.settings as { outsidePeople?: unknown } | null)?.outsidePeople !== true) return [];
    const q = query.trim().replace(/^@/, '').slice(0, 64);
    if (q.length < 2) return [];
    const rate = await consumeRateLimit(`org-outside-search:${viewer.userId}`, 60, 60);
    if (!rate.allowed) return [];
    const pattern = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const rows = await db.execute<{ id: string; full_name: string | null; username: string | null; avatar_url: string | null; headline: string | null }>(sql`
        SELECT p.id, p.full_name, p.username, p.avatar_url, p.headline FROM ${profiles} p
        WHERE p.deleted_at IS NULL AND p.visibility = 'public' AND p.onboarding_status = 'completed' AND p.id <> ${viewer.userId}
          AND (p.username ILIKE ${pattern} OR p.full_name ILIKE ${pattern})
          AND NOT EXISTS (SELECT 1 FROM ${workspaceMembers} pm WHERE pm.workspace_id = ${orgId} AND pm.user_id = p.id)
          AND NOT app_private.chat_is_blocked(${viewer.userId}::uuid, p.id)
        ORDER BY (p.username ILIKE ${`${q}%`}) DESC, p.full_name NULLS LAST LIMIT 20`);
    return Array.from(rows).map((row) => ({ userId: row.id, name: row.full_name || row.username || 'Someone', username: row.username, avatarUrl: row.avatar_url, title: row.headline, role: 'outside', projectHint: null }));
}

/** Phase 2 warning, not a block (report §14.3): another live project in the org already has this title. */
export async function childTitleTakenAction(orgId: string, title: string): Promise<boolean> {
    const viewer = await orgViewer(orgId, 'read');
    const t = title.trim();
    if (!viewer || viewer.role === 'visitor' || viewer.role === 'guest' || t.length < 2) return false;
    const [row] = await db.select({ id: workspaces.id }).from(workspaces)
        .where(and(eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt), sql`lower(${workspaces.title}) = lower(${t})`)).limit(1);
    return Boolean(row);
}
