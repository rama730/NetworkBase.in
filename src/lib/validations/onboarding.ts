import { normalizeJoinCode } from '@/lib/organizations/join-rules'
import { z } from 'zod'
import {
    ONBOARDING_EXPERIENCE_LEVEL_VALUES,
    ONBOARDING_GENDER_VALUES,
    ONBOARDING_HOURS_PER_WEEK_VALUES,
    ONBOARDING_MESSAGE_PRIVACY_VALUES,
    ONBOARDING_SOCIAL_KEYS,
    ONBOARDING_VISIBILITY_VALUES,
} from '@/lib/onboarding/contracts'
import { normalizeUsername, validateUsername } from '@/lib/validations/username'
import { PROFILE_FIELD_LIMITS as L } from '@/lib/validations/profile-fields'
import { getRolePreferences } from '@/lib/profile/role-preferences'
import { normalizeOptionalProfileUrl, validateSocialLinkCollection } from '@/lib/profile/normalization'
import { isSafeHttpUrl } from '@/lib/security/urls'

// Raw input is bounded before normalizing; the stored length is checked after (https:// is added).
const RAW_URL_MAX = 2048

const nonEmptyTrimmed = (min: number, max: number) => z.string().trim().min(min).max(max)

const optionalTrimmed = (max: number) =>
    z
        .string()
        .trim()
        .max(max)
        .optional()
        .nullable()
        .transform((value) => (value || '').trim() || undefined)

/** A profile URL, normalized the same way profile edit does, with the stored length checked. */
function checkedUrl(raw: string | null | undefined, max: number, ctx: z.RefinementCtx) {
    const value = (raw || '').trim()
    if (!value) return undefined
    const normalized = normalizeOptionalProfileUrl(value)
    if (!normalized) {
        ctx.addIssue({ code: 'custom', message: 'Enter a valid web address' })
        return z.NEVER
    }
    if (normalized.length > max) {
        ctx.addIssue({ code: 'custom', message: `Web addresses can be up to ${max} characters` })
        return z.NEVER
    }
    return normalized
}

const websiteSchema = z
    .string()
    .trim()
    .max(RAW_URL_MAX)
    .optional()
    .nullable()
    .transform((value, ctx) => checkedUrl(value, L.websiteMax, ctx))

/** The form keeps the four keyed fields; storage is the ordered list profile edit writes. */
const socialLinksSchema = z
    .record(z.string(), z.string().max(RAW_URL_MAX).nullable().optional())
    .optional()
    .transform((value, ctx) => {
        const entries = ONBOARDING_SOCIAL_KEYS.flatMap((key) => {
            const url = checkedUrl(value?.[key], L.socialUrlMax, ctx)
            return url ? [[key, url] as const] : []
        })
        const result = validateSocialLinkCollection(Object.fromEntries(entries))
        if (!result.success) {
            ctx.addIssue({ code: 'custom', message: result.error })
            return z.NEVER
        }
        return result.links
    })

const tagItemSchema = z.string().trim().min(1).max(L.tagItemMax)

const dedupeNormalized = (items: string[]) => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const item of items) {
        const normalized = item.trim()
        if (!normalized) continue
        const key = normalized.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        result.push(normalized)
    }
    return result
}

const tagListSchema = z
    .array(tagItemSchema)
    .transform(dedupeNormalized)
    .refine((items) => items.length <= L.tagMaxItems, { message: `Use ${L.tagMaxItems} items or fewer` })
    .optional()
    .default([])

const openToSchema = z
    .array(tagItemSchema)
    .transform(dedupeNormalized)
    .transform(getRolePreferences)
    .refine((items) => items.length <= L.openToMaxItems, {
        message: `Choose up to ${L.openToMaxItems} roles`,
    })
    .optional()
    .default([])

const avatarUrlSchema = z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((value) => (value || '').trim() || undefined)
    // Same SEC-C5 gate as profile edit. The client always uploads first, so a data: or blob: URL is never valid here.
    .refine((value) => !value || (value.length <= L.avatarUrlMax && isSafeHttpUrl(value)), 'Avatar must be a safe http(s) URL')

export const onboardingPayloadSchema = z.object({
    username: z
        .string()
        .trim()
        .transform((value) => normalizeUsername(value))
        .refine((value) => validateUsername(value).valid, { message: 'Invalid username' }),
    fullName: nonEmptyTrimmed(L.fullNameMin, L.fullNameMax),
    avatarUrl: avatarUrlSchema,
    headline: optionalTrimmed(L.headlineMax),
    bio: optionalTrimmed(L.bioMax),
    location: optionalTrimmed(L.locationMax),
    website: websiteSchema,
    skills: tagListSchema,
    interests: tagListSchema,
    openTo: openToSchema,
    messagePrivacy: z.enum(ONBOARDING_MESSAGE_PRIVACY_VALUES).optional().default('connections'),
    socialLinks: socialLinksSchema,
    experienceLevel: z.enum(ONBOARDING_EXPERIENCE_LEVEL_VALUES).optional(),
    hoursPerWeek: z.enum(ONBOARDING_HOURS_PER_WEEK_VALUES).optional(),
    genderIdentity: z.enum(ONBOARDING_GENDER_VALUES).optional(),
    pronouns: optionalTrimmed(L.pronounsMax),
    visibility: z.enum(ONBOARDING_VISIBILITY_VALUES).optional().default('public'),
})

export type OnboardingPayloadInput = z.input<typeof onboardingPayloadSchema>
export type OnboardingPayload = z.output<typeof onboardingPayloadSchema>

export function normalizeOnboardingPayload(input: OnboardingPayloadInput): OnboardingPayload {
    return onboardingPayloadSchema.parse(input)
}

/* ---- Drafts ----
 * A draft is a half-filled form, so it is never rejected: a bad field is dropped and an over-long one is
 * cut. Completion re-validates everything with the strict schema above. Used for the server draft and for
 * the browser's crash buffer, so both read the same shape. */

const draftText = (max: number) =>
    z.unknown().transform((value) => (typeof value === 'string' ? value.trim().slice(0, max) || undefined : undefined)).optional()

const draftEnum = <T extends string>(values: readonly T[]) =>
    z.unknown().transform((value) => (values.includes(value as T) ? (value as T) : undefined)).optional()

const draftTags = z.unknown().transform((value) => {
    if (!Array.isArray(value)) return undefined
    const items = value.flatMap((item) => (typeof item === 'string' ? [item.trim().slice(0, L.tagItemMax)] : []))
    return dedupeNormalized(items).slice(0, L.tagMaxItems)
}).optional()

const draftOpenTo = z.unknown().transform((value) => {
    const roles = getRolePreferences(value).slice(0, L.openToMaxItems)
    return roles.length > 0 ? roles : undefined
}).optional()

const draftSocialLinks = z.unknown().transform((value) => {
    if (!value || typeof value !== 'object') return undefined
    const source = value as Record<string, unknown>
    const links: Partial<Record<(typeof ONBOARDING_SOCIAL_KEYS)[number], string>> = {}
    for (const key of ONBOARDING_SOCIAL_KEYS) {
        const text = typeof source[key] === 'string' ? source[key].trim().slice(0, L.socialUrlMax) : ''
        if (text) links[key] = text
    }
    return Object.keys(links).length > 0 ? links : undefined
}).optional()

const draftAvatar = z.unknown().transform((value) =>
    typeof value === 'string' && value.length <= L.avatarUrlMax && isSafeHttpUrl(value) ? value.trim() : undefined,
).optional()

export const onboardingDraftSchema = z.object({
    username: z.unknown().transform((value) => (typeof value === 'string' ? normalizeUsername(value).slice(0, 64) || undefined : undefined)).optional(),
    fullName: draftText(L.fullNameMax),
    avatarUrl: draftAvatar,
    headline: draftText(L.headlineMax),
    bio: draftText(L.bioMax),
    location: draftText(L.locationMax),
    website: draftText(L.websiteMax),
    skills: draftTags,
    interests: draftTags,
    openTo: draftOpenTo,
    messagePrivacy: draftEnum(ONBOARDING_MESSAGE_PRIVACY_VALUES),
    socialLinks: draftSocialLinks,
    experienceLevel: draftEnum(ONBOARDING_EXPERIENCE_LEVEL_VALUES),
    hoursPerWeek: draftEnum(ONBOARDING_HOURS_PER_WEEK_VALUES),
    genderIdentity: draftEnum(ONBOARDING_GENDER_VALUES),
    pronouns: draftText(L.pronounsMax),
    visibility: draftEnum(ONBOARDING_VISIBILITY_VALUES),
    // An org join code from /join/CODE, kept with the draft so the join survives a closed tab or another device (decision 132).
    pendingJoinCode: z.unknown().transform((value) => (typeof value === 'string' ? normalizeJoinCode(value) ?? undefined : undefined)).optional(),
})

export type OnboardingDraft = z.output<typeof onboardingDraftSchema>

export function parseOnboardingDraft(input: unknown): OnboardingDraft {
    const source = input && typeof input === 'object' ? input : {}
    return onboardingDraftSchema.parse(source)
}
