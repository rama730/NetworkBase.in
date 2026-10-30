/**
 * One set of text limits for the profile fields that onboarding and profile edit both write.
 * They match the profiles_onboarding_shape_check DB limits (drizzle/0002_profiles_accounts.sql), so the form, the
 * server action and the database can never disagree.
 */
export const PROFILE_FIELD_LIMITS = {
    fullNameMin: 2,
    fullNameMax: 80,
    headlineMax: 120,
    bioMax: 500,
    locationMax: 120,
    websiteMax: 200,
    socialUrlMax: 200,
    pronounsMax: 60,
    avatarUrlMax: 2000,
    tagItemMax: 32,
    tagMaxItems: 25,
    openToMaxItems: 12,
} as const
