import { ONBOARDING_SOCIAL_KEYS, type OnboardingSocialLinkKey } from '@/lib/onboarding/contracts'
import { normalizeOptionalProfileUrl } from '@/lib/profile/normalization'
import { PROFILE_FIELD_LIMITS } from '@/lib/validations/profile-fields'
import { normalizeUsername, validateUsername } from '@/lib/validations/username'

/** What the username check last said, and for which name. A verdict for another name never counts. */
export type UsernameCheck = {
    username: string
    status: 'idle' | 'checking' | 'valid' | 'invalid' | 'error'
}

export type BlockInput = {
    fullName: string
    username: string
    skills: string[]
    website: string
    socialLinks: Record<OnboardingSocialLinkKey, string>
}

/** The same rule profile edit and the server apply: a safe public web address that fits once https:// is added. */
export function urlFieldError(value: string, max: number = PROFILE_FIELD_LIMITS.websiteMax): string | null {
    const trimmed = value.trim()
    if (!trimmed) return null
    const normalized = normalizeOptionalProfileUrl(trimmed)
    if (!normalized) return 'Enter a valid web address, such as example.com.'
    if (normalized.length > max) return `Web addresses can be up to ${max} characters.`
    return null
}

/**
 * Why Continue is unavailable on this step, or undefined when it is available. The one place that decides it:
 * the button state, the line under it and the click guard all read this.
 */
export function blockReason(
    step: number,
    input: BlockInput,
    usernameCheck: UsernameCheck,
    uploadingAvatar: boolean,
): string | undefined {
    if (uploadingAvatar) return 'Wait for your photo to finish uploading.'

    if (step === 1) {
        if (input.fullName.trim().length < PROFILE_FIELD_LIMITS.fullNameMin) return 'Enter your full name to continue.'
        const username = normalizeUsername(input.username)
        if (!validateUsername(username).valid) {
            return 'Choose a username: 3–20 letters, numbers or underscores.'
        }
        if (usernameCheck.username !== username || usernameCheck.status === 'checking') {
            return 'Checking whether this username is available.'
        }
        // 'error' (the check could not run) is allowed through: saving this step checks the name again on the server.
        if (usernameCheck.status === 'invalid') return 'Choose an available username to continue.'
    }

    if (step === 2) {
        if (urlFieldError(input.website)) return 'Fix the website address to continue.'
        if (ONBOARDING_SOCIAL_KEYS.some((key) => urlFieldError(input.socialLinks[key], PROFILE_FIELD_LIMITS.socialUrlMax))) {
            return 'Fix the highlighted link to continue.'
        }
    }

    if (step === 3 && input.skills.length < 1) return 'Add at least one skill to continue.'
    return undefined
}
