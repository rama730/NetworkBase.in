import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { cache, Suspense } from 'react'
import { getProfileDetails } from '@/lib/data/profile'
import { ProfileV2Client } from '@/components/profile/v2/ProfileV2Client'
import { getViewerAuthContext } from '@/lib/server/viewer-context'
import { hasCompletedOnboarding } from '@/lib/onboarding/completion'
import { buildRouteMetadata } from '@/lib/metadata/route-metadata'
import { logger } from '@/lib/logger'
import { buildOwnerProfileTitle, buildProfileMetadataDescription } from '@/lib/profile/display'
import { ProfileRouteSkeleton } from '@/components/profile/v2/ProfileRouteSkeleton'

// Metadata derives from the same required profile projection as the page body.
const readOwnerProfileRoute = cache(async () => {
    const { user } = await getViewerAuthContext()
    if (!user) return { user: null, profileData: null }
    try {
        return {
            user,
            profileData: await getProfileDetails(undefined, { viewerUser: user }),
        }
    } catch (error) {
        logger.error('[profile.page] failed to load profile shell', {
            module: 'profile',
            userId: user.id,
            error: error instanceof Error ? error.message : String(error),
        })
        return { user, profileData: null }
    }
})

export async function generateMetadata() {
    const { user, profileData } = await readOwnerProfileRoute()
    if (!user) {
        return buildRouteMetadata({
            title: 'My profile · NetworkBase',
            description: 'Your profile on NetworkBase.',
            path: '/my-profile',
            robots: { index: false, follow: false },
        })
    }

    const profile = profileData?.profile ?? null

    return buildRouteMetadata({
        title: buildOwnerProfileTitle({
            username: profile?.username,
            fullName: profile?.fullName,
        }),
        description: buildProfileMetadataDescription({
            username: profile?.username,
            fullName: profile?.fullName,
            headline: profile?.headline,
            location: profile?.location,
            bio: profile?.bio,
        }),
        path: '/my-profile',
        image: profile?.avatarUrl || undefined,
        robots: { index: false, follow: false },
    })
}

async function ResolvedProfile() {
    const { user, profileData } = await readOwnerProfileRoute()

    if (!user) {
        redirect('/login')
    }

    let content: ReactNode = null
    const fallbackContent = (
        <div className="flex h-full min-h-0 items-center justify-center p-6">
            <div className="max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-none text-card-foreground">
                <h1 className="nb-section-title text-foreground">Couldn’t load your profile</h1>
                <p className="nb-body mt-2 text-muted-foreground">
                    We couldn’t load your profile data. Refresh the page or try again later, and contact support if the problem persists.
                </p>
            </div>
        </div>
    )
    if (profileData === null) {
        logger.error('[profile.page] getProfileDetails returned null', {
            module: 'profile',
            userId: user.id,
        })
        content = fallbackContent
    }

    if (profileData && (profileData.privacyStatus === 'not_found' || !(await hasCompletedOnboarding(user)))) {
        redirect('/onboarding')
    }

    if (profileData) {
        content = <ProfileV2Client
            profile={profileData.profile}
            stats={profileData.stats}
            isOwner={profileData.isOwner}
            currentUser={profileData.currentUser}
            connectionStatus={profileData.connectionStatus}
            privacyRelationship={profileData.privacyRelationship}
            lockedShell={profileData.lockedShell}
            collaborationSummary={profileData.collaborationSummary}
        />
    }

    return <>{content}</>
}

export default function ProfilePage() {
    return (
        <div
            data-scroll-root="route"
            className="h-full min-h-0 app-scroll app-scroll-y app-scroll-gutter overscroll-y-contain bg-background text-foreground"
        >
            <Suspense fallback={<ProfileRouteSkeleton />}>
                <ResolvedProfile />
            </Suspense>
        </div>
    )
}
