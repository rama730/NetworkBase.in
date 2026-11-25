import { db } from '@/lib/db'
import { profiles } from '@/lib/db/schema'
import { eq, or, and, isNull } from 'drizzle-orm'
import { cache } from 'react'
import type { User } from '@supabase/supabase-js'
import type { ConnectionState, ProfileViewerUser } from '@/components/profile/v2/types'
import { forClient } from '@/lib/privacy/client-relationship'
import { recordPrivacyReadEvent } from '@/lib/privacy/audit'
import { buildViewerScopedProfileView } from '@/lib/privacy/profile-views'
import type { Profile } from '@/lib/db/schema'
import { resolvePrivacyRelationship } from '@/lib/privacy/resolver'
import { logger } from '@/lib/logger'
import { normalizeUsername, validateUsername } from '@/lib/validations/username'
import { isUuid } from '@/lib/validations/uuid'
import { normalizeNotificationPreferences } from '@/lib/notifications/preferences'
import { normalizeProfile } from '@/lib/utils/normalize-profile'
import { consumeRateLimit } from '@/lib/security/rate-limit'
import {
    getProfileCollaborationSummary,
    readSharedPrivateOrgContributions,
    type ProfileCollaborationSummary,
} from '@/lib/profile/collaboration'
import { getRedisClient } from '@/lib/redis'
import { getConnectionStatsForUser } from '@/lib/connections/stats'

// Presence columns (0184) are read only through app/actions/presence.ts, never with the profile.
type PresenceColumns = 'showActivity' | 'statusEmoji' | 'statusText' | 'statusExpiresAt' | 'statusSetAt' | 'statusPausesNotifications' | 'statusVisibility'
type StandardProfile = Omit<Profile, 'workspaceLayout' | PresenceColumns> & { hasRecoveryCodes: boolean }

function toBootstrapProfile(
    profile: Pick<
        StandardProfile,
        | 'id'
        | 'email'
        | 'username'
        | 'fullName'
        | 'avatarUrl'
        | 'bannerUrl'
        | 'bio'
        | 'headline'
        | 'location'
        | 'website'
        | 'skills'
        | 'interests'
        | 'education'
        | 'openTo'
        | 'openToCollaborate'
        | 'openToCustomRoles'
        | 'preferredCategories'
        | 'socialLinks'
        | 'socialLinkMetadata'
        | 'visibility'
        | 'messagePrivacy'
        | 'connectionPrivacy'
        | 'createdAt'
        | 'updatedAt'
        | 'deletedAt'
        | 'connectionsCount'
        | 'projectsCount'
        | 'followersCount'
        | 'workspaceInboxCount'
        | 'workspaceDueTodayCount'
        | 'workspaceOverdueCount'
        | 'workspaceInProgressCount'
        | 'onboardingStatus'
        | 'onboardingCompletedAt'
        | 'onboardingVersion'
    > & Partial<Pick<StandardProfile, 'notificationPreferences'>>
): StandardProfile {
    return {
        ...profile,
        // "Send read receipts" (0150): on unless the row says otherwise.
        readReceipts: (profile as { readReceipts?: boolean }).readReceipts ?? true,
        skills: profile.skills ?? [],
        interests: profile.interests ?? [],
        // Project contributions are loaded from normalized contribution rows.
        // The retired JSON field must never hydrate a second UI authority.
        experience: [],
        education: profile.education ?? [],
        avatarAssetId: null,
        bannerAssetId: null,
        openTo: profile.openTo ?? [],
        socialLinks: profile.socialLinks ?? {},
        // Compatibility only: the deployed column is no longer read by the safe-link flow.
        socialLinkMetadata: profile.socialLinkMetadata ?? {},
        notificationPreferences: normalizeNotificationPreferences(profile.notificationPreferences),
        experienceLevel: null,
        hoursPerWeek: null,
        genderIdentity: null,
        pronouns: null,
        connectionPrivacy: profile.connectionPrivacy ?? 'everyone',
        onboardingStatus: profile.onboardingStatus ?? 'not_started',
        onboardingCompletedAt: profile.onboardingCompletedAt ?? null,
        onboardingVersion: profile.onboardingVersion ?? 1,
        lastActiveAt: null,
        hasRecoveryCodes: false,
        openToCustomRoles: (profile as any).openToCustomRoles ?? [],
        preferredCategories: (profile as any).preferredCategories ?? [],
    }
}

// Thin authenticated-shell bootstrap: explicit columns only, no wildcard profile load.
export const getUserProfile = cache(async (userId: string) => {
    if (!userId) return null;
    try {
        const [data] = await db
            .select({
                id: profiles.id,
                email: profiles.email,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
                bannerUrl: profiles.bannerUrl,
                bio: profiles.bio,
                headline: profiles.headline,
                location: profiles.location,
                website: profiles.website,
                skills: profiles.skills,
                interests: profiles.interests,
                education: profiles.education,
                openTo: profiles.openTo,
                openToCollaborate: profiles.openToCollaborate,
                openToCustomRoles: profiles.openToCustomRoles,
                preferredCategories: profiles.preferredCategories,
                socialLinks: profiles.socialLinks,
                socialLinkMetadata: profiles.socialLinkMetadata,
                visibility: profiles.visibility,
                messagePrivacy: profiles.messagePrivacy,
                connectionPrivacy: profiles.connectionPrivacy,
                createdAt: profiles.createdAt,
                updatedAt: profiles.updatedAt,
                deletedAt: profiles.deletedAt,
                connectionsCount: profiles.connectionsCount,
                projectsCount: profiles.projectsCount,
                followersCount: profiles.followersCount,
                workspaceInboxCount: profiles.workspaceInboxCount,
                workspaceDueTodayCount: profiles.workspaceDueTodayCount,
                workspaceOverdueCount: profiles.workspaceOverdueCount,
                workspaceInProgressCount: profiles.workspaceInProgressCount,
                onboardingStatus: profiles.onboardingStatus,
                onboardingCompletedAt: profiles.onboardingCompletedAt,
                onboardingVersion: profiles.onboardingVersion,
            })
            .from(profiles)
            .where(and(eq(profiles.id, userId), isNull(profiles.deletedAt)))
            .limit(1);

        if (!data) return null;
        return toBootstrapProfile(data);
    } catch (error) {
        logger.error('[profile.data] failed to fetch bootstrap profile', {
            module: 'profile',
            userId,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });
        return null;
    }
});

interface ProfileDetailsOptions {
    skipHeavyData?: boolean;
    viewerUser?: User | null;
    recordViewEvent?: boolean;
}

export type ProfilePrivacyStatus = 'not_found' | 'private' | 'public';

export interface ProfileDetailsResult {
    privacyStatus: ProfilePrivacyStatus;
    visibilityReason?: string;
    profile: ReturnType<typeof normalizeProfile> | null;
    collaborationSummary: ProfileCollaborationSummary;
    stats: {
        connectionsCount: number;
        projectsCount: number;
        followersCount: number;
        mutualCount?: number;
    };
    connectionStatus: ConnectionState;
    privacyRelationship: {
        canViewProfile: boolean;
        canSendMessage: boolean;
        canSendConnectionRequest: boolean;
        blockedByViewer: boolean;
        blockedByTarget: boolean;
        visibilityReason: string;
        connectionState: ConnectionState | string;
    } | null;
    lockedShell: boolean;
    isOwner: boolean;
    currentUser: ProfileViewerUser | null;
}

const EMPTY_COLLABORATION_SUMMARY: ProfileCollaborationSummary = {
    version: 1,
    generatedAt: '',
    projects: [],
    contributions: [],
    stats: {
        projectsCount: 0,
        visibleProjectsCount: 0,
        contributionCount: 0,
    },
    cacheStatus: 'miss',
};

function toProfileViewerUser(user: User | null): ProfileViewerUser | null {
    return user?.id ? { id: user.id } : null;
}

export async function getProfileMutualCount(viewerId: string, profileId: string) {
    if (!viewerId || !profileId || viewerId === profileId) return 0;
    const redis = getRedisClient();
    if (redis) {
        try {
            const viewerKey = `user:${viewerId}:connections`;
            const profileKey = `user:${profileId}:connections`;
            if (typeof (redis as any).sintercard === 'function') {
                const count = await (redis as any).sintercard(2, [viewerKey, profileKey]);
                if (typeof count === 'number') return count;
            }
            // Redis SINTER natively returns empty array if either key is missing; 1 roundtrip
            const mutualIds = (await redis.sinter(viewerKey, profileKey)) as string[];
            return Array.isArray(mutualIds) ? mutualIds.length : 0;
        } catch (error) {
            logger.warn('[profile.data] mutual redis overlay failed', {
                module: 'profile',
                viewerId,
                profileId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return 0;
}

const PROFILE_DETAIL_COLUMNS = {
    id: true,
    username: true,
    fullName: true,
    avatarUrl: true,
    bannerUrl: true,
    bio: true,
    headline: true,
    location: true,
    website: true,
    skills: true,
    interests: true,
    education: true,
    openTo: true,
    openToCollaborate: true,
    openToCustomRoles: true,
    preferredCategories: true,
    experienceLevel: true,
    hoursPerWeek: true,
    // Loaded for everyone but only ever handed to the owner (see buildViewerScopedProfileView).
    genderIdentity: true,
    pronouns: true,
    socialLinks: true,
    socialLinkMetadata: true,
    visibility: true,
    messagePrivacy: true,
    connectionPrivacy: true,
    createdAt: true,
    updatedAt: true,
    connectionsCount: true,
    projectsCount: true,
    followersCount: true,
    lastActiveAt: true,
} as const;

export async function getProfileDetails(username?: string, options: ProfileDetailsOptions = {}) {
    const viewerUser = options.viewerUser ?? null;
    const shouldRecordViewEvent = options.recordViewEvent ?? true;

    // 2. Fetch Target Profile (Optimized Parallel approach)
    let profileData = null;
    if (username) {
        const normalizedUsername = normalizeUsername(username)
        // We do a soft UUID format check. If it matches a UUID format, we can safely attempt ID lookup fallback
        const isProfileId = isUuid(username);

        if (!isProfileId && !validateUsername(normalizedUsername).valid) {
            profileData = null
        } else {
            profileData = await db.query.profiles.findFirst({
                where: isProfileId
                    ? and(or(eq(profiles.username, normalizedUsername), eq(profiles.id, username)), isNull(profiles.deletedAt))
                    : and(eq(profiles.username, normalizedUsername), isNull(profiles.deletedAt)),
                columns: PROFILE_DETAIL_COLUMNS,
            });
        }
    } else if (viewerUser) {
        profileData = await db.query.profiles.findFirst({
            where: and(eq(profiles.id, viewerUser.id), isNull(profiles.deletedAt)),
            columns: PROFILE_DETAIL_COLUMNS,
        });
    }

    if (!profileData) {
        return {
            privacyStatus: 'not_found',
            profile: null,
            stats: {
                connectionsCount: 0,
                projectsCount: 0,
                followersCount: 0,
                mutualCount: 0,
            },
            collaborationSummary: EMPTY_COLLABORATION_SUMMARY,
            connectionStatus: 'none',
            privacyRelationship: null,
            lockedShell: false,
            isOwner: false,
            currentUser: toProfileViewerUser(viewerUser),
        } satisfies ProfileDetailsResult;
    }

    const isOwner = viewerUser?.id === profileData.id;
    const shouldResolveViewerState = !!viewerUser && !isOwner;

    // Resolve authorization before any contribution/member aggregation. A
    // locked profile must not pay for, cache, or briefly materialize private
    // collaboration data in the request process.
    const privacyRelationship = await resolvePrivacyRelationship(viewerUser?.id ?? null, profileData.id, { target: profileData });

    if (!privacyRelationship) {
        return {
            privacyStatus: 'not_found',
            profile: null,
            stats: {
                connectionsCount: 0,
                projectsCount: 0,
                followersCount: 0,
                mutualCount: 0,
            },
            collaborationSummary: EMPTY_COLLABORATION_SUMMARY,
            connectionStatus: 'none',
            privacyRelationship: null,
            lockedShell: false,
            isOwner: !!isOwner,
            currentUser: toProfileViewerUser(viewerUser),
        } satisfies ProfileDetailsResult;
    }
    const canViewProfile = privacyRelationship.canViewProfile;
    const lockedShell = !canViewProfile;
    if (lockedShell) {
        logger.metric('privacy.profile.locked_shell', {
            hasViewer: !!viewerUser?.id,
            visibilityReason: privacyRelationship.visibilityReason,
            connectionState: privacyRelationship.connectionState,
            lockedShell,
            isOwner: !!isOwner,
        });
    }

    const [collaborationSummary, mutualCount, connectionStats] = canViewProfile
        ? await Promise.all([
            options.skipHeavyData
                ? Promise.resolve(EMPTY_COLLABORATION_SUMMARY)
                : getProfileCollaborationSummary(profileData.id, {
                    includePrivate: !!isOwner,
                    preferCached: true,
                }).then(async (summary) => {
                    // Decision 105: a fellow member of a private organization also sees its entries.
                    const shared = !isOwner && viewerUser?.id ? await readSharedPrivateOrgContributions(profileData.id, viewerUser.id) : [];
                    return shared.length ? { ...summary, contributions: [...summary.contributions, ...shared.filter((c) => !summary.contributions.some((s) => s.id === c.id))] } : summary;
                }),
            shouldResolveViewerState && viewerUser
                ? getProfileMutualCount(viewerUser.id, profileData.id)
                : Promise.resolve(0),
            getConnectionStatsForUser(profileData.id),
        ])
        : [EMPTY_COLLABORATION_SUMMARY, 0, { totalConnections: 0 }];

    // What the browser may know (B31): someone who was blocked sees a private account, never a block.
    const clientRelationship = forClient(privacyRelationship)
    const connectionStatus: ConnectionState =
        clientRelationship.connectionState === 'connected'
            ? 'accepted'
            : clientRelationship.connectionState === 'pending_incoming'
                ? 'pending_incoming'
                : clientRelationship.connectionState === 'pending_outgoing'
                    ? 'pending_outgoing'
                    : clientRelationship.connectionState === 'blocked_by_viewer'
                        ? 'blocked'
                        : 'none';

    const normalizedProfile = normalizeProfile({ ...profileData, connectionsCount: connectionStats.totalConnections })
    const visibleProfile = normalizedProfile
        ? buildViewerScopedProfileView({
            profile: normalizedProfile as Record<string, unknown> & { id: string },
            relationship: privacyRelationship,
            isOwner: !!isOwner,
        })
        : null

    if (shouldRecordViewEvent && viewerUser?.id && viewerUser.id !== profileData.id) {
        const { allowed } = await consumeRateLimit(`audit:profile-view:${viewerUser.id}:${profileData.id}`, 1, 86400)
        if (allowed && privacyRelationship.canViewProfile) {
            void recordPrivacyReadEvent({
                subjectUserId: profileData.id,
                viewerUserId: viewerUser.id,
                eventType: 'profile_viewed',
                route: 'profile.details',
                metadata: {
                    visibilityReason: privacyRelationship.visibilityReason,
                    canViewProfile: privacyRelationship.canViewProfile,
                },
            })
        }
    }

    return {
        privacyStatus: lockedShell ? 'private' : 'public',
        visibilityReason: clientRelationship.visibilityReason,
        profile: visibleProfile,
        collaborationSummary: canViewProfile ? collaborationSummary : EMPTY_COLLABORATION_SUMMARY,
        stats: {
            connectionsCount: connectionStats.totalConnections,
            projectsCount: lockedShell ? 0 : (collaborationSummary.stats.projectsCount || profileData.projectsCount || 0),
            followersCount: lockedShell ? 0 : (profileData.followersCount || 0),
            mutualCount,
        },
        connectionStatus,
        privacyRelationship: {
            canViewProfile: clientRelationship.canViewProfile,
            canSendMessage: clientRelationship.canSendMessage,
            canSendConnectionRequest: clientRelationship.canSendConnectionRequest,
            blockedByViewer: clientRelationship.blockedByViewer,
            blockedByTarget: clientRelationship.blockedByTarget,
            visibilityReason: clientRelationship.visibilityReason,
            connectionState: clientRelationship.connectionState,
        },
        lockedShell,
        isOwner: !!isOwner,
        currentUser: toProfileViewerUser(viewerUser),
    } satisfies ProfileDetailsResult;
}
