import { calculateProfileCompletion } from '@/lib/validations/profile'
import { trimOptionalDisplayText } from '@/lib/profile/display'
import { normalizeIdentityFields } from '@/lib/ui/identity'

/**
 * Single point of truth for profile field defaults.
 * Handles both camelCase (Drizzle) and snake_case (Supabase REST) inputs.
 * Safe for use in both client and server code.
 */
export function normalizeProfile(p: any) {
    if (!p) return null;
    const { avatarUrl, fullName, username } = normalizeIdentityFields(p);
    const socialLinks =
        (p.socialLinks && typeof p.socialLinks === 'object' ? p.socialLinks : null) ||
        (p.social_links && typeof p.social_links === 'object' ? p.social_links : null) ||
        {};
    const openTo = Array.isArray(p.openTo) ? p.openTo : (Array.isArray(p.open_to) ? p.open_to : []);
    const stringList = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
    const openToCustomRoles = stringList(p.openToCustomRoles ?? p.open_to_custom_roles);
    const preferredCategories = stringList(p.preferredCategories ?? p.preferred_categories);
    const bio = trimOptionalDisplayText(p.bio);
    const headline = trimOptionalDisplayText(p.headline);
    const location = trimOptionalDisplayText(p.location);
    const website = trimOptionalDisplayText(p.website);

    const completion = calculateProfileCompletion({
        avatarUrl,
        fullName,
        username,
        headline,
        bio,
        location,
        website,
        skills: Array.isArray(p.skills) ? p.skills : [],
        socialLinks,
    })
    return {
        ...p,
        avatarUrl,
        fullName,
        username,
        bio,
        headline,
        location,
        website,
        bannerUrl: trimOptionalDisplayText(p.bannerUrl ?? p.banner_url),
        socialLinks,
        openTo,
        openToCollaborate: (p.openToCollaborate ?? p.open_to_collaborate) === true,
        openToCustomRoles,
        preferredCategories,
        experienceLevel: p.experienceLevel ?? p.experience_level ?? null,
        hoursPerWeek: p.hoursPerWeek ?? p.hours_per_week ?? null,
        genderIdentity: p.genderIdentity ?? p.gender_identity ?? null,
        pronouns: p.pronouns ?? null,
        experience: p.experience || [],
        education: p.education || [],
        profileStrength: completion.score,
        completionMissing: completion.missing,
        connectionsCount: Number(p.connectionsCount ?? p.connections_count ?? 0),
        projectsCount: Number(p.projectsCount ?? p.projects_count ?? 0),
        followersCount: Number(p.followersCount ?? p.followers_count ?? 0),
        workspaceInboxCount: p.workspaceInboxCount ?? p.my_work_inbox_count ?? 0,
        workspaceDueTodayCount: p.workspaceDueTodayCount ?? p.my_work_due_today_count ?? 0,
        workspaceOverdueCount: p.workspaceOverdueCount ?? p.my_work_overdue_count ?? 0,
        workspaceInProgressCount: p.workspaceInProgressCount ?? p.my_work_in_progress_count ?? 0,
    };
}
