import {
  ONBOARDING_SOCIAL_KEYS,
  type OnboardingExperienceLevel,
  type OnboardingGenderIdentity,
  type OnboardingHoursPerWeek,
  type OnboardingMessagePrivacy,
  type OnboardingSocialLinkKey,
  type OnboardingVisibility,
} from '@/lib/onboarding/contracts'
import type { OnboardingDraft } from '@/lib/validations/onboarding'

/** The whole form as the page holds it. Text fields are always strings; an unset choice is ''. */
export interface OnboardingData {
  username: string
  fullName: string
  avatarUrl: string
  headline: string
  bio: string
  location: string
  website: string
  skills: string[]
  interests: string[]
  openTo: string[]
  messagePrivacy: OnboardingMessagePrivacy
  socialLinks: Record<OnboardingSocialLinkKey, string>
  experienceLevel: OnboardingExperienceLevel | ''
  hoursPerWeek: OnboardingHoursPerWeek | ''
  genderIdentity: OnboardingGenderIdentity | ''
  pronouns: string
  visibility: OnboardingVisibility
}

export const EMPTY_ONBOARDING_DATA: OnboardingData = {
  username: '',
  fullName: '',
  avatarUrl: '',
  headline: '',
  bio: '',
  location: '',
  website: '',
  skills: [],
  interests: [],
  openTo: [],
  messagePrivacy: 'connections',
  socialLinks: { github: '', linkedin: '', x: '', portfolio: '' },
  experienceLevel: '',
  hoursPerWeek: '',
  genderIdentity: '',
  pronouns: '',
  visibility: 'public',
}

/** Lays a parsed draft over the form. A field the draft does not have keeps its current value. */
export function applyDraft(base: OnboardingData, draft: OnboardingDraft): OnboardingData {
  const defined = Object.fromEntries(
    Object.entries(draft).filter(([key, value]) => value !== undefined && key !== 'socialLinks'),
  ) as Partial<OnboardingData>
  const socialLinks = { ...base.socialLinks }
  for (const key of ONBOARDING_SOCIAL_KEYS) {
    const value = draft.socialLinks?.[key]
    if (value !== undefined) socialLinks[key] = value
  }
  return { ...base, ...defined, socialLinks }
}

/**
 * What the server receives, for a step save and for the final submit alike. A choice left unset is omitted,
 * and a photo that is still a local preview (blob:) is never sent.
 */
export function toDraftPayload(data: OnboardingData) {
  return {
    ...data,
    avatarUrl: data.avatarUrl.startsWith('blob:') ? '' : data.avatarUrl,
    experienceLevel: data.experienceLevel || undefined,
    hoursPerWeek: data.hoursPerWeek || undefined,
    genderIdentity: data.genderIdentity || undefined,
    pronouns: data.pronouns.trim() || undefined,
  }
}

/** Adds the value to a list or removes it. */
export function toggleIn(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}
