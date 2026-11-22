export const PROFILE_EDIT_SECTIONS = ['general', 'experience', 'skills', 'social', 'opportunity'] as const;
export type ProfileEditSection = typeof PROFILE_EDIT_SECTIONS[number];

export function parseProfileEditSection(value: unknown): ProfileEditSection {
    return PROFILE_EDIT_SECTIONS.includes(value as ProfileEditSection) ? value as ProfileEditSection : 'general';
}

export function profileEditHref(
    section: ProfileEditSection = 'general', 
    returnTab: string = 'overview',
    extraParams?: Record<string, string | null | undefined>
): string {
    const params = new URLSearchParams({ section: parseProfileEditSection(section) });
    if (returnTab === 'portfolio') params.set('returnTab', 'portfolio');
    if (extraParams) {
        for (const [key, value] of Object.entries(extraParams)) {
            if (value) params.set(key, value);
        }
    }
    return `/my-profile/edit?${params}`;
}

/** The edit section that holds a missing item from calculateProfileCompletion. Everything else lives in General. */
export function completionItemSection(item: string | undefined): ProfileEditSection {
    if (!item) return 'general';
    if (/skill/i.test(item)) return 'skills';
    if (/social link/i.test(item)) return 'social';
    return 'general';
}

/** calculateProfileCompletion's items → the field Edit profile opens. */
const COMPLETION_FIELD: Array<[RegExp, string]> = [
    [/photo/i, 'photo'], [/full name/i, 'name'], [/username/i, 'username'], [/headline/i, 'headline'], [/bio/i, 'bio'],
    [/location/i, 'location'], [/website/i, 'website'], [/skill/i, 'skills'], [/social link/i, 'links'],
]
export const completionField = (item: string) => COMPLETION_FIELD.find(([re]) => re.test(item))?.[1] ?? 'name'

export function profileEditReturnHref(returnTab: unknown): string {
    return returnTab === 'portfolio' ? '/my-profile?tab=portfolio' : '/my-profile';
}
