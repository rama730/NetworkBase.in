'use client'

import { saveContributionStoryAction } from '@/app/actions/contribution-stories'
import { storyFromContribution } from '@/lib/profile/contribution-story'
import type { ProfileCollaborationContribution } from '@/lib/profile/collaboration'

/**
 * Pin, hide and show a contribution from the profile, through the same story command the editor uses. Pin and hide
 * change metadata only; showing again publishes the stored story (its checks still apply).
 */
export async function runContributionCommand(c: ProfileCollaborationContribution, operation: 'feature' | 'hide' | 'publish') {
    const stored = c.presentation ?? storyFromContribution({ ...c, draftStory: null })
    return saveContributionStoryAction({
        id: c.id,
        expectedVersion: c.version ?? 1,
        requestId: crypto.randomUUID(),
        operation,
        document: operation === 'publish' ? { ...stored, visible: true } : stored,
    })
}
