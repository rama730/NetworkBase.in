export const ONBOARDING_TOTAL_STEPS = 4 as const

export const ONBOARDING_VISIBILITY_VALUES = ['public', 'connections', 'private'] as const
export type OnboardingVisibility = typeof ONBOARDING_VISIBILITY_VALUES[number]

export const ONBOARDING_MESSAGE_PRIVACY_VALUES = ['everyone', 'connections'] as const
export type OnboardingMessagePrivacy = typeof ONBOARDING_MESSAGE_PRIVACY_VALUES[number]

export const ONBOARDING_EXPERIENCE_LEVEL_VALUES = ['student', 'junior', 'mid', 'senior', 'lead', 'founder'] as const
export type OnboardingExperienceLevel = typeof ONBOARDING_EXPERIENCE_LEVEL_VALUES[number]

export const ONBOARDING_HOURS_PER_WEEK_VALUES = ['lt_5', 'h_5_10', 'h_10_20', 'h_20_40', 'h_40_plus'] as const
export type OnboardingHoursPerWeek = typeof ONBOARDING_HOURS_PER_WEEK_VALUES[number]

export const ONBOARDING_GENDER_VALUES = ['male', 'female', 'non_binary', 'prefer_not_to_say', 'other'] as const
export type OnboardingGenderIdentity = typeof ONBOARDING_GENDER_VALUES[number]

export const ONBOARDING_SOCIAL_KEYS = ['github', 'linkedin', 'x', 'portfolio'] as const
export type OnboardingSocialLinkKey = typeof ONBOARDING_SOCIAL_KEYS[number]
export type OnboardingSocialLinks = Partial<Record<OnboardingSocialLinkKey, string>>


/** Wording for the visibility and messaging choices. Onboarding and Settings both read these, so they cannot drift. */
export const VISIBILITY_CHOICES: ReadonlyArray<{ value: OnboardingVisibility; label: string; description: string }> = [
    { value: 'public', label: 'Public', description: 'Anyone can open your profile. You appear in Discovery and people search.' },
    { value: 'connections', label: 'Connections only', description: 'Only accepted connections can open your full profile.' },
    { value: 'private', label: 'Private', description: 'Other people see a limited profile shell. You are hidden from Discovery and people search.' },
]

export const MESSAGE_PRIVACY_CHOICES: ReadonlyArray<{ value: OnboardingMessagePrivacy; label: string; description: string }> = [
    { value: 'everyone', label: 'Everyone', description: 'Anyone who is not blocked can start a conversation.' },
    { value: 'connections', label: 'Connections only', description: 'Only accepted connections can start a conversation.' },
]
